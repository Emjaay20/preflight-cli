use crate::jsonutil::{parse, Json};

#[derive(Clone, Debug)]
pub struct Manifest {
    pub name: String,
    pub version: String,
    pub manifest_version: Option<i64>,
    pub description: String,
    pub permissions: Vec<String>,
    pub host_permissions: Vec<String>,
    pub entrypoints: Vec<String>,
    pub referenced_files: Vec<String>,
    pub update_url: Option<String>,
    pub privacy_urls: Vec<String>,
    pub csp: Vec<String>,
}

pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "manifest.json is not utf-8")?;
    let json = parse(text).map_err(|e| format!("manifest.json: {e}"))?;
    let obj = match &json {
        Json::Object(_) => &json,
        _ => return Err("manifest.json must be an object".into()),
    };
    let name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let version = obj
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let manifest_version = obj.get("manifest_version").and_then(|v| v.as_i64());
    let description = obj
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut permissions = Vec::new();
    for key in ["permissions", "optional_permissions"] {
        if let Some(v) = obj.get(key) {
            permissions.extend(v.string_list());
        }
    }
    permissions.sort();
    permissions.dedup();

    let mut host_permissions = Vec::new();
    for key in ["host_permissions", "optional_host_permissions"] {
        if let Some(v) = obj.get(key) {
            host_permissions.extend(v.string_list());
        }
    }
    if let Some(scripts) = obj.get("content_scripts").and_then(|v| v.as_array()) {
        for script in scripts {
            if let Some(matches) = script.get("matches") {
                host_permissions.extend(matches.string_list());
            }
        }
    }
    if let Some(matches) = obj
        .get("externally_connectable")
        .and_then(|v| v.get("matches"))
    {
        host_permissions.extend(matches.string_list());
    }
    if let Some(war) = obj
        .get("web_accessible_resources")
        .and_then(|v| v.as_array())
    {
        for item in war {
            if let Some(matches) = item.get("matches") {
                host_permissions.extend(matches.string_list());
            }
        }
    }
    host_permissions.sort();
    host_permissions.dedup();

    let mut entrypoints = Vec::new();
    let mut referenced = Vec::new();
    collect_background(obj, &mut entrypoints, &mut referenced);
    collect_content_scripts(obj, &mut entrypoints, &mut referenced);
    collect_page(
        obj,
        &["action", "browser_action", "page_action"],
        "default_popup",
        &mut entrypoints,
        &mut referenced,
    );
    if let Some(page) = obj.get("options_page").and_then(|v| v.as_str()) {
        push_path(&mut entrypoints, page);
        push_path(&mut referenced, page);
    }
    if let Some(page) = obj
        .get("options_ui")
        .and_then(|v| v.get("page"))
        .and_then(|v| v.as_str())
    {
        push_path(&mut entrypoints, page);
        push_path(&mut referenced, page);
    }
    if let Some(page) = obj
        .get("side_panel")
        .and_then(|v| v.get("default_path"))
        .and_then(|v| v.as_str())
    {
        push_path(&mut entrypoints, page);
        push_path(&mut referenced, page);
    }
    if let Some(icons) = obj.get("icons") {
        collect_icon_paths(icons, &mut referenced);
    }
    if let Some(overrides) = obj.get("chrome_url_overrides") {
        if let Json::Object(pairs) = overrides {
            for (_, v) in pairs {
                if let Some(s) = v.as_str() {
                    push_path(&mut entrypoints, s);
                    push_path(&mut referenced, s);
                }
            }
        }
    }
    if let Some(pages) = obj.get("sandbox").and_then(|v| v.get("pages")) {
        for page in pages.string_list() {
            push_path(&mut entrypoints, &page);
            push_path(&mut referenced, &page);
        }
    }
    if let Some(war) = obj.get("web_accessible_resources") {
        collect_war(war, &mut referenced);
    }
    if let Some(rules) = obj
        .get("declarative_net_request")
        .and_then(|v| v.get("rule_resources"))
        .and_then(|v| v.as_array())
    {
        for rule in rules {
            if let Some(path) = rule.get("path").and_then(|v| v.as_str()) {
                push_path(&mut referenced, path);
            }
        }
    }
    entrypoints.sort();
    entrypoints.dedup();
    referenced.sort();
    referenced.dedup();

    let update_url = obj
        .get("update_url")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut privacy_urls = Vec::new();
    for key in ["privacy_policy", "privacy_policy_url"] {
        if let Some(url) = obj.get(key).and_then(|v| v.as_str()) {
            privacy_urls.push(url.to_string());
        }
    }
    let mut csp = Vec::new();
    if let Some(value) = obj.get("content_security_policy") {
        collect_csp(value, &mut csp);
    }

    Ok(Manifest {
        name,
        version,
        manifest_version,
        description,
        permissions,
        host_permissions,
        entrypoints,
        referenced_files: referenced,
        update_url,
        privacy_urls,
        csp,
    })
}

fn collect_background(obj: &Json, entrypoints: &mut Vec<String>, referenced: &mut Vec<String>) {
    let Some(bg) = obj.get("background") else {
        return;
    };
    if let Some(sw) = bg.get("service_worker").and_then(|v| v.as_str()) {
        push_path(entrypoints, sw);
        push_path(referenced, sw);
    }
    if let Some(page) = bg.get("page").and_then(|v| v.as_str()) {
        push_path(entrypoints, page);
        push_path(referenced, page);
    }
    if let Some(scripts) = bg.get("scripts") {
        for script in scripts.string_list() {
            push_path(entrypoints, &script);
            push_path(referenced, &script);
        }
    }
}

fn collect_content_scripts(
    obj: &Json,
    entrypoints: &mut Vec<String>,
    referenced: &mut Vec<String>,
) {
    let Some(scripts) = obj.get("content_scripts").and_then(|v| v.as_array()) else {
        return;
    };
    for script in scripts {
        for key in ["js", "css"] {
            if let Some(files) = script.get(key) {
                for file in files.string_list() {
                    if key == "js" {
                        push_path(entrypoints, &file);
                    }
                    push_path(referenced, &file);
                }
            }
        }
    }
}

fn collect_page(
    obj: &Json,
    keys: &[&str],
    field: &str,
    entrypoints: &mut Vec<String>,
    referenced: &mut Vec<String>,
) {
    for key in keys {
        if let Some(page) = obj
            .get(key)
            .and_then(|v| v.get(field))
            .and_then(|v| v.as_str())
        {
            push_path(entrypoints, page);
            push_path(referenced, page);
        }
    }
}

fn collect_icon_paths(icons: &Json, referenced: &mut Vec<String>) {
    if let Json::Object(pairs) = icons {
        for (_, value) in pairs {
            if let Some(path) = value.as_str() {
                push_path(referenced, path);
            }
        }
    }
}

fn collect_war(war: &Json, referenced: &mut Vec<String>) {
    match war {
        Json::Array(items) => {
            for item in items {
                match item {
                    Json::String(s) => push_path(referenced, s),
                    Json::Object(_) => {
                        if let Some(resources) = item.get("resources") {
                            for resource in resources.string_list() {
                                push_path(referenced, &resource);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

fn collect_csp(value: &Json, out: &mut Vec<String>) {
    match value {
        Json::String(s) => out.push(s.clone()),
        Json::Object(pairs) => {
            for (_, v) in pairs {
                if let Some(s) = v.as_str() {
                    out.push(s.to_string());
                }
            }
        }
        _ => {}
    }
}

fn push_path(out: &mut Vec<String>, raw: &str) {
    let path = normalize_ext_path(raw);
    if path.is_empty() || path.contains("://") {
        return;
    }
    out.push(path);
}

pub fn normalize_ext_path(raw: &str) -> String {
    let raw = raw.trim().trim_start_matches("./");
    let raw = raw.trim_start_matches('/');
    raw.replace('\\', "/")
}

pub fn host_of_pattern(pattern: &str) -> String {
    let pattern = pattern.trim();
    let lower = pattern.to_lowercase();
    if lower == "<all_urls>" {
        return "<all_urls>".into();
    }
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .or_else(|| lower.strip_prefix("wss://"))
        .or_else(|| lower.strip_prefix("ws://"))
        .or_else(|| lower.strip_prefix("*://"))
        .unwrap_or(&lower);
    let hostport = rest.split(['/', '?', '#']).next().unwrap_or(rest);
    let host = if let Some(inner) = hostport.strip_prefix('[') {
        inner.split(']').next().unwrap_or(inner)
    } else if hostport.matches(':').count() == 1 {
        hostport.split(':').next().unwrap_or(hostport)
    } else {
        hostport
    };
    host.trim_end_matches('.').to_string()
}

pub fn is_broad_pattern(pattern: &str) -> bool {
    let lower = pattern.trim().to_lowercase();
    if lower == "<all_urls>"
        || lower == "*://*/*"
        || lower == "http://*/*"
        || lower == "https://*/*"
        || lower == "*://*/ *"
        || lower == "*://*/*"
    {
        return true;
    }
    let host = host_of_pattern(pattern);
    host == "*" || host == "<all_urls>"
}

pub fn is_cleartext_pattern(pattern: &str) -> bool {
    let lower = pattern.trim().to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("ws://")
        || lower.starts_with("*://")
        || lower == "<all_urls>"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_patterns() {
        assert_eq!(
            host_of_pattern("https://relay.harbor.example/*"),
            "relay.harbor.example"
        );
        assert_eq!(host_of_pattern("<all_urls>"), "<all_urls>");
        assert_eq!(host_of_pattern("https://*/*"), "*");
        assert!(is_broad_pattern("<all_urls>"));
        assert!(is_broad_pattern("https://*/*"));
        assert!(!is_broad_pattern("https://relay.harbor.example/*"));
    }
}
