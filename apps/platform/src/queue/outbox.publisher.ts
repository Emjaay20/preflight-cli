import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type Redis from "ioredis";
import { PrismaService } from "../prisma.service";
import { TOKENS } from "../tokens";
import { eventsPublished } from "../observability/metrics";
import { SlackNotifier } from "../notifications/slack-notifier";

export const EVENT_STREAM = "preflight.events";

@Injectable()
export class OutboxPublisher {
  private readonly log = new Logger(OutboxPublisher.name);
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TOKENS.Redis) private readonly redis: Redis,
    private readonly slack: SlackNotifier,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const batch = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      for (const event of batch) {
        await this.redis.xadd(
          EVENT_STREAM,
          "*",
          "type",
          event.type,
          "payload",
          JSON.stringify(event.payload),
          "id",
          event.id,
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { publishedAt: new Date() },
        });
        eventsPublished.inc({ type: event.type });
      }
      await this.publishSlackNotifications();
    } catch (err) {
      this.log.error(err, "outbox publish failed");
    } finally {
      this.ticking = false;
    }
  }

  private async publishSlackNotifications(): Promise<void> {
    const pending = await this.prisma.outboxEvent.findMany({
      where: { slackPublishedAt: null },
      orderBy: { createdAt: "asc" },
      take: 50,
    });
    for (const event of pending) {
      await this.slack.notify(event);
      // A disabled configuration is intentionally recorded as delivered: it
      // should not cause old reviews to be announced if Slack is enabled later.
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { slackPublishedAt: new Date() },
      });
    }
  }
}
