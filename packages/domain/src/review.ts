import { randomUUID } from "node:crypto";
import { canSignOff, type ApiKeyRole } from "./api-key";
import type { NewReview, Review, ScanResult, SignOffDecision } from "./ports";

const DEFAULT_PACKS = ["cws-2026.1", "node-client-2026.1"];

export function openReview(input: NewReview): Review {
  return {
    id: randomUUID(),
    projectId: input.projectId,
    status: "queued",
    verdict: null,
    autoShip: false,
    artifactName: input.artifactName,
    artifactSha256: input.artifactSha256,
    artifactPath: input.artifactPath,
    claims: input.claims ?? null,
    packs: input.packs ?? DEFAULT_PACKS,
    submittedBy: input.submittedBy ?? null,
    findings: [],
    inventory: null,
    report: null,
    markdown: null,
    error: null,
    signOff: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  };
}

export function startReview(review: Review): Review {
  if (review.status !== "queued") {
    throw new Error(`review ${review.id} must be queued to start (was ${review.status})`);
  }
  return {
    ...review,
    status: "running",
    startedAt: new Date(),
  };
}

export function completeReview(review: Review, result: ScanResult): Review {
  if (review.status !== "running") {
    throw new Error(`review ${review.id} must be running to complete (was ${review.status})`);
  }
  return {
    ...review,
    status: "completed",
    verdict: result.verdict,
    autoShip: false,
    findings: result.findings,
    inventory: result.inventory,
    report: result.report,
    markdown: result.markdown,
    error: null,
    completedAt: new Date(),
  };
}

export function failReview(review: Review, error: string): Review {
  if (review.status !== "running" && review.status !== "queued") {
    throw new Error(`review ${review.id} cannot fail from ${review.status}`);
  }
  return {
    ...review,
    status: "failed",
    error,
    completedAt: new Date(),
  };
}

export function signOffReview(
  review: Review,
  input: {
    reviewer: string;
    decision: SignOffDecision;
    notes: string;
    role?: ApiKeyRole;
    keyIdentity?: string;
  },
): Review {
  if (input.role && !canSignOff(input.role)) {
    throw new Error("CI keys cannot sign off a review; human reviewer or admin role required");
  }
  if (review.status !== "completed") {
    throw new Error("can only sign off a completed review");
  }
  if (review.verdict === "block" && input.decision === "ship") {
    throw new Error("cannot ship a blocked review");
  }
  const rawReviewer = input.reviewer.trim();
  if (!rawReviewer) throw new Error("reviewer is required");
  const reviewer = input.keyIdentity
    ? `${rawReviewer} (${input.keyIdentity})`
    : rawReviewer;
  return {
    ...review,
    autoShip: false,
    signOff: {
      reviewer,
      decision: input.decision,
      notes: input.notes.trim(),
      at: new Date(),
    },
  };
}
