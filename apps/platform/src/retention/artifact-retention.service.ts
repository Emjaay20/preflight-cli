import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CasArtifactStorage } from "../cas/cas-artifact-storage";
import { PrismaService } from "../prisma.service";
import type { ArtifactStorage } from "../reviews/reviews.service";
import { TOKENS } from "../tokens";

const EXPIRED_ARTIFACT_PREFIX = "expired://";

@Injectable()
export class ArtifactRetentionService {
  private readonly logger = new Logger(ArtifactRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOKENS.ArtifactStorage) private readonly storage: ArtifactStorage,
    private readonly casStorage: CasArtifactStorage,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async enforce(): Promise<void> {
    const result = await this.runOnce();
    if (result.expired > 0) {
      this.logger.log(`retention expired ${result.expired} artifact(s); reclaimed ${result.blobs} CAS blob(s)`);
    }
  }

  async runOnce(limit = 100): Promise<{ expired: number; blobs: number }> {
    const now = new Date();
    const candidates = await this.prisma.review.findMany({
      where: {
        status: { in: ["completed", "failed"] },
        artifactPath: { not: { startsWith: EXPIRED_ARTIFACT_PREFIX } },
      },
      include: { project: { include: { organization: true } } },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let expired = 0;
    let blobs = 0;
    for (const review of candidates) {
      const cutoff = new Date(now.getTime() - review.project.organization.retentionDays * 24 * 60 * 60 * 1000);
      if (review.createdAt > cutoff) continue;

      // The metadata and audit trail survive retention. Only the original
      // customer artifact is removed, so historical verdicts remain useful.
      const removed = await this.storage.deleteArtifact?.({ artifactPath: review.artifactPath });
      if (removed !== true) {
        this.logger.warn(`retention could not remove artifact for review ${review.id}`);
        continue;
      }

      const updated = await this.prisma.review.updateMany({
        where: { id: review.id, artifactPath: review.artifactPath },
        data: { artifactPath: `${EXPIRED_ARTIFACT_PREFIX}${review.artifactSha256}` },
      });
      if (updated.count !== 1) continue;
      expired += 1;
      await this.prisma.auditEvent.create({
        data: {
          organizationId: review.project.organizationId,
          actor: "retention-worker",
          action: "artifact.expired",
          targetType: "review",
          targetId: review.id,
          metadata: { sha256: review.artifactSha256, retentionDays: review.project.organization.retentionDays },
        },
      });

      // CAS is content-addressed and may be shared by several active reviews.
      // Delete a blob only when no non-expired review still references it.
      const activeReferences = await this.prisma.review.count({
        where: {
          artifactSha256: review.artifactSha256,
          artifactPath: { not: { startsWith: EXPIRED_ARTIFACT_PREFIX } },
        },
      });
      if (activeReferences === 0 && (await this.casStorage.getCasEngine().delete(review.artifactSha256))) {
        blobs += 1;
      }
    }
    return { expired, blobs };
  }
}
