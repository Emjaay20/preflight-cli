import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import type { ReviewQueue } from "@preflight/domain";

export const REVIEW_QUEUE_NAME = "preflight.reviews";

@Injectable()
export class BullReviewQueue implements ReviewQueue {
  constructor(@InjectQueue(REVIEW_QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue(reviewId: string): Promise<void> {
    await this.queue.add(
      "review",
      { reviewId },
      {
        jobId: reviewId,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }
}
