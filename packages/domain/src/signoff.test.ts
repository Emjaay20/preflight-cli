import { describe, expect, it } from "vitest";
import { completeReview, openReview, signOffReview, startReview } from "./review";

describe("sign-off", () => {
  it("records a human decision on a completed review", () => {
    const completed = completeReview(
      startReview(
        openReview({
          projectId: "p",
          artifactName: "a.zip",
          artifactSha256: "a",
          artifactPath: "/a.zip",
        }),
      ),
      {
        verdict: "ship_with_conditions",
        findings: [],
        inventory: {},
        report: {},
        markdown: "# REVIEW\n",
      },
    );
    const signed = signOffReview(completed, {
      reviewer: "yusuf",
      decision: "ship",
      notes: "matches listing",
    });
    expect(signed.signOff?.reviewer).toBe("yusuf");
    expect(signed.signOff?.decision).toBe("ship");
    expect(signed.autoShip).toBe(false);
  });

  it("refuses to ship a blocked review", () => {
    const blocked = completeReview(
      startReview(
        openReview({
          projectId: "p",
          artifactName: "a.zip",
          artifactSha256: "a",
          artifactPath: "/a.zip",
        }),
      ),
      {
        verdict: "block",
        findings: [],
        inventory: {},
        report: {},
        markdown: "# REVIEW\n",
      },
    );
    expect(() =>
      signOffReview(blocked, { reviewer: "yusuf", decision: "ship", notes: "" }),
    ).toThrow(/blocked/);
  });

  it("cannot sign off a queued review", () => {
    const queued = openReview({
      projectId: "p",
      artifactName: "a.zip",
      artifactSha256: "a",
      artifactPath: "/a.zip",
    });
    expect(() =>
      signOffReview(queued, { reviewer: "yusuf", decision: "hold", notes: "" }),
    ).toThrow(/completed/);
  });

  it("refuses sign-off from a CI key and records authenticated key identity for human reviewers", () => {
    const completed = completeReview(
      startReview(
        openReview({
          projectId: "p",
          artifactName: "a.zip",
          artifactSha256: "a",
          artifactPath: "/a.zip",
        }),
      ),
      {
        verdict: "ship_with_conditions",
        findings: [],
        inventory: {},
        report: {},
        markdown: "# REVIEW\n",
      },
    );

    expect(() =>
      signOffReview(completed, {
        reviewer: "github-actions",
        decision: "ship",
        notes: "auto",
        role: "ci",
      }),
    ).toThrow(/CI keys cannot sign off/);

    const signed = signOffReview(completed, {
      reviewer: "Alice",
      decision: "ship",
      notes: "verified",
      role: "reviewer",
      keyIdentity: "alice-release/pf_live_abc123",
    });
    expect(signed.signOff?.reviewer).toBe("Alice (alice-release/pf_live_abc123)");
  });
});
