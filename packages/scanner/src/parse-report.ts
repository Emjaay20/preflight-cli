import type { Finding, ScanResult, Severity, Verdict } from "@preflight/domain";

const VERDICTS: Verdict[] = ["block", "needs_human", "ship_with_conditions"];
const SEVERITIES: Severity[] = ["blocker", "high", "medium", "low", "info"];

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("review report must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`review report missing string field ${field}`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`review report missing number field ${field}`);
  }
  return value;
}

function parseVerdict(value: unknown): Verdict {
  if (typeof value !== "string" || !VERDICTS.includes(value as Verdict)) {
    throw new Error(`unknown verdict: ${String(value)}`);
  }
  return value as Verdict;
}

function parseSeverity(value: unknown): Severity {
  if (typeof value !== "string" || !SEVERITIES.includes(value as Severity)) {
    throw new Error(`unknown severity: ${String(value)}`);
  }
  return value as Severity;
}

function parseFinding(value: unknown): Finding {
  const row = asRecord(value);
  return {
    id: asString(row.id, "finding.id"),
    controlId: asString(row.control_id, "finding.control_id"),
    pack: asString(row.pack, "finding.pack"),
    severity: parseSeverity(row.severity),
    file: asString(row.file, "finding.file"),
    field: asString(row.field, "finding.field"),
    line: asNumber(row.line, "finding.line"),
    snippet: typeof row.snippet === "string" ? row.snippet : "",
    title: asString(row.title, "finding.title"),
    summary: asString(row.summary, "finding.summary"),
  };
}

export function parseReviewReport(raw: unknown, markdown: string): ScanResult {
  const report = asRecord(raw);
  if (!Array.isArray(report.findings)) {
    throw new Error("review report missing findings array");
  }
  return {
    verdict: parseVerdict(report.verdict),
    findings: report.findings.map(parseFinding),
    inventory: report.inventory ?? null,
    report,
    markdown,
  };
}
