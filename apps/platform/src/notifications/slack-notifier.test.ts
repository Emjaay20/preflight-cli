import { afterEach, describe, expect, it, vi } from "vitest";
import { SlackNotifier, shouldNotify, slackMessage } from "./slack-notifier";

const originalWebhook = process.env.SLACK_WEBHOOK_URL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalWebhook === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = originalWebhook;
  globalThis.fetch = originalFetch;
});

describe("SlackNotifier", () => {
  const blocked = {
    id: "event-1",
    type: "review.completed",
    payload: { reviewId: "review-1", projectId: "project-1", verdict: "block", findingCount: 2 },
  };

  it("only reports failed or attention-required reviews", () => {
    expect(shouldNotify(blocked)).toBe(true);
    expect(
      shouldNotify({ ...blocked, payload: { ...blocked.payload, verdict: "ship_with_conditions" } }),
    ).toBe(false);
    expect(shouldNotify({ id: "event-2", type: "review.failed", payload: {} })).toBe(true);
  });

  it("does not make network calls when Slack is not configured", async () => {
    delete process.env.SLACK_WEBHOOK_URL;
    globalThis.fetch = vi.fn();
    await expect(new SlackNotifier().notify(blocked)).resolves.toBe("disabled");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("posts an actionable message to the configured webhook", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.test/services/example";
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(new SlackNotifier().notify(blocked)).resolves.toBe("sent");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      process.env.SLACK_WEBHOOK_URL,
      expect.objectContaining({ method: "POST", body: expect.stringContaining("review-1") }),
    );
    expect(slackMessage(blocked)).toContain("Verdict: block");
  });
});
