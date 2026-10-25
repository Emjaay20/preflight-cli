import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { outboxPending, reviewsByStatus, reviewsQueued } from "./metrics";

export type OperationsSnapshot = {
  reviews: Record<"queued" | "running" | "completed" | "failed", number>;
  pendingOutboxEvents: number;
};

/**
 * Produces one cheap, database-backed operational snapshot. It is called by
 * Prometheus scrapes and the operator endpoint, so metrics describe the whole
 * fleet rather than one API process' in-memory state.
 */
@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(): Promise<OperationsSnapshot> {
    const [grouped, pendingOutboxEvents] = await Promise.all([
      this.prisma.review.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.outboxEvent.count({ where: { publishedAt: null } }),
    ]);
    const reviews: OperationsSnapshot["reviews"] = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
    };
    for (const row of grouped) {
      reviews[row.status] = row._count._all;
    }
    for (const [status, count] of Object.entries(reviews)) {
      reviewsByStatus.set({ status }, count);
    }
    reviewsQueued.set(reviews.queued);
    outboxPending.set(pendingOutboxEvents);
    return { reviews, pendingOutboxEvents };
  }
}
