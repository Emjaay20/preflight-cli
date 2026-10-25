use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Artifact {
    pub label: String,
    pub files: BTreeMap<String, Vec<u8>>,
}

struct TempPath {
    path: PathBuf,
    dir: bool,
}

impl Drop for TempPath {
    fn drop(&mut self) {
        if self.dir {
            let _ = fs::remove_dir_all(&self.path);
        } else {
            let _ = fs::remove_file(&self.path);
        }
    }
}

pub fn load(path: &Path) -> Result<Artifact, String> {
    if !path.exists() {
        return Err(format!("artifact not found: {}", path.display()));
    }
    let files = if path.is_dir() {
        let mut out = BTreeMap::new();
        walk_dir(path, path, &mut out)?;
        out
    } else {
        let bytes = fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let zip_bytes = zip_payload(&bytes)?;
        unzip_bytes(&zip_bytes)?
    };
    let files = rebase_to_manifest(files)?;
    Ok(Artifact {
        label: path.display().to_string(),
        files,
    })
}

fn zip_payload(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() >= 4 && &bytes[0..4] == b"Cr24" {
        let off = crx_zip_offset(bytes)?;
        return Ok(bytes[off..].to_vec());
    }
    if bytes.len() >= 2 && &bytes[0..2] == b"PK" {
        return Ok(bytes.to_vec());
    }
    Err("unsupported artifact (want a directory, .zip, or .crx)".into())
}

fn crx_zip_offset(bytes: &[u8]) -> Result<usize, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"Cr24" {
        return Err("invalid crx header".into());
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    let off = match version {
        2 => {
            if bytes.len() < 16 {
                return Err("truncated crx2 header".into());
            }
            let key_len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
            let sig_len = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
            16 + key_len + sig_len
        }
        3 => {
            let header_len =
                u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
            12 + header_len
        }
        other => return Err(format!("unsupported crx version {other}")),
    };
    if off > bytes.len() || off + 2 > bytes.len() || &bytes[off..off + 2] != b"PK" {
        return Err("crx payload is not a zip archive".into());
    }
    Ok(off)
}

fn unzip_bytes(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let scratch = temp_path("zip");
    let zip_path = scratch.join("artifact.zip");
    let dest = scratch.join("out");
    let _zip_guard = TempPath {
        path: scratch.clone(),
        dir: true,
    };
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    fs::write(&zip_path, bytes).map_err(|e| e.to_string())?;
    let output = Command::new("unzip")
        .arg("-qq")
        .arg("-o")
        .arg(&zip_path)
        .arg("-d")
        .arg(&dest)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "unzip is required to read .zip and .crx artifacts".to_string()
            } else {
                format!("unzip failed to start: {e}")
            }
        })?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        return Err(format!("unzip failed: {err}{out}"));
    }
    let mut files = BTreeMap::new();
    walk_dir(&dest, &dest, &mut files)?;
    let canon_dest = dest.canonicalize().map_err(|e| e.to_string())?;
    for key in files.keys() {
        let candidate = dest.join(key);
        let canon = candidate.canonicalize().map_err(|e| e.to_string())?;
        if !canon.starts_with(&canon_dest) {
            return Err(format!("zip entry escapes output directory: {key}"));
        }
    }
    Ok(files)
}

fn temp_path(kind: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("preflight-{kind}-{}-{nanos}", std::process::id()))
}

fn walk_dir(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".DS_Store" || name == "__MACOSX" {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type().map_err(|e| e.to_string())?;
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            walk_dir(&path, root, out)?;
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        if rel.is_empty() || rel.split('/').any(|p| p == "..") {
            return Err(format!("refusing path {rel}"));
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.len() > 2_000_000 {
            out.insert(rel, Vec::new());
            continue;
        }
        let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        out.insert(rel, bytes);
    }
    Ok(())
}

fn rebase_to_manifest(
    files: BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let mut manifests: Vec<String> = files
        .keys()
        .filter(|k| *k == "manifest.json" || k.ends_with("/manifest.json"))
        .cloned()
        .collect();
    if manifests.is_empty() {
        return Err("manifest.json not found in artifact".into());
    }
    manifests.sort_by_key(|k| (k.matches('/').count(), k.len()));
    let chosen = &manifests[0];
    let prefix = match chosen.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/"),
        None => String::new(),
    };
    let mut out = BTreeMap::new();
    for (key, value) in files {
        if let Some(rest) = key.strip_prefix(&prefix) {
            if !rest.is_empty() {
                out.insert(rest.to_string(), value);
            }
        }
    }
    if !out.contains_key("manifest.json") {
        return Err("manifest.json not found in artifact".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crx3_offset_points_at_zip() {
        let mut bytes = vec![
            b'C', b'r', b'2', b'4', 3, 0, 0, 0, 4, 0, 0, 0, 1, 2, 3, 4, b'P', b'K',
        ];
        assert_eq!(crx_zip_offset(&bytes).unwrap(), 16);
        bytes[4] = 2;
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        let crx2 = vec![
            b'C', b'r', b'2', b'4', 2, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 9, 8, b'P', b'K',
        ];
        assert_eq!(crx_zip_offset(&crx2).unwrap(), 18);
        let _ = bytes;
        let _ = crx2;
    }
}
