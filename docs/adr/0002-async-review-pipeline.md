# ADR 0002: Async review pipeline with a transactional outbox

## Status

Accepted

## Context

A review can take seconds (unzip, walk files, run packs). Doing that on the HTTP request:

- ties browser/CI timeouts to scan duration
- loses work if the API replica dies mid-scan
- prevents horizontal scale of API and scanner independently

Downstream systems (Slack, GitHub Check Runs, internal audit) need a reliable `ReviewCompleted` signal, not a best-effort `res.json()`.

## Decision

1. `POST /reviews` stores the artifact, opens a `queued` review, enqueues `preflight.reviews` on BullMQ, returns `202`-shaped JSON immediately (queued resource).
2. A worker starts the review, runs the scanner, persists findings.
3. Domain events are written to an **outbox table in the same Postgres transaction** as the review update, then published to Redis stream `preflight.events` by a one-second publisher.

Jobs retry three times with exponential backoff. Scanner exit code `2` is success-with-block, not a retryable failure.

## Consequences

- API stays cheap and crash-safe.
- At-least-once delivery: consumers of the stream must be idempotent on `reviewId`.
- We did not introduce Kafka. Redis is enough at this scale; the outbox keeps the option to change the broker without changing the aggregate.
