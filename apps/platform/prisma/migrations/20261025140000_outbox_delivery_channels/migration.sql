-- Each outbound delivery channel is tracked independently. Redis remains the
-- source event stream; Slack failures must not cause a previously-published
-- event to be sent to Redis again.
ALTER TABLE "OutboxEvent" ADD COLUMN "slackPublishedAt" TIMESTAMP(3);
