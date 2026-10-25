import { describe, expect, it } from "vitest";
import { parseReviewReport } from "./parse-report";

const sample = {
  tool: "preflight",
  tool_version: "0.1.0",
  auto_ship: false,
  artifact: "fixtures/harbor-node/extra-host",
  packs: ["cws-2026.1", "node-client-2026.1"],
  verdict: "block",
  exit_code: 2,
  claims_present: true,
  inventory: { name: "Harbor Node", version: "1.2.1" },
  findings: [
    {
      id: "NODE-02:92d834b02f01",
      control_id: "NODE-02",
      pack: "node-client-2026.1",
      severity: "blocker",
      file: "manifest.json",
      field: "host_permissions",
      line: 1,
      snippet: "https://cdn.partner-analytics.example/*",
      title: "Host is not on the allowlist",
      summary: "Not covered by claims.allowed_hosts.",
    },
  ],
};

describe("parseReviewReport", () => {
  it("maps CLI JSON into the domain ScanResult", () => {
    const result = parseReviewReport(sample, "# REVIEW\n");
    expect(result.verdict).toBe("block");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      id: "NODE-02:92d834b02f01",
      controlId: "NODE-02",
      severity: "blocker",
    });
    expect(result.markdown).toBe("# REVIEW\n");
    expect(result.report).toEqual(sample);
  });

  it("rejects unknown verdicts", () => {
    expect(() => parseReviewReport({ ...sample, verdict: "ship" }, "")).toThrow(
      /verdict/,
    );
  });

  it("rejects missing findings array", () => {
    const { findings: _, ...rest } = sample;
    expect(() => parseReviewReport(rest, "")).toThrow(/findings/);
  });
});
