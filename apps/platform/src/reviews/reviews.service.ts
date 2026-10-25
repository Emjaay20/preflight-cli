import {
  openReview,
  signOffReview,
  type ApiKeyRole,
  type Review,
  type ReviewQueue,
  type ReviewRepository,
  type SignOffDecision,
} from "@preflight/domain";

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  defaultClaims?: unknown | null;
};

export interface ProjectRepository {
  findById(id: string): Promise<ProjectRecord | null>;
  listByOrg?(organizationId: string): Promise<ProjectRecord[]>;
  updateDefaultClaims?(
    organizationId: string,
    projectId: string,
    defaultClaims: unknown | null,
  ): Promise<ProjectRecord | null>;
}

export interface ArtifactStorage {
  save(file: {
    organizationId?: string;
    projectId?: string;
    originalname: string;
    buffer: Buffer;
  }): Promise<{ path: string; sha256: string }>;

  materialize?(ref: {
    sha256: string;
    artifactPath: string;
    preferredName?: string;
  }): Promise<{ localPath: string; cleanup: () => Promise<void> }>;

  getBlob?(sha256: string): Promise<Buffer | null>;
}

export type SubmitReviewInput = {
  organizationId: string;
  projectId: string;
  file: { originalname: string; buffer: Buffer };
  claims?: unknown;
  packs?: string[];
  submittedBy?: string | null;
};

export class ReviewsService {
  constructor(
    private readonly reviews: ReviewRepository,
    private readonly projects: ProjectRepository,
    private readonly queue: ReviewQueue,
    private readonly storage: ArtifactStorage,
  ) {}

  async submit(input: SubmitReviewInput): Promise<Review> {
    const project = await this.projects.findById(input.projectId);
    if (!project || project.organizationId !== input.organizationId) {
      throw new Error("project not found");
    }
    const stored = await this.storage.save({
      organizationId: input.organizationId,
      projectId: project.id,
      originalname: input.file.originalname,
      buffer: input.file.buffer,
    });
    const effectiveClaims =
      input.claims !== undefined ? input.claims : (project.defaultClaims ?? undefined);
    const review = openReview({
      projectId: project.id,
      artifactName: input.file.originalname,
      artifactSha256: stored.sha256,
      artifactPath: stored.path,
      claims: effectiveClaims,
      packs: input.packs,
      submittedBy: input.submittedBy ?? null,
    });
    await this.reviews.save(review);
    await this.queue.enqueue(review.id);
    return review;
  }

  async get(id: string): Promise<Review | null> {
    return this.reviews.findById(id);
  }

  async getForOrg(id: string, organizationId: string): Promise<Review | null> {
    const review = await this.reviews.findById(id);
    if (!review) return null;
    const project = await this.projects.findById(review.projectId);
    if (!project || project.organizationId !== organizationId) return null;
    return review;
  }

  async signOff(
    id: string,
    organizationId: string,
    input: {
      reviewer: string;
      decision: SignOffDecision;
      notes: string;
      role?: ApiKeyRole;
      keyIdentity?: string;
    },
  ): Promise<Review> {
    const review = await this.getForOrg(id, organizationId);
    if (!review) throw new Error("review not found");
    const signed = signOffReview(review, input);
    return this.reviews.save(signed);
  }
}
