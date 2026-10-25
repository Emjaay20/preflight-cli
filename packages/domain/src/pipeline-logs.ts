import type { Review } from "./ports";

export type AgentStageStatus = "pass" | "warn" | "block" | "running" | "pending";

export type AgentLogEntry = {
  step: number;
  agentId: string;
  name: string;
  module: string;
  status: AgentStageStatus;
  headline: string;
  detail: string;
};

type InventoryShape = {
  name?: string;
  version?: string;
  manifest_version?: number | null;
  permissions?: string[];
  host_permissions?: string[];
  destinations?: string[];
  files?: string[];
  missing_files?: string[];
  signals?: {
    has_consent_gate?: boolean;
    has_kill_switch?: boolean;
    has_disclosure?: boolean;
    opens_socket_with_consent_false?: boolean;
    has_eval?: boolean;
    has_remote_script?: boolean;
    has_cleartext_http?: boolean;
  };
};

export function buildPipelineLogs(review: Review): AgentLogEntry[] {
  const isPending = review.status === "queued" || review.status === "running";
  const isFailed = review.status === "failed";
  const inv = (review.inventory ?? {}) as InventoryShape;
  const findings = review.findings ?? [];

  const shaShort = (review.artifactSha256 || "").slice(0, 12) || "pending";
  const stage1: AgentLogEntry = {
    step: 1,
    agentId: "agent:01:artifact-gate",
    name: "Artifact Gate & Hasher",
    module: "src/artifact.rs · src/hashutil.rs",
    status: isFailed ? "block" : "pass",
    headline: `Verified archive ${review.artifactName} (sha256:${shaShort}…)`,
    detail: review.submittedBy
      ? `Isolated in tenant workspace · submitted by ${review.submittedBy}.`
      : "Isolated in tenant workspace · zero untrusted code execution.",
  };

  if (isPending) {
    return [
      stage1,
      {
        step: 2,
        agentId: "agent:02:static-extractor",
        name: "Static Evidence Extractor",
        module: "src/inventory.rs · src/extract.rs",
        status: "running",
        headline: "Walking manifest.json, HTML, and JS AST tokens out-of-process…",
        detail: "Extracting permissions, host patterns, network sockets, and consent gates.",
      },
      {
        step: 3,
        agentId: "agent:03:baseline-diff",
        name: "Baseline Capability Diff",
        module: "src/diff.rs",
        status: "pending",
        headline: "Waiting to compare against project baseline artifact…",
        detail: "Checks for newly introduced permissions (DIFF-01) and hosts (DIFF-02).",
      },
      {
        step: 4,
        agentId: "agent:04:policy-auditor",
        name: "Policy & Claims Auditor",
        module: "src/rules.rs",
        status: "pending",
        headline: `Queued packs: ${(review.packs || []).join(", ")}`,
        detail: "Cross-checks extracted capabilities against declared store claims.",
      },
      {
        step: 5,
        agentId: "agent:05:release-arbiter",
        name: "Release Clearance Arbiter",
        module: "src/review.rs · ADR-0003",
        status: "pending",
        headline: "Awaiting rule evaluation (auto_ship=false)",
        detail: "Will emit block, needs_human, or ship_with_conditions.",
      },
    ];
  }

  const perms = inv.permissions ?? [];
  const hosts = inv.host_permissions ?? [];
  const dests = inv.destinations ?? [];
  const sig = inv.signals ?? {};
  const hasDangerousCode = Boolean(
    sig.has_eval || sig.has_remote_script || sig.opens_socket_with_consent_false,
  );

  const stage2: AgentLogEntry = {
    step: 2,
    agentId: "agent:02:static-extractor",
    name: "Static Evidence Extractor",
    module: "src/inventory.rs · src/extract.rs",
    status: hasDangerousCode ? "block" : "pass",
    headline: `Parsed ${inv.name || review.artifactName} v${inv.version || "?"} (MV${inv.manifest_version ?? "?"}): ${perms.length} perms, ${hosts.length} hosts, ${dests.length} network endpoints`,
    detail: `Signals: consent_gate=${Boolean(sig.has_consent_gate)}, kill_switch=${Boolean(sig.has_kill_switch)}, disclosure=${Boolean(sig.has_disclosure)}, eval=${Boolean(sig.has_eval)}, remote_script=${Boolean(sig.has_remote_script)}.`,
  };

  const diffFindings = findings.filter((f) => f.controlId.startsWith("DIFF-"));
  const stage3: AgentLogEntry = {
    step: 3,
    agentId: "agent:03:baseline-diff",
    name: "Baseline Capability Diff",
    module: "src/diff.rs",
    status: diffFindings.length > 0 ? "warn" : "pass",
    headline:
      diffFindings.length > 0
        ? `Detected ${diffFindings.length} capability drift change(s) since project baseline`
        : "No undeclared permission or host drift against project baseline",
    detail:
      diffFindings.length > 0
        ? diffFindings.map((f) => `${f.controlId}: ${f.summary}`).join(" | ")
        : "Compared against project's latest cleared build.",
  };

  const blockers = findings.filter((f) => f.severity === "blocker" || f.severity === "high");
  const mediums = findings.filter((f) => f.severity === "medium");
  const stage4Status: AgentStageStatus =
    blockers.length > 0 ? "block" : mediums.length > 0 ? "warn" : "pass";

  const stage4: AgentLogEntry = {
    step: 4,
    agentId: "agent:04:policy-auditor",
    name: "Policy & Claims Auditor",
    module: "src/rules.rs",
    status: stage4Status,
    headline:
      findings.length === 0
        ? `All controls passed across ${(review.packs || []).join(", ")}`
        : `${findings.length} finding(s): ${blockers.length} high/blocker, ${mediums.length} medium`,
    detail:
      findings.length === 0
        ? "Every host permission, network socket, and API call matches claims.json."
        : findings.map((f) => `[${f.controlId}/${f.severity}] ${f.title}`).join(" · "),
  };

  const verdict = review.verdict ?? "needs_human";
  const stage5Status: AgentStageStatus =
    verdict === "block" ? "block" : verdict === "needs_human" ? "warn" : "pass";

  const stage5: AgentLogEntry = {
    step: 5,
    agentId: "agent:05:release-arbiter",
    name: "Release Clearance Arbiter",
    module: "src/review.rs · ADR-0003",
    status: stage5Status,
    headline: `Verdict: ${verdict.toUpperCase()} (auto_ship=false)`,
    detail: review.signOff
      ? `Human sign-off recorded by ${review.signOff.reviewer}: ${review.signOff.decision.toUpperCase()} (${review.signOff.notes || "no notes"}).`
      : verdict === "block"
        ? "Release blocked. High/blocker findings must be resolved before human sign-off."
        : "Cleared by static analysis; awaiting mandatory human sign-off.",
  };

  return [stage1, stage2, stage3, stage4, stage5];
}
