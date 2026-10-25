export type Verdict = "block" | "needs_human" | "ship_with_conditions";

export type ReviewStatus = "queued" | "running" | "completed" | "failed";

export type Severity = "blocker" | "high" | "medium" | "low" | "info";

export type Finding = {
  id: string;
  controlId: string;
  pack: string;
  severity: Severity;
  file: string;
  field: string;
  line: number;
  snippet: string;
  title: string;
  summary: string;
};

export type ScanResult = {
  verdict: Verdict;
  findings: Finding[];
  inventory: unknown;
  report: unknown;
  markdown: string;
};

export type ScanRequest = {
  artifactPath: string;
  claimsPath?: string;
  baselinePath?: string;
  packs: string[];
  outDir: string;
};

export interface ScannerPort {
  review(input: ScanRequest): Promise<ScanResult>;
}

export type SignOffDecision = "ship" | "hold" | "reject";

export type SignOff = {
  reviewer: string;
  decision: SignOffDecision;
  notes: string;
  at: Date;
};

export type NewReview = {
  projectId: string;
  artifactName: string;
  artifactSha256: string;
  artifactPath: string;
  claims?: unknown;
  packs?: string[];
  submittedBy?: string | null;
};

export type Review = {
  id: string;
  projectId: string;
  status: ReviewStatus;
  verdict: Verdict | null;
  autoShip: false;
  artifactName: string;
  artifactSha256: string;
  artifactPath: string;
  claims: unknown | null;
  packs: string[];
  submittedBy?: string | null;
  findings: Finding[];
  inventory: unknown | null;
  report: unknown | null;
  markdown: string | null;
  error: string | null;
  signOff: SignOff | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

export interface ReviewRepository {
  save(review: Review): Promise<Review>;
  findById(id: string): Promise<Review | null>;
  findLatestBaselineByProject?(projectId: string, excludeReviewId: string): Promise<Review | null>;
}

export interface ReviewQueue {
  enqueue(reviewId: string): Promise<void>;
}

export type DomainEvent = {
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export interface EventPublisher {
  publish(event: DomainEvent): Promise<void>;
}
