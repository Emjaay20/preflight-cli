import { describe, expect, it, vi } from "vitest";
import { ArtifactRetentionService } from "./artifact-retention.service";

describe("ArtifactRetentionService", () => {
  it("removes only expired artifact bytes while retaining review metadata", async () => {
    const review = {
      id: "review-1",
      artifactPath: "/data/tenants/org/projects/project/artifacts/one/build.zip",
      artifactSha256: "a".repeat(64),
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      project: { organizationId: "org-1", organization: { retentionDays: 14 } },
    };
    const prisma = {
      review: {
        findMany: vi.fn().mockResolvedValue([review]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        count: vi.fn().mockResolvedValue(0),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const storage = { deleteArtifact: vi.fn().mockResolvedValue(true) };
    const casStorage = { getCasEngine: () => ({ delete: vi.fn().mockResolvedValue(true) }) };
    const service = new ArtifactRetentionService(prisma as never, storage, casStorage as never);

    await expect(service.runOnce()).resolves.toEqual({ expired: 1, blobs: 1 });
    expect(storage.deleteArtifact).toHaveBeenCalledWith({ artifactPath: review.artifactPath });
    expect(prisma.review.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { artifactPath: `expired://${review.artifactSha256}` },
    }));
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });
});
