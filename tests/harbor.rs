use std::fs;
use std::path::PathBuf;
use std::process::Command;

use preflight_cli::finding::{self, Severity};
use preflight_cli::review::{self, ReviewRequest, Verdict};
use preflight_cli::Review;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture(name: &str) -> PathBuf {
    root().join("fixtures/harbor-node").join(name)
}

fn claims() -> PathBuf {
    fixture("claims.json")
}

fn review_dir(name: &str) -> Review {
    review::review(&ReviewRequest {
        artifact: fixture(name),
        claims: Some(claims()),
        baseline: None,
        packs: Vec::new(),
        last_review: None,
    })
    .unwrap_or_else(|e| panic!("review {name}: {e}"))
}

fn has_control(review: &Review, control: &str) -> bool {
    review.findings.iter().any(|f| f.control_id == control)
}

#[test]
fn clean_relay_clears_with_conditions() {
    let review = review_dir("clean-relay");
    assert_eq!(
        review.verdict,
        Verdict::ShipWithConditions,
        "{:#?}",
        review.findings
    );
    assert!(
        review.findings.is_empty(),
        "expected no findings, got {:#?}",
        review.findings
    );
    assert!(!review.inventory.extracted.opens_socket_with_consent_false);
}

#[test]
fn extra_host_blocks_on_node_02() {
    let review = review_dir("extra-host");
    assert_eq!(review.verdict, Verdict::Block);
    let snippet = "https://cdn.partner-analytics.example/*";
    let expected = finding::finding_id("NODE-02", "manifest.json", "host_permissions", snippet);
    assert_eq!(expected, "NODE-02:92d834b02f01");
    let finding = review
        .findings
        .iter()
        .find(|f| f.id == expected)
        .unwrap_or_else(|| panic!("missing {expected} in {:#?}", review.findings));
    assert_eq!(finding.control_id, "NODE-02");
    assert_eq!(finding.severity, Severity::Blocker);
    assert!(finding.snippet.contains("cdn.partner-analytics.example"));
}

#[test]
fn broad_hosts_flags_all_urls_and_tabs() {
    let review = review_dir("broad-hosts");
    assert_eq!(review.verdict, Verdict::Block);
    assert!(has_control(&review, "CWS-03"));
    assert!(has_control(&review, "CWS-04"));
}

#[test]
fn remote_script_flags_eval_and_cleartext() {
    let review = review_dir("remote-script");
    assert_eq!(review.verdict, Verdict::Block);
    assert!(has_control(&review, "CWS-08"));
    assert!(has_control(&review, "CWS-07"));
}

#[test]
fn missing_claims_needs_human() {
    let review = review::review(&ReviewRequest {
        artifact: fixture("clean-relay"),
        claims: None,
        baseline: None,
        packs: Vec::new(),
        last_review: None,
    })
    .unwrap();
    assert_eq!(review.verdict, Verdict::NeedsHuman);
    assert!(has_control(&review, "CLAIMS-01"));
    assert_eq!(review.verdict.exit_code(), 0);
}

#[test]
fn diff_sees_added_partner_host() {
    let old = preflight_cli::artifact::load(&fixture("clean-relay")).unwrap();
    let new = preflight_cli::artifact::load(&fixture("extra-host")).unwrap();
    let old_inv = preflight_cli::inventory::build(&old).unwrap();
    let new_inv = preflight_cli::inventory::build(&new).unwrap();
    let diff = preflight_cli::diff::diff_inventories(&old_inv, &new_inv);
    assert!(diff
        .host_permissions_added
        .iter()
        .any(|h| h.contains("cdn.partner-analytics.example")));
    assert_eq!(diff.from_version, "1.2.0");
    assert_eq!(diff.to_version, "1.2.1");
}

#[test]
fn retest_marks_node_02_resolved() {
    let blocked = review_dir("extra-host");
    let dir = std::env::temp_dir().join(format!("preflight-retest-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    preflight_cli::report::write_outputs(&dir, &blocked).unwrap();
    let review = review::review(&ReviewRequest {
        artifact: fixture("clean-relay"),
        claims: Some(claims()),
        baseline: Some(fixture("extra-host")),
        packs: Vec::new(),
        last_review: Some(dir.join("review.json")),
    })
    .unwrap();
    let retest = review.retest.expect("retest summary");
    assert!(retest.resolved.iter().any(|id| id.starts_with("NODE-02:")));
    assert_eq!(review.verdict, Verdict::ShipWithConditions);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn cli_exit_codes() {
    let bin = env!("CARGO_BIN_EXE_preflight");
    let clean = Command::new(bin)
        .arg("review")
        .arg(fixture("clean-relay"))
        .arg("--claims")
        .arg(claims())
        .status()
        .unwrap();
    assert!(clean.success());
    let blocked = Command::new(bin)
        .arg("review")
        .arg(fixture("extra-host"))
        .arg("--claims")
        .arg(claims())
        .status()
        .unwrap();
    assert_eq!(blocked.code(), Some(2));
    let missing = Command::new(bin)
        .arg("inventory")
        .arg(root().join("does-not-exist"))
        .status()
        .unwrap();
    assert_eq!(missing.code(), Some(1));

    let with_key = Command::new(bin)
        .arg("review")
        .arg(fixture("clean-relay"))
        .arg("--claims")
        .arg(claims())
        .arg("--key")
        .arg("pf_live_demo_secret0001")
        .output()
        .unwrap();
    assert!(with_key.status.success());
    let stdout = String::from_utf8_lossy(&with_key.stdout);
    assert!(stdout.contains("authenticated: pf_live_demo"), "stdout: {stdout}");

    let bad_key = Command::new(bin)
        .arg("review")
        .arg(fixture("clean-relay"))
        .arg("--key")
        .arg("invalid_key")
        .status()
        .unwrap();
    assert_eq!(bad_key.code(), Some(1));
}


#[test]
fn zip_and_crx_roundtrip() {
    let dir = fixture("clean-relay");
    let files = [
        "manifest.json",
        "background.js",
        "popup.html",
        "options.html",
        "icon.png",
    ];
    let mut packed = Vec::new();
    for name in files {
        let bytes = fs::read(dir.join(name)).unwrap();
        packed.push((name, bytes));
    }
    let borrowed: Vec<(&str, &[u8])> = packed.iter().map(|(n, b)| (*n, b.as_slice())).collect();
    let zip = zip_store(&borrowed);
    let crx = crx3(&zip);
    let tmp = std::env::temp_dir().join(format!("preflight-crx-{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).unwrap();
    let zip_path = tmp.join("harbor.zip");
    let crx_path = tmp.join("harbor.crx");
    fs::write(&zip_path, &zip).unwrap();
    fs::write(&crx_path, &crx).unwrap();
    for path in [zip_path, crx_path] {
        let review = review::review(&ReviewRequest {
            artifact: path.clone(),
            claims: Some(claims()),
            baseline: None,
            packs: Vec::new(),
            last_review: None,
        })
        .unwrap_or_else(|e| panic!("load {}: {e}", path.display()));
        assert_eq!(review.inventory.name, "Harbor Node");
        assert_eq!(review.inventory.version, "1.2.0");
        assert_eq!(
            review.verdict,
            Verdict::ShipWithConditions,
            "{:#?}",
            review.findings
        );
    }
    let _ = fs::remove_dir_all(&tmp);
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffffffffu32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            if crc & 1 == 1 {
                crc = (crc >> 1) ^ 0xedb88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn zip_store(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut body = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let name_b = name.as_bytes();
        let crc = crc32(data);
        let offset = body.len() as u32;
        push_u32(&mut body, 0x04034b50);
        push_u16(&mut body, 20);
        push_u16(&mut body, 0);
        push_u16(&mut body, 0);
        push_u16(&mut body, 0);
        push_u16(&mut body, 0);
        push_u32(&mut body, crc);
        push_u32(&mut body, data.len() as u32);
        push_u32(&mut body, data.len() as u32);
        push_u16(&mut body, name_b.len() as u16);
        push_u16(&mut body, 0);
        body.extend_from_slice(name_b);
        body.extend_from_slice(data);

        push_u32(&mut central, 0x02014b50);
        push_u16(&mut central, 20);
        push_u16(&mut central, 20);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, crc);
        push_u32(&mut central, data.len() as u32);
        push_u32(&mut central, data.len() as u32);
        push_u16(&mut central, name_b.len() as u16);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u16(&mut central, 0);
        push_u32(&mut central, 0);
        push_u32(&mut central, offset);
        central.extend_from_slice(name_b);
    }
    let central_start = body.len() as u32;
    let central_len = central.len() as u32;
    body.extend_from_slice(&central);
    let n = files.len() as u16;
    push_u32(&mut body, 0x06054b50);
    push_u16(&mut body, 0);
    push_u16(&mut body, 0);
    push_u16(&mut body, n);
    push_u16(&mut body, n);
    push_u32(&mut body, central_len);
    push_u32(&mut body, central_start);
    push_u16(&mut body, 0);
    body
}

fn crx3(zip: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"Cr24");
    out.extend_from_slice(&3u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(zip);
    out
}

fn push_u16(out: &mut Vec<u8>, n: u16) {
    out.extend_from_slice(&n.to_le_bytes());
}

fn push_u32(out: &mut Vec<u8>, n: u32) {
    out.extend_from_slice(&n.to_le_bytes());
}
