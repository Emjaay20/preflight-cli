use crate::hashutil::{hex_encode, sha256};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Blocker,
    High,
    Medium,
    Low,
    Info,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Blocker => "blocker",
            Self::High => "high",
            Self::Medium => "medium",
            Self::Low => "low",
            Self::Info => "info",
        }
    }

    pub fn sarif_level(self) -> &'static str {
        match self {
            Self::Blocker | Self::High => "error",
            Self::Medium => "warning",
            Self::Low | Self::Info => "note",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub id: String,
    pub control_id: String,
    pub pack: String,
    pub severity: Severity,
    pub title: String,
    pub summary: String,
    pub file: String,
    pub field: String,
    pub snippet: String,
    pub line: usize,
}

impl Finding {
    pub fn new(
        pack: &str,
        control_id: &str,
        severity: Severity,
        file: &str,
        field: &str,
        snippet: &str,
        line: usize,
        title: &str,
        summary: &str,
    ) -> Self {
        let snippet = truncate(snippet.trim(), 180);
        let id = finding_id(control_id, file, field, &snippet);
        Self {
            id,
            control_id: control_id.to_string(),
            pack: pack.to_string(),
            severity,
            title: title.to_string(),
            summary: summary.to_string(),
            file: file.to_string(),
            field: field.to_string(),
            snippet,
            line,
        }
    }
}

pub fn finding_id(control_id: &str, file: &str, field: &str, snippet: &str) -> String {
    let material = format!("{file}#{field}#{snippet}");
    let digest = sha256(material.as_bytes());
    let hex = hex_encode(&digest);
    format!("{control_id}:{}", &hex[..12])
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_is_stable_and_twelve_hex() {
        let id = finding_id(
            "NODE-02",
            "manifest.json",
            "host_permissions",
            "https://cdn.partner-analytics.example/*",
        );
        let (control, hash) = id.split_once(':').unwrap();
        assert_eq!(control, "NODE-02");
        assert_eq!(hash.len(), 12);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            id,
            finding_id(
                "NODE-02",
                "manifest.json",
                "host_permissions",
                "https://cdn.partner-analytics.example/*"
            )
        );
    }
}
