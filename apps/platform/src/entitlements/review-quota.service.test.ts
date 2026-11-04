import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { ReviewQuotaService } from "./review-quota.service";

function makePrisma(reviewCount: number, reservationCount = 0) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(undefined),
    organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ reviewLimit: 10 }) },
    review: { count: vi.fn().mockResolvedValue(reviewCount) },
    reviewQuotaReservation: {
      count: vi.fn().mockResolvedValue(reservationCount),
      create: vi.fn().mockResolvedValue({ id: "reservation-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    $transaction: vi.fn(async (callback) => callback(tx)),
    reviewQuotaReservation: tx.reviewQuotaReservation,
    tx,
  };
}

describe("ReviewQuotaService", () => {
  it("reserves capacity while holding a workspace/month advisory lock", async () => {
    const prisma = makePrisma(8, 1);
    const service = new ReviewQuotaService(prisma as never);

    await expect(service.reserve("org-1", "ci (pf_live_test)")).resolves.toBe("reservation-1");
    expect(prisma.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.tx.reviewQuotaReservation.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a submission when persisted reviews and active reservations reach the limit", async () => {
    const prisma = makePrisma(9, 1);
    const service = new ReviewQuotaService(prisma as never);

    await expect(service.reserve("org-1", "ci (pf_live_test)")).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tx.reviewQuotaReservation.create).not.toHaveBeenCalled();
    expect(prisma.tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "quota.review.denied" }) }));
  });
});
