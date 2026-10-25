use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::jsonutil::{parse, Json};
use crate::manifest::host_of_pattern;

#[derive(Clone, Debug)]
pub struct Claims {
    pub purpose: String,
    pub listing: String,
    pub privacy_url: String,
    pub allowed_hosts: Vec<String>,
    pub permission_purposes: BTreeMap<String, String>,
    pub consent_flow: String,
    pub kill_switch: String,
    pub first_party_hosts: Vec<String>,
    pub update_url: String,
    pub present_keys: BTreeSet<String>,
}

impl Claims {
    pub fn missing_fields(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        if !self.present_keys.contains("purpose") || self.purpose.trim().is_empty() {
            missing.push("purpose");
        }
        if !self.present_keys.contains("listing") || self.listing.trim().is_empty() {
            missing.push("listing");
        }
        if !self.present_keys.contains("privacy_url") || self.privacy_url.trim().is_empty() {
            missing.push("privacy_url");
        }
        if !self.present_keys.contains("allowed_hosts") || self.allowed_hosts.is_empty() {
            missing.push("allowed_hosts");
        }
        if !self.present_keys.contains("permission_purposes") || self.permission_purposes.is_empty()
        {
            missing.push("permission_purposes");
        }
        if !self.present_keys.contains("consent_flow") || self.consent_flow.trim().is_empty() {
            missing.push("consent_flow");
        }
        if !self.present_keys.contains("kill_switch") || self.kill_switch.trim().is_empty() {
            missing.push("kill_switch");
        }
        missing
    }

    pub fn is_complete(&self) -> bool {
        self.missing_fields().is_empty()
    }
}

pub fn load(path: &Path) -> Result<Claims, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("read claims {}: {e}", path.display()))?;
    parse_claims(&text).map_err(|e| format!("claims {}: {e}", path.display()))
}

pub fn parse_claims(text: &str) -> Result<Claims, String> {
    let json = parse(text)?;
    let Json::Object(pairs) = &json else {
        return Err("claims must be a JSON object".into());
    };
    let present_keys = pairs.iter().map(|(k, _)| k.clone()).collect();
    let purpose = json
        .get("purpose")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let listing = json
        .get("listing")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let privacy_url = json
        .get("privacy_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let allowed_hosts = json
        .get("allowed_hosts")
        .map(|v| v.string_list())
        .unwrap_or_default();
    let mut permission_purposes = BTreeMap::new();
    if let Some(Json::Object(items)) = json.get("permission_purposes") {
        for (k, v) in items {
            if let Some(purpose) = v.as_str() {
                permission_purposes.insert(k.clone(), purpose.to_string());
            }
        }
    }
    let consent_flow = json
        .get("consent_flow")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let kill_switch = json
        .get("kill_switch")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let first_party_hosts = json
        .get("first_party_hosts")
        .map(|v| v.string_list())
        .unwrap_or_default();
    let update_url = json
        .get("update_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    Ok(Claims {
        purpose,
        listing,
        privacy_url,
        allowed_hosts,
        permission_purposes,
        consent_flow,
        kill_switch,
        first_party_hosts,
        update_url,
        present_keys,
    })
}

pub fn host_allowed(host: &str, allowed: &[String]) -> bool {
    let host = normalize_host(host);
    if host.is_empty() || is_unmatchable(&host) {
        return false;
    }
    for entry in allowed {
        let entry = normalize_host(entry);
        if entry.is_empty() {
            continue;
        }
        if entry == host {
            return true;
        }
        if let Some(suffix) = entry.strip_prefix("*.") {
            if host == suffix || host.ends_with(&format!(".{suffix}")) {
                return true;
            }
        }
    }
    false
}

pub fn is_first_party(host: &str, claims: &Claims) -> bool {
    let host = normalize_host(host);
    if host.is_empty() {
        return false;
    }
    let bases = if claims.first_party_hosts.is_empty() {
        &claims.allowed_hosts
    } else {
        &claims.first_party_hosts
    };
    for entry in bases {
        let entry = normalize_host(entry);
        if entry.is_empty() {
            continue;
        }
        if host == entry || host.ends_with(&format!(".{entry}")) {
            return true;
        }
    }
    false
}

fn is_unmatchable(host: &str) -> bool {
    host == "<all_urls>" || host == "*" || host == "*.*"
}

pub fn normalize_host(raw: &str) -> String {
    host_of_pattern(raw.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_is_exact() {
        let allowed = vec!["relay.harbor.example".into(), "*.harbor.example".into()];
        assert!(host_allowed("relay.harbor.example", &allowed));
        assert!(host_allowed("https://updates.harbor.example/x", &allowed));
        assert!(!host_allowed("cdn.partner-analytics.example", &allowed));
        assert!(!host_allowed("<all_urls>", &allowed));
    }
}
