use std::fs;
use std::path::Path;

use crate::diff::InventoryDiff;
use crate::finding::Finding;
use crate::inventory::Inventory;
use crate::jsonutil::Json;
use crate::review::{Retest, Review};
use crate::VERSION;

pub fn write_outputs(dir: &Path, review: &Review) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    fs::write(dir.join("review.json"), review_json(review).to_pretty())
        .map_err(|e| format!("write review.json: {e}"))?;
    fs::write(dir.join("REVIEW.md"), review_markdown(review))
        .map_err(|e| format!("write REVIEW.md: {e}"))?;
    fs::write(dir.join("review.sarif"), sarif(review).to_pretty())
        .map_err(|e| format!("write review.sarif: {e}"))?;
    Ok(())
}

pub fn inventory_json(inv: &Inventory) -> Json {
    Json::object(vec![
        ("artifact", Json::string(&inv.artifact)),
        ("name", Json::string(&inv.name)),
        ("version", Json::string(&inv.version)),
        (
            "manifest_version",
            inv.manifest_version.map(Json::int).unwrap_or(Json::Null),
        ),
        ("description", Json::string(&inv.description)),
        ("permissions", Json::array_strings(&inv.permissions)),
        (
            "host_permissions",
            Json::array_strings(&inv.host_permissions),
        ),
        ("entrypoints", Json::array_strings(&inv.entrypoints)),
        ("destinations", Json::array_strings(&inv.destinations)),
        ("hosts", Json::array_strings(&inv.hosts)),
        ("update_url", opt_string(&inv.update_url)),
        ("files", Json::array_strings(&inv.files)),
        ("missing_files", Json::array_strings(&inv.missing_files)),
        (
            "signals",
            Json::object(vec![
                (
                    "has_consent_gate",
                    Json::Bool(inv.extracted.has_consent_gate),
                ),
                ("has_kill_switch", Json::Bool(inv.extracted.has_kill_switch)),
                ("has_disclosure", Json::Bool(inv.extracted.has_disclosure)),
                (
                    "opens_socket_with_consent_false",
                    Json::Bool(inv.extracted.opens_socket_with_consent_false),
                ),
                ("has_eval", Json::Bool(!inv.extracted.evals.is_empty())),
                (
                    "has_remote_script",
                    Json::Bool(!inv.extracted.remote_scripts.is_empty()),
                ),
                (
                    "has_cleartext_http",
                    Json::Bool(!inv.extracted.cleartext.is_empty()),
                ),
            ]),
        ),
    ])
}

pub fn diff_json(diff: &InventoryDiff) -> Json {
    Json::object(vec![
        ("from_version", Json::string(&diff.from_version)),
        ("to_version", Json::string(&diff.to_version)),
        (
            "permissions_added",
            Json::array_strings(&diff.permissions_added),
        ),
        (
            "permissions_removed",
            Json::array_strings(&diff.permissions_removed),
        ),
        (
            "host_permissions_added",
            Json::array_strings(&diff.host_permissions_added),
        ),
        (
            "host_permissions_removed",
            Json::array_strings(&diff.host_permissions_removed),
        ),
        (
            "destinations_added",
            Json::array_strings(&diff.destinations_added),
        ),
        (
            "destinations_removed",
            Json::array_strings(&diff.destinations_removed),
        ),
        (
            "entrypoints_added",
            Json::array_strings(&diff.entrypoints_added),
        ),
        (
            "entrypoints_removed",
            Json::array_strings(&diff.entrypoints_removed),
        ),
    ])
}

pub fn review_json(review: &Review) -> Json {
    Json::object(vec![
        ("tool", Json::string("preflight")),
        ("tool_version", Json::string(VERSION)),
        (
            "question",
            Json::string(
                "does this build of our client still match the last shipped artifact and the claims we made to users and app stores?",
            ),
        ),
        ("auto_ship", Json::Bool(false)),
        ("artifact", Json::string(&review.artifact)),
        ("packs", Json::array_strings(&review.packs)),
        ("verdict", Json::string(review.verdict.as_str())),
        ("exit_code", Json::int(review.verdict.exit_code() as i64)),
        ("claims_present", Json::Bool(review.claims_present)),
        ("inventory", inventory_json(&review.inventory)),
        (
            "baseline_diff",
            review
                .baseline_diff
                .as_ref()
                .map(diff_json)
                .unwrap_or(Json::Null),
        ),
        (
            "findings",
            Json::Array(review.findings.iter().map(finding_json).collect()),
        ),
        (
            "retest",
            review.retest.as_ref().map(retest_json).unwrap_or(Json::Null),
        ),
    ])
}

fn finding_json(finding: &Finding) -> Json {
    Json::object(vec![
        ("id", Json::string(&finding.id)),
        ("control_id", Json::string(&finding.control_id)),
        ("pack", Json::string(&finding.pack)),
        ("severity", Json::string(finding.severity.as_str())),
        ("file", Json::string(&finding.file)),
        ("field", Json::string(&finding.field)),
        ("line", Json::int(finding.line as i64)),
        ("snippet", Json::string(&finding.snippet)),
        ("title", Json::string(&finding.title)),
        ("summary", Json::string(&finding.summary)),
    ])
}

fn retest_json(retest: &Retest) -> Json {
    Json::object(vec![
        ("resolved", Json::array_strings(&retest.resolved)),
        ("open", Json::array_strings(&retest.open)),
        ("introduced", Json::array_strings(&retest.introduced)),
    ])
}

pub fn review_markdown(review: &Review) -> String {
    let mut out = String::new();
    out.push_str("# REVIEW\n\n");
    out.push_str("Preflight clearance record. This is not an automatic ship approval. A human signs the release.\n\n");
    out.push_str(&format!("- Tool: preflight {VERSION}\n"));
    out.push_str(&format!("- Artifact: {}\n", review.artifact));
    out.push_str(&format!(
        "- Name: {} {}\n",
        review.inventory.name, review.inventory.version
    ));
    out.push_str(&format!("- Verdict: {}\n", review.verdict.as_str()));
    out.push_str(&format!("- Packs: {}\n", review.packs.join(", ")));
    out.push_str(&format!(
        "- Claims: {}\n",
        if review.claims_present {
            "provided"
        } else {
            "not provided"
        }
    ));
    out.push_str(&format!(
        "- Baseline: {}\n\n",
        if review.baseline_diff.is_some() {
            "compared"
        } else {
            "none"
        }
    ));
    out.push_str("## Question\n\n");
    out.push_str("Does this build of our client still match the last shipped artifact and the claims we made to users and app stores?\n\n");
    out.push_str("## Findings\n\n");
    if review.findings.is_empty() {
        out.push_str("No findings. Clearance still requires human sign-off.\n\n");
    } else {
        for finding in &review.findings {
            out.push_str(&format!(
                "### {} — {}\n\n",
                finding.id,
                finding.severity.as_str()
            ));
            out.push_str(&format!("- Pack: {}\n", finding.pack));
            out.push_str(&format!("- Control: {}\n", finding.control_id));
            out.push_str(&format!("- File: {}\n", finding.file));
            out.push_str(&format!("- Field: {}\n", finding.field));
            out.push_str(&format!(
                "- Snippet: `{}`\n\n",
                finding.snippet.replace('`', "'")
            ));
            out.push_str(&finding.summary);
            out.push_str("\n\n");
        }
    }
    out.push_str("## Baseline diff\n\n");
    match &review.baseline_diff {
        None => out.push_str("None.\n\n"),
        Some(diff) => {
            out.push_str(&format!(
                "- Version: {} -> {}\n",
                diff.from_version, diff.to_version
            ));
            out.push_str(&format!(
                "- Permissions added: {}\n",
                join_or_none(&diff.permissions_added)
            ));
            out.push_str(&format!(
                "- Host permissions added: {}\n",
                join_or_none(&diff.host_permissions_added)
            ));
            out.push_str(&format!(
                "- Destinations added: {}\n\n",
                join_or_none(&diff.destinations_added)
            ));
        }
    }
    if let Some(retest) = &review.retest {
        out.push_str("## Retest\n\n");
        out.push_str(&format!("- Resolved: {}\n", retest.resolved.len()));
        out.push_str(&format!("- Open: {}\n", retest.open.len()));
        out.push_str(&format!("- Introduced: {}\n\n", retest.introduced.len()));
    }
    out.push_str("## Sign-off\n\n");
    out.push_str("Preflight verdicts are `block`, `needs_human`, or `ship_with_conditions`. There is no automatic `ship` verdict.\n\n");
    out.push_str("- Reviewer:\n");
    out.push_str("- Date:\n");
    out.push_str("- Decision:\n");
    out.push_str("- Notes:\n");
    out
}

pub fn sarif(review: &Review) -> Json {
    let mut rules = Vec::new();
    let mut seen = Vec::new();
    for finding in &review.findings {
        if seen.iter().any(|id: &String| id == &finding.control_id) {
            continue;
        }
        seen.push(finding.control_id.clone());
        rules.push(Json::object(vec![
            ("id", Json::string(&finding.control_id)),
            ("name", Json::string(&finding.title)),
            (
                "shortDescription",
                Json::object(vec![("text", Json::string(&finding.title))]),
            ),
            (
                "fullDescription",
                Json::object(vec![("text", Json::string(&finding.summary))]),
            ),
        ]));
    }
    let results = review
        .findings
        .iter()
        .map(|finding| {
            let mut region = vec![(
                "snippet",
                Json::object(vec![("text", Json::string(&finding.snippet))]),
            )];
            if finding.line > 0 {
                region.insert(0, ("startLine", Json::int(finding.line as i64)));
            }
            Json::object(vec![
                ("ruleId", Json::string(&finding.control_id)),
                ("level", Json::string(finding.severity.sarif_level())),
                (
                    "message",
                    Json::object(vec![("text", Json::string(&finding.summary))]),
                ),
                (
                    "partialFingerprints",
                    Json::object(vec![("preflightFindingId", Json::string(&finding.id))]),
                ),
                (
                    "locations",
                    Json::Array(vec![Json::object(vec![(
                        "physicalLocation",
                        Json::object(vec![
                            (
                                "artifactLocation",
                                Json::object(vec![("uri", Json::string(&finding.file))]),
                            ),
                            ("region", Json::object(region)),
                        ]),
                    )])]),
                ),
            ])
        })
        .collect();
    Json::object(vec![
        ("version", Json::string("2.1.0")),
        (
            "$schema",
            Json::string("https://json.schemastore.org/sarif-2.1.0.json"),
        ),
        (
            "runs",
            Json::Array(vec![Json::object(vec![
                (
                    "tool",
                    Json::object(vec![(
                        "driver",
                        Json::object(vec![
                            ("name", Json::string("preflight")),
                            ("version", Json::string(VERSION)),
                            ("rules", Json::Array(rules)),
                        ]),
                    )]),
                ),
                ("results", Json::Array(results)),
            ])]),
        ),
    ])
}

fn opt_string(value: &Option<String>) -> Json {
    match value {
        Some(v) => Json::string(v),
        None => Json::Null,
    }
}

fn join_or_none(items: &[String]) -> String {
    if items.is_empty() {
        "none".into()
    } else {
        items.join(", ")
    }
}
