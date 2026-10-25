use crate::claims::{self, Claims};
use crate::diff::InventoryDiff;
use crate::extract::{self, Evidence};
use crate::finding::{Finding, Severity};
use crate::inventory::Inventory;
use crate::manifest;

pub const CWS_PACK: &str = "cws-2026.1";
pub const NODE_PACK: &str = "node-client-2026.1";
pub const CLAIMS_PACK: &str = "preflight";

pub fn default_packs() -> Vec<String> {
    vec![CWS_PACK.to_string(), NODE_PACK.to_string()]
}

pub fn known_pack(id: &str) -> bool {
    id == CWS_PACK || id == NODE_PACK
}

pub fn run(
    inv: &Inventory,
    claims: Option<&Claims>,
    diff: Option<&InventoryDiff>,
    packs: &[String],
) -> Vec<Finding> {
    let mut findings = Vec::new();
    if packs.iter().any(|p| p == CWS_PACK) {
        cws(inv, claims, &mut findings);
    }
    if packs.iter().any(|p| p == NODE_PACK) {
        node(inv, claims, &mut findings);
    }
    claims_rules(claims, &mut findings);
    if let Some(diff) = diff {
        diff_notes(diff, &mut findings);
    }
    findings.sort_by(|a, b| a.id.cmp(&b.id));
    findings.dedup_by(|a, b| a.id == b.id);
    findings
}

fn emit(findings: &mut Vec<Finding>, finding: Finding) {
    if findings.iter().any(|existing| existing.id == finding.id) {
        return;
    }
    findings.push(finding);
}

fn cws(inv: &Inventory, claims: Option<&Claims>, findings: &mut Vec<Finding>) {
    let version = inv
        .manifest_version
        .map(|v| v.to_string())
        .unwrap_or_else(|| "missing".into());
    if inv.manifest_version != Some(3) {
        emit(
            findings,
            Finding::new(
                CWS_PACK,
                "CWS-01",
                Severity::Blocker,
                "manifest.json",
                "manifest_version",
                &version,
                1,
                "Manifest must be version 3",
                "Chrome Web Store releases require Manifest V3.",
            ),
        );
    }
    for path in &inv.missing_files {
        emit(
            findings,
            Finding::new(
                CWS_PACK,
                "CWS-02",
                Severity::High,
                "manifest.json",
                "referenced_file",
                path,
                1,
                "Referenced file is missing",
                &format!("Manifest references {path}, but that file is not in the build."),
            ),
        );
    }
    for pattern in &inv.host_permissions {
        if manifest::is_broad_pattern(pattern) {
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-03",
                    Severity::High,
                    "manifest.json",
                    "host_permissions",
                    pattern,
                    1,
                    "Broad host permission",
                    "Host access covers every site. Narrow it to the destinations this client actually uses.",
                ),
            );
        }
        if manifest::is_cleartext_pattern(pattern) {
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-07",
                    Severity::High,
                    "manifest.json",
                    "host_permissions",
                    pattern,
                    1,
                    "Cleartext network capability",
                    "This host pattern allows http:// or an unrestricted scheme.",
                ),
            );
        }
    }
    for perm in &inv.permissions {
        if perm == "tabs" || perm == "cookies" {
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-04",
                    Severity::Medium,
                    "manifest.json",
                    "permissions",
                    perm,
                    1,
                    "Sensitive permission",
                    &format!("{perm} can read user browsing data and needs a human sign-off."),
                ),
            );
        }
        if matches!(perm.as_str(), "proxy" | "debugger" | "nativeMessaging") {
            let explained = claims
                .and_then(|c| c.permission_purposes.get(perm))
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-09",
                    if explained {
                        Severity::Medium
                    } else {
                        Severity::High
                    },
                    "manifest.json",
                    "permissions",
                    perm,
                    1,
                    "High-risk extension API",
                    &format!("{perm} can control traffic, debug pages, or talk to a native host."),
                ),
            );
        }
    }
    flag_api(
        findings,
        &inv.extracted.api_tabs,
        "tabs",
        "CWS-04",
        Severity::Medium,
    );
    flag_api(
        findings,
        &inv.extracted.api_cookies,
        "cookies",
        "CWS-04",
        Severity::Medium,
    );
    flag_api(
        findings,
        &inv.extracted.api_proxy,
        "proxy",
        "CWS-09",
        Severity::High,
    );
    flag_api(
        findings,
        &inv.extracted.api_debugger,
        "debugger",
        "CWS-09",
        Severity::High,
    );
    flag_api(
        findings,
        &inv.extracted.api_native,
        "nativeMessaging",
        "CWS-09",
        Severity::High,
    );

    let privacy = privacy_url(inv, claims);
    let privacy_ok = privacy.to_lowercase().starts_with("https://");
    if !privacy_ok {
        let severity = if claims.is_some() {
            Severity::High
        } else {
            Severity::Medium
        };
        emit(
            findings,
            Finding::new(
                CWS_PACK,
                "CWS-05",
                severity,
                "claims.json",
                "privacy_url",
                if privacy.is_empty() {
                    "missing"
                } else {
                    privacy.as_str()
                },
                1,
                "Privacy policy URL missing",
                "Store clearance needs an https privacy policy URL in claims or the manifest.",
            ),
        );
    }
    if let Some(claims) = claims {
        if claims.present_keys.contains("permission_purposes") {
            for perm in &inv.permissions {
                let purpose = claims
                    .permission_purposes
                    .get(perm)
                    .map(|s| s.trim())
                    .unwrap_or("");
                if purpose.is_empty() {
                    emit(
                        findings,
                        Finding::new(
                            CWS_PACK,
                            "CWS-06",
                            Severity::High,
                            "manifest.json",
                            "permissions",
                            perm,
                            1,
                            "Permission is not in the claims",
                            &format!("{perm} is in this build but has no purpose in claims.permission_purposes."),
                        ),
                    );
                }
            }
        }
    }
    for evidence in &inv.extracted.cleartext {
        emit(
            findings,
            Finding::new(
                CWS_PACK,
                "CWS-07",
                Severity::High,
                &evidence.file,
                &evidence.field,
                &evidence.snippet,
                evidence.line,
                "Cleartext HTTP endpoint",
                "Network calls must use https:// or wss://.",
            ),
        );
    }
    if let Some(url) = &inv.update_url {
        if extract::is_cleartext_url(url) {
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-07",
                    Severity::High,
                    "manifest.json",
                    "update_url",
                    url,
                    1,
                    "Cleartext update URL",
                    "update_url must be https.",
                ),
            );
        }
    }
    for evidence in inv
        .extracted
        .evals
        .iter()
        .chain(inv.extracted.remote_scripts.iter())
    {
        emit(
            findings,
            Finding::new(
                CWS_PACK,
                "CWS-08",
                Severity::Blocker,
                &evidence.file,
                &evidence.field,
                &evidence.snippet,
                evidence.line,
                "Remote or dynamic code",
                "eval, new Function, or a remote script import is not allowed in a shipped extension.",
            ),
        );
    }
    for policy in &inv.csp {
        if policy.to_lowercase().contains("unsafe-eval") {
            emit(
                findings,
                Finding::new(
                    CWS_PACK,
                    "CWS-08",
                    Severity::Blocker,
                    "manifest.json",
                    "content_security_policy",
                    policy,
                    1,
                    "CSP allows unsafe-eval",
                    "extension_pages CSP must not include unsafe-eval.",
                ),
            );
        }
    }
}

fn node(inv: &Inventory, claims: Option<&Claims>, findings: &mut Vec<Finding>) {
    let networked = !inv.host_permissions.is_empty() || !inv.destinations.is_empty();
    if let Some(claims) = claims {
        if claims.present_keys.contains("allowed_hosts") && !claims.allowed_hosts.is_empty() {
            for pattern in &inv.host_permissions {
                let host = manifest::host_of_pattern(pattern);
                if !claims::host_allowed(&host, &claims.allowed_hosts) {
                    emit(
                        findings,
                        Finding::new(
                            NODE_PACK,
                            "NODE-02",
                            Severity::Blocker,
                            "manifest.json",
                            "host_permissions",
                            pattern,
                            1,
                            "Host is not on the allowlist",
                            &format!("{pattern} is not covered by claims.allowed_hosts."),
                        ),
                    );
                }
            }
            for evidence in &inv.extracted.destinations {
                let host = extract::url_host(&evidence.snippet).unwrap_or_default();
                if !claims::host_allowed(&host, &claims.allowed_hosts) {
                    emit(
                        findings,
                        Finding::new(
                            NODE_PACK,
                            "NODE-02",
                            Severity::Blocker,
                            &evidence.file,
                            "destination",
                            &evidence.snippet,
                            evidence.line,
                            "Destination is not on the allowlist",
                            &format!(
                                "{} is not covered by claims.allowed_hosts.",
                                evidence.snippet
                            ),
                        ),
                    );
                }
            }
        } else if networked {
            emit(
                findings,
                Finding::new(
                    NODE_PACK,
                    "NODE-01",
                    Severity::High,
                    "claims.json",
                    "allowed_hosts",
                    "missing",
                    1,
                    "Destination allowlist missing",
                    "A networked client needs claims.allowed_hosts before it can clear.",
                ),
            );
        }
    }
    if networked && !inv.extracted.has_consent_gate {
        emit(
            findings,
            Finding::new(
                NODE_PACK,
                "NODE-03",
                Severity::High,
                "background.js",
                "consent",
                "missing",
                1,
                "Consent story missing",
                "Network activity must be gated by an in-product consent check.",
            ),
        );
    }
    if inv.extracted.opens_socket_with_consent_false {
        emit(
            findings,
            Finding::new(
                NODE_PACK,
                "NODE-03",
                Severity::Blocker,
                "background.js",
                "consent",
                "consent=false",
                1,
                "Socket opens when consent is false",
                "A fetch or WebSocket runs in a branch where consent is false.",
            ),
        );
    }
    if networked && !inv.extracted.has_kill_switch {
        emit(
            findings,
            Finding::new(
                NODE_PACK,
                "NODE-04",
                Severity::High,
                "background.js",
                "kill_switch",
                "missing",
                1,
                "Kill switch missing",
                "The client needs an in-product kill switch that stops network activity.",
            ),
        );
    }
    if !inv.extracted.has_disclosure {
        emit(
            findings,
            Finding::new(
                NODE_PACK,
                "NODE-05",
                Severity::Medium,
                "popup.html",
                "disclosure",
                "missing",
                1,
                "In-product disclosure missing",
                "The extension UI should tell the user what network activity they are agreeing to.",
            ),
        );
    }
    for evidence in &inv.extracted.private_targets {
        emit(
            findings,
            Finding::new(
                NODE_PACK,
                "NODE-06",
                Severity::High,
                &evidence.file,
                &evidence.field,
                &evidence.snippet,
                evidence.line,
                "Private network target",
                "The client contacts a loopback, link-local, or private-network host.",
            ),
        );
    }
    if let Some(url) = &inv.update_url {
        let host = extract::url_host(url).unwrap_or_default();
        let first_party = claims
            .map(|c| claims::is_first_party(&host, c))
            .unwrap_or(false);
        if !first_party {
            emit(
                findings,
                Finding::new(
                    NODE_PACK,
                    "NODE-07",
                    Severity::High,
                    "manifest.json",
                    "update_url",
                    url,
                    1,
                    "Update URL is not first-party",
                    "update_url must point at a first-party host from the claims.",
                ),
            );
        }
    }
}

fn claims_rules(claims: Option<&Claims>, findings: &mut Vec<Finding>) {
    match claims {
        None => emit(
            findings,
            Finding::new(
                CLAIMS_PACK,
                "CLAIMS-01",
                Severity::Medium,
                "claims.json",
                "claims",
                "missing",
                1,
                "Claims were not provided",
                "Without claims, a human has to decide whether this build still matches what we told users and stores.",
            ),
        ),
        Some(claims) => {
            for field in claims.missing_fields() {
                emit(
                    findings,
                    Finding::new(
                        CLAIMS_PACK,
                        "CLAIMS-01",
                        Severity::Medium,
                        "claims.json",
                        field,
                        "missing",
                        1,
                        "Claims field missing",
                        &format!("{field} is required before a review can move past needs_human."),
                    ),
                );
            }
        }
    }
}

fn diff_notes(diff: &InventoryDiff, findings: &mut Vec<Finding>) {
    for perm in &diff.permissions_added {
        emit(
            findings,
            Finding::new(
                CLAIMS_PACK,
                "DIFF-01",
                Severity::Info,
                "manifest.json",
                "permissions",
                perm,
                1,
                "Permission added since baseline",
                &format!("{perm} was not in the last shipped artifact."),
            ),
        );
    }
    for host in &diff.host_permissions_added {
        emit(
            findings,
            Finding::new(
                CLAIMS_PACK,
                "DIFF-02",
                Severity::Info,
                "manifest.json",
                "host_permissions",
                host,
                1,
                "Host permission added since baseline",
                &format!("{host} was not in the last shipped artifact."),
            ),
        );
    }
}

fn flag_api(
    findings: &mut Vec<Finding>,
    evidence: &[Evidence],
    name: &str,
    control: &str,
    severity: Severity,
) {
    if findings
        .iter()
        .any(|f| f.control_id == control && f.snippet == name)
    {
        return;
    }
    if let Some(hit) = evidence.first() {
        let pack = if control.starts_with("NODE") {
            NODE_PACK
        } else {
            CWS_PACK
        };
        emit(
            findings,
            Finding::new(
                pack,
                control,
                severity,
                &hit.file,
                &hit.field,
                name,
                hit.line,
                "Sensitive API use",
                &format!("Code uses {name}."),
            ),
        );
    }
}

fn privacy_url(inv: &Inventory, claims: Option<&Claims>) -> String {
    if let Some(claims) = claims {
        if !claims.privacy_url.trim().is_empty() {
            return claims.privacy_url.clone();
        }
    }
    inv.privacy_urls.first().cloned().unwrap_or_default()
}
