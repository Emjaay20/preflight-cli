use std::path::PathBuf;

use crate::artifact;
use crate::claims::{self, Claims};
use crate::diff::{self, InventoryDiff};
use crate::finding::{Finding, Severity};
use crate::inventory::Inventory;
use crate::jsonutil::{parse, Json};
use crate::rules;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Block,
    NeedsHuman,
    ShipWithConditions,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Block => "block",
            Self::NeedsHuman => "needs_human",
            Self::ShipWithConditions => "ship_with_conditions",
        }
    }

    pub fn exit_code(self) -> i32 {
        match self {
            Self::Block => 2,
            Self::NeedsHuman | Self::ShipWithConditions => 0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Retest {
    pub resolved: Vec<String>,
    pub open: Vec<String>,
    pub introduced: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Review {
    pub artifact: String,
    pub packs: Vec<String>,
    pub verdict: Verdict,
    pub inventory: Inventory,
    pub baseline_diff: Option<InventoryDiff>,
    pub claims_present: bool,
    pub findings: Vec<Finding>,
    pub retest: Option<Retest>,
}

pub struct ReviewRequest {
    pub artifact: PathBuf,
    pub claims: Option<PathBuf>,
    pub baseline: Option<PathBuf>,
    pub packs: Vec<String>,
    pub last_review: Option<PathBuf>,
}

pub fn review(req: &ReviewRequest) -> Result<Review, String> {
    let packs = if req.packs.is_empty() {
        rules::default_packs()
    } else {
        for pack in &req.packs {
            if !rules::known_pack(pack) {
                return Err(format!("unknown pack '{pack}'"));
            }
        }
        req.packs.clone()
    };
    let loaded = artifact::load(&req.artifact)?;
    let inventory = crate::inventory::build(&loaded)?;
    let claims = match &req.claims {
        Some(path) => Some(claims::load(path)?),
        None => None,
    };
    let baseline_diff = match &req.baseline {
        Some(path) => {
            let baseline = artifact::load(path)?;
            let baseline_inv = crate::inventory::build(&baseline)?;
            Some(diff::diff_inventories(&baseline_inv, &inventory))
        }
        None => None,
    };
    let findings = rules::run(&inventory, claims.as_ref(), baseline_diff.as_ref(), &packs);
    let verdict = decide(&findings, claims.as_ref());
    let retest = match &req.last_review {
        Some(path) => Some(compare_last(path, &findings)?),
        None => None,
    };
    Ok(Review {
        artifact: req.artifact.display().to_string(),
        packs,
        verdict,
        inventory,
        baseline_diff,
        claims_present: claims.is_some(),
        findings,
        retest,
    })
}

pub fn decide(findings: &[Finding], claims: Option<&Claims>) -> Verdict {
    if findings
        .iter()
        .any(|f| matches!(f.severity, Severity::Blocker | Severity::High))
    {
        return Verdict::Block;
    }
    if claims.is_none()
        || claims.map(|c| !c.is_complete()).unwrap_or(false)
        || findings.iter().any(|f| f.severity == Severity::Medium)
    {
        return Verdict::NeedsHuman;
    }
    Verdict::ShipWithConditions
}

fn compare_last(path: &std::path::Path, findings: &[Finding]) -> Result<Retest, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("read last review {}: {e}", path.display()))?;
    let json = parse(&text).map_err(|e| format!("last review {}: {e}", path.display()))?;
    let mut previous = Vec::new();
    if let Some(items) = json.get("findings").and_then(Json::as_array) {
        for item in items {
            if let Some(id) = item.get("id").and_then(Json::as_str) {
                previous.push(id.to_string());
            }
        }
    }
    previous.sort();
    previous.dedup();
    let mut current: Vec<String> = findings.iter().map(|f| f.id.clone()).collect();
    current.sort();
    current.dedup();
    let resolved = previous
        .iter()
        .filter(|id| !current.iter().any(|cur| cur == *id))
        .cloned()
        .collect();
    let open = previous
        .iter()
        .filter(|id| current.iter().any(|cur| cur == *id))
        .cloned()
        .collect();
    let introduced = current
        .iter()
        .filter(|id| !previous.iter().any(|old| old == *id))
        .cloned()
        .collect();
    Ok(Retest {
        resolved,
        open,
        introduced,
    })
}
