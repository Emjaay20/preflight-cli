import { describe, expect, it } from "vitest";
import {
  completeReview,
  failReview,
  openReview,
  startReview,
} from "./review";
import type { ScanResult } from "./ports";

const scan = (overrides: Partial<ScanResult> = {}): ScanResult => ({
  verdict: "block",
  findings: [
    {
      id: "NODE-02:92d834b02f01",
      controlId: "NODE-02",
      pack: "node-client-2026.1",
      severity: "blocker",
      file: "manifest.json",
      field: "host_permissions",
      line: 1,
      snippet: "https://cdn.partner-analytics.example/*",
      title: "Host is not on the allowlist",
      summary: "Undeclared host.",
    },
  ],
  inventory: { name: "Harbor Node", version: "1.2.1" },
  report: { verdict: "block" },
  markdown: "# REVIEW\n",
  ...overrides,
});

describe("review lifecycle", () => {
  it("opens a review in queued state and never auto-ships", () => {
    const review = openReview({
      projectId: "proj_1",
      artifactName: "harbor-node.zip",
      artifactSha256: "abc",
      artifactPath: "/data/abc.zip",
    });

    expect(review.status).toBe("queued");
    expect(review.verdict).toBeNull();
    expect(review.autoShip).toBe(false);
  });

  it("can only start from queued", () => {
    const queued = openReview({
      projectId: "proj_1",
      artifactName: "a.zip",
      artifactSha256: "a",
      artifactPath: "/a.zip",
    });
    const running = startReview(queued);
    expect(running.status).toBe("running");
    expect(running.startedAt).toBeInstanceOf(Date);

    expect(() => startReview(running)).toThrow(/queued/);
  });

  it("records scanner output on complete and keeps autoShip false", () => {
    const running = startReview(
      openReview({
        projectId: "proj_1",
        artifactName: "a.zip",
        artifactSha256: "a",
        artifactPath: "/a.zip",
      }),
    );
    const completed = completeReview(running, scan());

    expect(completed.status).toBe("completed");
    expect(completed.verdict).toBe("block");
    expect(completed.findings).toHaveLength(1);
    expect(completed.findings[0].controlId).toBe("NODE-02");
    expect(completed.autoShip).toBe(false);
    expect(completed.completedAt).toBeInstanceOf(Date);
  });

  it("cannot complete a review that is still queued", () => {
    const queued = openReview({
      projectId: "proj_1",
      artifactName: "a.zip",
      artifactSha256: "a",
      artifactPath: "/a.zip",
    });
    expect(() => completeReview(queued, scan())).toThrow(/running/);
  });

  it("fails a running review with an error message", () => {
    const running = startReview(
      openReview({
        projectId: "proj_1",
        artifactName: "a.zip",
        artifactSha256: "a",
        artifactPath: "/a.zip",
      }),
    );
    const failed = failReview(running, "scanner exited 1");
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("scanner exited 1");
    expect(failed.verdict).toBeNull();
  });
});
