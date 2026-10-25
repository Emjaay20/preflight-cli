import { Injectable, Logger } from "@nestjs/common";

type OutboxNotification = {
  id: string;
  type: string;
  payload: unknown;
};

/**
 * Optional operational reporting. The outbox publisher records successful
 * Slack delivery separately, keeping retries from duplicating Redis events.
 */
@Injectable()
export class SlackNotifier {
  private readonly log = new Logger(SlackNotifier.name);

  async notify(event: OutboxNotification): Promise<"sent" | "disabled"> {
    if (!shouldNotify(event)) return "disabled";
    const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
    if (!webhookUrl) return "disabled";

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: slackMessage(event) }),
    });
    if (!response.ok) {
      throw new Error(`Slack webhook returned HTTP ${response.status}`);
    }
    this.log.log(`sent Slack notification for outbox event ${event.id}`);
    return "sent";
  }
}

export function shouldNotify(event: OutboxNotification): boolean {
  if (event.type === "review.failed") return true;
  if (event.type !== "review.completed" || !isRecord(event.payload)) return false;
  return event.payload.verdict === "block" || event.payload.verdict === "needs_human";
}

export function slackMessage(event: OutboxNotification): string {
  const payload = isRecord(event.payload) ? event.payload : {};
  if (event.type === "review.failed") {
    return `:warning: Preflight review failed\nReview: ${stringValue(payload.reviewId)}\nProject: ${stringValue(payload.projectId)}\nError: ${stringValue(payload.error)}`;
  }
  return `:shield: Preflight review requires attention\nVerdict: ${stringValue(payload.verdict)}\nReview: ${stringValue(payload.reviewId)}\nProject: ${stringValue(payload.projectId)}\nFindings: ${stringValue(payload.findingCount)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "unknown";
}
