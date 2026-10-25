import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const reviewsProcessed = new Counter({
  name: "preflight_reviews_processed_total",
  help: "Reviews that reached a terminal state",
  labelNames: ["verdict"],
  registers: [registry],
});

export const eventsPublished = new Counter({
  name: "preflight_outbox_events_published_total",
  help: "Domain events published from the transactional outbox",
  labelNames: ["type"],
  registers: [registry],
});

export const reviewsQueued = new Gauge({
  name: "preflight_reviews_queued",
  help: "Reviews waiting in the queue",
  registers: [registry],
});

export const reviewsByStatus = new Gauge({
  name: "preflight_reviews_by_status",
  help: "Current review count grouped by lifecycle status",
  labelNames: ["status"],
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: "preflight_outbox_events_pending",
  help: "Transactional outbox events that have not reached the event stream",
  registers: [registry],
});
