import { describe, expect, it } from "vitest";
import {
  buildPipelineLogs,
  completeReview,
  openReview,
  parseAccountType,
  startReview,
} from "./index";

describe("account types & structured agent pipeline logs", () => {
  it("parses organization and individual account types", () => {
    expect(parseAccountType(undefined)).toBe("organization");
    expect(parseAccountType("organization")).toBe("organization");
    expect(parseAccountType("individual")).toBe("individual");
    expect(() => parseAccountType("enterprise")).toThrow(/invalid account type/);
  });

  it("emits 5 structured agent logs explaining each stage of a review", () => {
    const queued = openReview({
      projectId: "proj_1",
      artifactName: "harbor.zip",
      artifactSha256: "abcdef1234567890",
      artifactPath: "/tmp/harbor.zip",
      submittedBy: "alice (admin · pf_live_abcd)",
    });

    const pendingLogs = buildPipelineLogs(queued);
    expect(pendingLogs).toHaveLength(5);
    expect(pendingLogs[0].agentId).toBe("agent:01:artifact-gate");
    expect(pendingLogs[0].status).toBe("pass");
    expect(pendingLogs[1].status).toBe("running");

    const completed = completeReview(startReview(queued), {
      verdict: "block",
      findings: [
        {
          id: "NODE-02:123",
          controlId: "NODE-02",
          pack: "node-client-2026.1",
          severity: "blocker",
          file: "manifest.json",
          field: "host_permissions",
          line: 1,
          snippet: "https://cdn.partner.example/*",
          title: "Host is not on the allowlist",
          summary: "Not covered by claims.allowed_hosts.",
        },
      ],
      inventory: {
        name: "Harbor Node",
        version: "0.4.2",
        manifest_version: 3,
        permissions: ["storage", "alarms"],
        host_permissions: ["https://cdn.partner.example/*"],
        destinations: ["wss://relay.harbor.example/v1/tunnel"],
        signals: {
          has_consent_gate: true,
          has_kill_switch: true,
          has_disclosure: true,
        },
      },
      report: {},
      markdown: "# REVIEW",
    });

    const doneLogs = buildPipelineLogs(completed);
    expect(doneLogs).toHaveLength(5);
    expect(doneLogs[1].headline).toContain("Harbor Node v0.4.2 (MV3)");
    expect(doneLogs[3].status).toBe("block");
    expect(doneLogs[3].detail).toContain("NODE-02/blocker");
    expect(doneLogs[4].status).toBe("block");
    expect(doneLogs[4].headline).toContain("BLOCK (auto_ship=false)");
  });
});
