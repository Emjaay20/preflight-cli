import type { DomainEvent, Review } from "./ports";

export function reviewCompletedEvent(review: Review): DomainEvent {
  if (review.status !== "completed" || review.verdict === null) {
    throw new Error("ReviewCompleted requires a completed review with a verdict");
  }
  return {
    type: "review.completed",
    occurredAt: review.completedAt ?? new Date(),
    payload: {
      reviewId: review.id,
      projectId: review.projectId,
      verdict: review.verdict,
      findingCount: review.findings.length,
      autoShip: false,
      artifactSha256: review.artifactSha256,
    },
  };
}

export function reviewFailedEvent(review: Review): DomainEvent {
  return {
    type: "review.failed",
    occurredAt: review.completedAt ?? new Date(),
    payload: {
      reviewId: review.id,
      projectId: review.projectId,
      error: review.error ?? "unknown",
    },
  };
}
