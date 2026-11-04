import { ForbiddenException, Injectable } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma.service";

const RESERVATION_TTL_MS = 15 * 60 * 1000;

function currentMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Injectable()
export class ReviewQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(organizationId: string, actor: string): Promise<string> {
    const now = new Date();
    const month = currentMonth(now);
    const lockKey = `preflight:review-quota:${organizationId}:${month.toISOString()}`;

    return this.prisma.$transaction(async (tx) => {
      // PostgreSQL advisory locks serialize entitlement checks for one
      // workspace/month without serializing other tenants' submissions.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      await tx.reviewQuotaReservation.deleteMany({ where: { expiresAt: { lte: now } } });

      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const [reviews, reservations] = await Promise.all([
        tx.review.count({
          where: { project: { organizationId }, createdAt: { gte: month } },
        }),
        tx.reviewQuotaReservation.count({
          where: { organizationId, month, expiresAt: { gt: now } },
        }),
      ]);

      if (reviews + reservations >= org.reviewLimit) {
        await tx.auditEvent.create({
          data: {
            organizationId,
            actor,
            action: "quota.review.denied",
            targetType: "workspace",
            metadata: { used: reviews + reservations, limit: org.reviewLimit },
          },
        });
        throw new ForbiddenException(
          `free evaluation review limit reached (${org.reviewLimit}/month); request an upgrade at yusuf@yusufsaka.dev`,
        );
      }

      const reservation = await tx.reviewQuotaReservation.create({
        data: {
          organizationId,
          month,
          expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId,
          actor,
          action: "review.quota.reserved",
          targetType: "workspace",
          metadata: { used: reviews + reservations, limit: org.reviewLimit, reservationId: reservation.id },
        },
      });
      return reservation.id;
    });
  }

  async release(reservationId: string): Promise<void> {
    await this.prisma.reviewQuotaReservation.delete({ where: { id: reservationId } }).catch(() => undefined);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async clearExpired(): Promise<void> {
    await this.prisma.reviewQuotaReservation.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  }
}
