import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger, Optional } from "@nestjs/common";
import { Job } from "bullmq";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  completeReview,
  failReview,
  reviewCompletedEvent,
  reviewFailedEvent,
  startReview,
  type ReviewRepository,
  type ScannerPort,
} from "@preflight/domain";
import { TOKENS } from "../tokens";
import { PrismaReviewRepository } from "../persistence/prisma-repos";
import { REVIEW_QUEUE_NAME } from "./bull-review.queue";
import { reviewsProcessed } from "../observability/metrics";
import type { ArtifactStorage } from "../reviews/reviews.service";

@Processor(REVIEW_QUEUE_NAME)
export class ReviewProcessor extends WorkerHost {
  private readonly log = new Logger(ReviewProcessor.name);

  constructor(
    @Inject(TOKENS.ReviewRepository) private readonly reviews: ReviewRepository,
    @Inject(TOKENS.Scanner) private readonly scanner: ScannerPort,
    private readonly persisted: PrismaReviewRepository,
    @Optional() @Inject(TOKENS.ArtifactStorage) private readonly storage?: ArtifactStorage,
  ) {
    super();
  }

  async process(job: Job<{ reviewId: string }>): Promise<void> {
    const review = await this.reviews.findById(job.data.reviewId);
    if (!review) {
      throw new Error(`review ${job.data.reviewId} not found`);
    }
    const running = startReview(review);
    await this.reviews.save(running);

    // Isolated scratch workspace for this worker run
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `preflight-job-${running.id}-`));
    const outDir = path.join(workspace, "out");
    await fs.mkdir(outDir, { recursive: true });

    let claimsPath: string | undefined;
    let baselinePath: string | undefined;
    let artifactCleanup: (() => Promise<void>) | undefined;
    let baselineCleanup: (() => Promise<void>) | undefined;

    try {
      // 1. Materialize target artifact (from local disk or content-addressable storage / remote)
      let localArtifactPath = running.artifactPath;
      if (this.storage?.materialize) {
        const mat = await this.storage.materialize({
          sha256: running.artifactSha256,
          artifactPath: running.artifactPath,
          preferredName: running.artifactName,
        });
        artifactCleanup = mat.cleanup;
        localArtifactPath = mat.localPath;
      }

      // 2. Write claims into isolated workspace
      if (running.claims) {
        claimsPath = path.join(workspace, "claims.json");
        await fs.writeFile(claimsPath, JSON.stringify(running.claims, null, 2));
      }

      // 3. Find and materialize baseline artifact if available
      if (this.reviews.findLatestBaselineByProject) {
        const baseline = await this.reviews.findLatestBaselineByProject(
          running.projectId,
          running.id,
        );
        if (baseline) {
          if (this.storage?.materialize) {
            try {
              const bMat = await this.storage.materialize({
                sha256: baseline.artifactSha256,
                artifactPath: baseline.artifactPath,
                preferredName: baseline.artifactName,
              });
              baselineCleanup = bMat.cleanup;
              baselinePath = bMat.localPath;
            } catch (bErr) {
              this.log.warn(`Could not materialize baseline ${baseline.id}: ${bErr}`);
            }
          } else if (baseline.artifactPath) {
            const exists = await fs
              .stat(baseline.artifactPath)
              .then(() => true)
              .catch(() => false);
            if (exists) {
              baselinePath = baseline.artifactPath;
            }
          }
        }
      }

      // 4. Run Rust scanner against isolated workspace
      const result = await this.scanner.review({
        artifactPath: localArtifactPath,
        claimsPath,
        baselinePath,
        packs: running.packs,
        outDir,
      });

      const completed = completeReview(running, result);
      await this.reviews.save(completed);
      await this.persisted.saveOutbox(completed.id, reviewCompletedEvent(completed));
      reviewsProcessed.inc({ verdict: completed.verdict ?? "unknown" });
      this.log.log(`review completed ${completed.id} verdict=${completed.verdict}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = failReview(running, message);
      await this.reviews.save(failed);
      await this.persisted.saveOutbox(failed.id, reviewFailedEvent(failed));
      reviewsProcessed.inc({ verdict: "failed" });
      this.log.error(`review failed ${failed.id}: ${message}`);
    } finally {
      if (artifactCleanup) await artifactCleanup().catch(() => {});
      if (baselineCleanup) await baselineCleanup().catch(() => {});
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
    }
  }
}
