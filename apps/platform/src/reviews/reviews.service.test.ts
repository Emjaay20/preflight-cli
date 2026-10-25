import { describe, expect, it } from "vitest";
import {
  completeReview,
  startReview,
  type Review,
  type ReviewQueue,
  type ReviewRepository,
} from "@preflight/domain";
import {
  ReviewsService,
  type ProjectRecord,
  type ProjectRepository,
  type ArtifactStorage,
} from "./reviews.service";

class MemoryReviews implements ReviewRepository {
  store = new Map<string, Review>();
  async save(review: Review) {
    this.store.set(review.id, review);
    return review;
  }
  async findById(id: string) {
    return this.store.get(id) ?? null;
  }
}

class MemoryProjects implements ProjectRepository {
  private projects = new Map<string, ProjectRecord>();
  constructor(initial: ProjectRecord[]) {
    for (const p of initial) this.projects.set(p.id, p);
  }
  async findById(id: string) {
    return this.projects.get(id) ?? null;
  }
}

class MemoryQueue implements ReviewQueue {
  ids: string[] = [];
  async enqueue(reviewId: string) {
    this.ids.push(reviewId);
  }
}

class MemoryStorage implements ArtifactStorage {
  savedCalls: Array<{ organizationId?: string; projectId?: string; originalname: string }> = [];
  async save(file: {
    organizationId?: string;
    projectId?: string;
    originalname: string;
    buffer: Buffer;
  }) {
    this.savedCalls.push({
      organizationId: file.organizationId,
      projectId: file.projectId,
      originalname: file.originalname,
    });
    return {
      path: `/data/tenants/${file.organizationId}/projects/${file.projectId}/${file.originalname}`,
      sha256: "sha256-deadbeef",
    };
  }
}

describe("ReviewsService multi-tenant & multi-user isolation", () => {
  it("opens a queued review, partitions storage by tenant+project, and records the submitting actor", async () => {
    const reviews = new MemoryReviews();
    const queue = new MemoryQueue();
    const storage = new MemoryStorage();
    const service = new ReviewsService(
      reviews,
      new MemoryProjects([
        { id: "proj_1", organizationId: "org_1", name: "Harbor Node", slug: "harbor-node" },
      ]),
      queue,
      storage,
    );

    const review = await service.submit({
      organizationId: "org_1",
      projectId: "proj_1",
      file: { originalname: "harbor.zip", buffer: Buffer.from("zip") },
      claims: { allowed_hosts: ["relay.harbor.example"] },
      submittedBy: "alice (admin · pf_live_1111)",
    });

    expect(review.status).toBe("queued");
    expect(review.autoShip).toBe(false);
    expect(review.submittedBy).toBe("alice (admin · pf_live_1111)");
    expect(review.artifactSha256).toBe("sha256-deadbeef");
    expect(review.artifactPath).toBe("/data/tenants/org_1/projects/proj_1/harbor.zip");
    expect(storage.savedCalls).toEqual([
      { organizationId: "org_1", projectId: "proj_1", originalname: "harbor.zip" },
    ]);
    expect(queue.ids).toEqual([review.id]);
    expect(await reviews.findById(review.id)).toEqual(review);
  });

  it("inherits project-specific defaultClaims without mixing claims across projects in the same org", async () => {
    const reviews = new MemoryReviews();
    const service = new ReviewsService(
      reviews,
      new MemoryProjects([
        {
          id: "proj_wallet",
          organizationId: "org_1",
          name: "Wallet",
          slug: "wallet",
          defaultClaims: { allowed_hosts: ["api.wallet.example"] },
        },
        {
          id: "proj_relay",
          organizationId: "org_1",
          name: "Relay",
          slug: "relay",
          defaultClaims: { allowed_hosts: ["relay.harbor.example"] },
        },
      ]),
      new MemoryQueue(),
      new MemoryStorage(),
    );

    const walletReview = await service.submit({
      organizationId: "org_1",
      projectId: "proj_wallet",
      file: { originalname: "wallet.zip", buffer: Buffer.from("w") },
    });
    const relayReview = await service.submit({
      organizationId: "org_1",
      projectId: "proj_relay",
      file: { originalname: "relay.zip", buffer: Buffer.from("r") },
    });

    expect(walletReview.claims).toEqual({ allowed_hosts: ["api.wallet.example"] });
    expect(relayReview.claims).toEqual({ allowed_hosts: ["relay.harbor.example"] });
  });

  it("rejects submitting a build to a project owned by another organization", async () => {
    const service = new ReviewsService(
      new MemoryReviews(),
      new MemoryProjects([
        { id: "proj_1", organizationId: "org_1", name: "Harbor Node", slug: "harbor-node" },
      ]),
      new MemoryQueue(),
      new MemoryStorage(),
    );
    await expect(
      service.submit({
        organizationId: "org_other",
        projectId: "proj_1",
        file: { originalname: "x.zip", buffer: Buffer.from("x") },
      }),
    ).rejects.toThrow(/project/);
  });

  it("hides reviews and blocks sign-off across organizations and from CI keys", async () => {
    const reviews = new MemoryReviews();
    const service = new ReviewsService(
      reviews,
      new MemoryProjects([
        { id: "proj_1", organizationId: "org_1", name: "Harbor Node", slug: "harbor-node" },
      ]),
      new MemoryQueue(),
      new MemoryStorage(),
    );
    const queued = await service.submit({
      organizationId: "org_1",
      projectId: "proj_1",
      file: { originalname: "a.zip", buffer: Buffer.from("a") },
    });
    const completed = completeReview(startReview(queued), {
      verdict: "ship_with_conditions",
      findings: [],
      inventory: {},
      report: {},
      markdown: "# REVIEW",
    });
    await reviews.save(completed);

    // Tenant B cannot view or sign off Tenant A's review
    expect(await service.getForOrg(completed.id, "org_1")).not.toBeNull();
    expect(await service.getForOrg(completed.id, "org_other")).toBeNull();
    await expect(
      service.signOff(completed.id, "org_other", {
        reviewer: "Intruder",
        decision: "ship",
        notes: "spoof",
        role: "admin",
      }),
    ).rejects.toThrow(/not found/);

    // Tenant A's CI key cannot sign off a human release decision
    await expect(
      service.signOff(completed.id, "org_1", {
        reviewer: "github-actions",
        decision: "ship",
        notes: "auto",
        role: "ci",
      }),
    ).rejects.toThrow(/CI keys cannot sign off/);

    // Tenant A's human reviewer key signs off and records verified key identity
    const signed = await service.signOff(completed.id, "org_1", {
      reviewer: "Alice",
      decision: "ship",
      notes: "Cleared for CWS upload",
      role: "reviewer",
      keyIdentity: "alice-release/pf_live_abcd",
    });
    expect(signed.signOff?.reviewer).toBe("Alice (alice-release/pf_live_abcd)");
    expect(signed.signOff?.decision).toBe("ship");
  });
});
