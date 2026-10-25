import { describe, expect, it, vi } from "vitest";
import { OperationsService } from "./operations.service";

describe("OperationsService", () => {
  it("returns a complete fleet snapshot when some review states are empty", async () => {
    const prisma = {
      review: {
        groupBy: vi.fn().mockResolvedValue([
          { status: "queued", _count: { _all: 3 } },
          { status: "completed", _count: { _all: 11 } },
        ]),
      },
      outboxEvent: { count: vi.fn().mockResolvedValue(2) },
    };
    const service = new OperationsService(prisma as never);

    await expect(service.snapshot()).resolves.toEqual({
      reviews: { queued: 3, running: 0, completed: 11, failed: 0 },
      pendingOutboxEvents: 2,
    });
  });
});
