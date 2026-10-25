import { describe, expect, it } from "vitest";
import { completeReview, openReview, startReview } from "./review";
import { reviewCompletedEvent } from "./events";
import type { ScanResult } from "./ports";

describe("outbox events", () => {
  it("emits ReviewCompleted with verdict and finding count, never ship", () => {
    const completed = completeReview(
      startReview(
        openReview({
          projectId: "proj_harbor",
          artifactName: "harbor.zip",
          artifactSha256: "deadbeef",
          artifactPath: "/data/harbor.zip",
        }),
      ),
      {
        verdict: "ship_with_conditions",
        findings: [],
        inventory: { name: "Harbor Node" },
        report: {},
        markdown: "# REVIEW\n",
      } satisfies ScanResult,
    );

    const event = reviewCompletedEvent(completed);

    expect(event.type).toBe("review.completed");
    expect(event.payload.verdict).toBe("ship_with_conditions");
    expect(event.payload.findingCount).toBe(0);
    expect(event.payload.autoShip).toBe(false);
    expect(event.payload.projectId).toBe("proj_harbor");
  });
});
