use std::collections::BTreeSet;

use crate::artifact::Artifact;
use crate::extract::{self, Evidence, Extracted};
use crate::manifest::{self, Manifest};

#[derive(Clone, Debug)]
pub struct Inventory {
    pub artifact: String,
    pub name: String,
    pub version: String,
    pub manifest_version: Option<i64>,
    pub description: String,
    pub permissions: Vec<String>,
    pub host_permissions: Vec<String>,
    pub entrypoints: Vec<String>,
    pub destinations: Vec<String>,
    pub hosts: Vec<String>,
    pub update_url: Option<String>,
    pub privacy_urls: Vec<String>,
    pub csp: Vec<String>,
    pub files: Vec<String>,
    pub missing_files: Vec<String>,
    pub referenced_files: Vec<String>,
    pub extracted: Extracted,
}

pub fn build(artifact: &Artifact) -> Result<Inventory, String> {
    let raw = artifact
        .files
        .get("manifest.json")
        .ok_or_else(|| "manifest.json not found in artifact".to_string())?;
    let manifest = manifest::parse_manifest(raw)?;
    let extracted = extract::scan_files(&artifact.files);
    Ok(from_parts(
        artifact.label.clone(),
        &artifact.files,
        manifest,
        extracted,
    ))
}

fn from_parts(
    label: String,
    files: &std::collections::BTreeMap<String, Vec<u8>>,
    manifest: Manifest,
    extracted: Extracted,
) -> Inventory {
    let mut missing = Vec::new();
    for path in &manifest.referenced_files {
        if path.split('/').any(|p| p == "..") || !files.contains_key(path) {
            missing.push(path.clone());
        }
    }
    missing.sort();
    missing.dedup();

    let mut destinations = BTreeSet::new();
    let mut hosts = BTreeSet::new();
    for pattern in &manifest.host_permissions {
        hosts.insert(manifest::host_of_pattern(pattern));
    }
    for evidence in &extracted.destinations {
        destinations.insert(evidence.snippet.clone());
        if let Some(host) = extract::url_host(&evidence.snippet) {
            hosts.insert(host);
        }
    }
    if let Some(url) = &manifest.update_url {
        if let Some(host) = extract::url_host(url) {
            hosts.insert(host);
        }
    }
    let mut private = extracted.private_targets.clone();
    for host in &hosts {
        if extract::is_private_host(host) {
            private.push(Evidence {
                file: "manifest.json".into(),
                field: "host".into(),
                snippet: host.clone(),
                line: 1,
            });
        }
    }
    let mut extracted = extracted;
    extracted.private_targets = private;
    dedup_evidence(&mut extracted.private_targets);

    let mut file_names: Vec<String> = files.keys().cloned().collect();
    file_names.sort();
    let destinations: Vec<String> = destinations.into_iter().collect();
    let hosts: Vec<String> = hosts.into_iter().collect();

    Inventory {
        artifact: label,
        name: manifest.name,
        version: manifest.version,
        manifest_version: manifest.manifest_version,
        description: manifest.description,
        permissions: manifest.permissions,
        host_permissions: manifest.host_permissions,
        entrypoints: manifest.entrypoints,
        destinations,
        hosts,
        update_url: manifest.update_url,
        privacy_urls: manifest.privacy_urls,
        csp: manifest.csp,
        files: file_names,
        missing_files: missing,
        referenced_files: manifest.referenced_files,
        extracted,
    }
}

fn dedup_evidence(items: &mut Vec<Evidence>) {
    items.sort_by(|a, b| (&a.file, &a.snippet).cmp(&(&b.file, &b.snippet)));
    items.dedup_by(|a, b| a.file == b.file && a.snippet == b.snippet);
}
