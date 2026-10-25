use preflight_cli::artifact;
use preflight_cli::diff;
use preflight_cli::inventory;
use preflight_cli::report;
use preflight_cli::review::{self, ReviewRequest};
use preflight_cli::rules;
use preflight_cli::VERSION;
use std::collections::BTreeMap;
use std::path::PathBuf;

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("preflight: {err}");
            1
        }
    };
    std::process::exit(code);
}

fn run() -> Result<i32, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
        println!("{}", usage());
        return Ok(if args.is_empty() { 1 } else { 0 });
    }
    if args[0] == "-V" || args[0] == "--version" {
        println!("preflight {VERSION}");
        return Ok(0);
    }
    let cmd = args[0].as_str();
    let rest = &args[1..];
    match cmd {
        "inventory" => cmd_inventory(rest),
        "diff" => cmd_diff(rest),
        "review" => cmd_review(rest, false),
        "retest" => cmd_review(rest, true),
        "push" => cmd_push(rest),
        other => Err(format!("unknown command '{other}'\n{}", usage())),
    }
}

pub fn parse_api_key_prefix(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let rest = trimmed
        .strip_prefix("pf_live_")
        .ok_or_else(|| "API key must start with pf_live_".to_string())?;
    let (prefix_part, secret_part) = rest
        .split_once('_')
        .ok_or_else(|| "API key format is pf_live_<prefix>_<secret>".to_string())?;
    if prefix_part.is_empty() || secret_part.is_empty() {
        return Err("API key format is pf_live_<prefix>_<secret>".into());
    }
    Ok(format!("pf_live_{prefix_part}"))
}

fn resolve_api_key(parsed: &Parsed) -> Result<Option<(String, String)>, String> {
    let raw = flag_one(parsed, "key")
        .map(String::from)
        .or_else(|| std::env::var("PREFLIGHT_API_KEY").ok().filter(|v| !v.trim().is_empty()));
    match raw {
        None => Ok(None),
        Some(full) => {
            let prefix = parse_api_key_prefix(&full)?;
            Ok(Some((prefix, full.trim().to_string())))
        }
    }
}

fn cmd_inventory(args: &[String]) -> Result<i32, String> {
    let parsed = parse_flags(args, &[])?;
    let artifact = one_positional(&parsed, "inventory")?;
    let loaded = artifact::load(&PathBuf::from(artifact))?;
    let inv = inventory::build(&loaded)?;
    print!("{}", report::inventory_json(&inv).to_pretty());
    Ok(0)
}

fn cmd_diff(args: &[String]) -> Result<i32, String> {
    let parsed = parse_flags(args, &[])?;
    if parsed.positionals.len() != 2 {
        return Err(format!(
            "usage: preflight diff <old-artifact> <new-artifact>\n{}",
            usage()
        ));
    }
    let old = artifact::load(&PathBuf::from(&parsed.positionals[0]))?;
    let new = artifact::load(&PathBuf::from(&parsed.positionals[1]))?;
    let old_inv = inventory::build(&old)?;
    let new_inv = inventory::build(&new)?;
    let diff = diff::diff_inventories(&old_inv, &new_inv);
    print!("{}", report::diff_json(&diff).to_pretty());
    Ok(0)
}

fn cmd_review(args: &[String], retest: bool) -> Result<i32, String> {
    let known = if retest {
        &["claims", "out", "pack", "last-review", "key"][..]
    } else {
        &["claims", "baseline", "out", "pack", "key"][..]
    };
    let parsed = parse_flags(args, known)?;
    let key_info = resolve_api_key(&parsed)?;
    let artifact = one_positional(&parsed, if retest { "retest" } else { "review" })?;
    let claims = flag_one(&parsed, "claims");
    let last_review = flag_one(&parsed, "last-review");
    if retest && last_review.is_none() {
        return Err("retest requires --last-review <review.json>".into());
    }
    if retest && claims.is_none() {
        return Err("retest requires --claims <claims.json>".into());
    }
    let req = ReviewRequest {
        artifact: PathBuf::from(artifact),
        claims: claims.map(PathBuf::from),
        baseline: flag_one(&parsed, "baseline").map(PathBuf::from),
        packs: parsed.flags.get("pack").cloned().unwrap_or_default(),
        last_review: last_review.map(PathBuf::from),
    };
    let review = review::review(&req)?;
    if let Some((prefix, _)) = &key_info {
        println!("authenticated: {prefix}");
    }
    print_summary(&review);
    if let Some(dir) = flag_one(&parsed, "out") {
        let dir = PathBuf::from(dir);
        report::write_outputs(&dir, &review)?;
        println!("wrote: {}", dir.join("review.json").display());
        println!("wrote: {}", dir.join("REVIEW.md").display());
        println!("wrote: {}", dir.join("review.sarif").display());
    }
    Ok(review.verdict.exit_code())
}

fn cmd_push(args: &[String]) -> Result<i32, String> {
    let known = &["project", "claims", "key", "api"][..];
    let parsed = parse_flags(args, known)?;
    let artifact = one_positional(&parsed, "push")?;
    let (prefix, full_key) = resolve_api_key(&parsed)?
        .ok_or_else(|| "push requires --key <pf_live_...> or PREFLIGHT_API_KEY".to_string())?;
    let project_id = flag_one(&parsed, "project")
        .ok_or_else(|| "push requires --project <project-id>".to_string())?;
    let api_base = flag_one(&parsed, "api")
        .map(String::from)
        .or_else(|| std::env::var("PREFLIGHT_API_URL").ok())
        .unwrap_or_else(|| "http://localhost:3080".to_string());
    let claims_path = flag_one(&parsed, "claims");

    // 1. Run local deterministic Rust scan first
    let req = ReviewRequest {
        artifact: PathBuf::from(artifact),
        claims: claims_path.map(PathBuf::from),
        baseline: None,
        packs: Vec::new(),
        last_review: None,
    };
    let local_review = review::review(&req)?;
    println!("[agent:01:artifact] verified {}", local_review.artifact);
    println!(
        "[agent:02:extractor] permissions={} hosts={} destinations={}",
        local_review.inventory.permissions.len(),
        local_review.inventory.host_permissions.len(),
        local_review.inventory.destinations.len()
    );
    println!(
        "[agent:04:policy] evaluated packs={} findings={}",
        local_review.packs.join(","),
        local_review.findings.len()
    );
    println!(
        "[agent:05:arbiter] local verdict={} (key={prefix})",
        local_review.verdict.as_str()
    );

    // 2. Push artifact + claims to platform API using curl
    let endpoint = format!(
        "{}/v1/projects/{}/reviews",
        api_base.trim_end_matches('/'),
        project_id
    );
    let mut cmd = std::process::Command::new("curl");
    cmd.arg("-sS")
        .arg("-f")
        .arg("-X")
        .arg("POST")
        .arg(&endpoint)
        .arg("-H")
        .arg(format!("Authorization: Bearer {full_key}"))
        .arg("-F")
        .arg(format!("artifact=@{artifact}"));
    if let Some(cp) = claims_path {
        let claims_raw = std::fs::read_to_string(cp)
            .map_err(|e| format!("read claims {cp}: {e}"))?;
        cmd.arg("-F").arg(format!("claims={claims_raw}"));
    }
    let output = cmd
        .output()
        .map_err(|e| format!("failed to execute curl for push: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("push to {endpoint} failed: {}", stderr.trim()));
    }
    let body = String::from_utf8_lossy(&output.stdout);
    println!("pushed: {}", body.trim());
    Ok(local_review.verdict.exit_code())
}

fn print_summary(review: &preflight_cli::Review) {
    for finding in &review.findings {
        println!(
            "{}  {}  {}  {}  {}",
            finding.id,
            finding.severity.as_str(),
            finding.pack,
            finding.file,
            finding.title
        );
    }
    println!("verdict: {}", review.verdict.as_str());
    if let Some(retest) = &review.retest {
        println!(
            "retest: resolved={} open={} introduced={}",
            retest.resolved.len(),
            retest.open.len(),
            retest.introduced.len()
        );
    }
}

struct Parsed {
    positionals: Vec<String>,
    flags: BTreeMap<String, Vec<String>>,
}

fn parse_flags(args: &[String], known: &[&str]) -> Result<Parsed, String> {
    let mut positionals = Vec::new();
    let mut flags: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--" {
            positionals.extend(args[i + 1..].iter().cloned());
            break;
        }
        if let Some(rest) = arg.strip_prefix("--") {
            let (key, inline) = if let Some((k, v)) = rest.split_once('=') {
                (k.to_string(), Some(v.to_string()))
            } else {
                (rest.to_string(), None)
            };
            if key.is_empty() || !known.iter().any(|name| *name == key) {
                return Err(format!("unknown flag --{key}"));
            }
            let value = if let Some(v) = inline {
                v
            } else {
                i += 1;
                args.get(i)
                    .cloned()
                    .ok_or_else(|| format!("--{key} requires a value"))?
            };
            flags.entry(key).or_default().push(value);
        } else if arg.starts_with('-') {
            return Err(format!("unknown flag {arg}"));
        } else {
            positionals.push(arg.clone());
        }
        i += 1;
    }
    Ok(Parsed { positionals, flags })
}

fn one_positional<'a>(parsed: &'a Parsed, cmd: &str) -> Result<&'a str, String> {
    if parsed.positionals.len() != 1 {
        return Err(format!("usage: preflight {cmd} <artifact>\n{}", usage()));
    }
    Ok(parsed.positionals[0].as_str())
}

fn flag_one<'a>(parsed: &'a Parsed, name: &str) -> Option<&'a str> {
    parsed
        .flags
        .get(name)
        .and_then(|v| v.first())
        .map(String::as_str)
}

fn usage() -> String {
    format!(
        "\
preflight {VERSION}

Release clearance for Chromium extension builds.
Does this build still match the last shipped artifact and the claims made to users and stores?

Usage:
  preflight inventory <artifact>
  preflight diff <old-artifact> <new-artifact>
  preflight review <artifact> [--claims <claims.json>] [--baseline <artifact>] [--out <dir>] [--pack <id>] [--key <pf_live_...>]
  preflight retest <artifact> --last-review <review.json> --claims <claims.json> [--out <dir>] [--key <pf_live_...>]
  preflight push <artifact> --project <id> [--claims <claims.json>] [--key <pf_live_...>] [--api <url>]

Packs: {cws}, {node}
Verdicts: block | needs_human | ship_with_conditions
Exit 2 on high/blocker, 0 otherwise, 1 on error.
Never emits an automatic ship verdict.
",
        cws = rules::CWS_PACK,
        node = rules::NODE_PACK
    )
}
