# Architecture

Preflight is a **release-clearance platform** for Chromium extension artifacts.

## Bounded contexts

| Context | Responsibility | Process |
|---|---|---|
| Identity | Organizations, API keys (prefix + scrypt hash) | API |
| Catalog | Projects (Harbor Node is one project) | API |
| Review | Review aggregate: queued → running → completed \| failed | API writes, worker mutates |
| Policy | Rule packs, claims, inventory, SARIF | Rust scanner |
| Delivery | BullMQ jobs, transactional outbox, Redis stream `preflight.events` | Worker |

## Review aggregate

A review is opened in `queued` and **has no verdict**. The worker is the only actor allowed to `start` then `complete` or `fail`. Completing copies scanner output (verdict, findings, inventory, markdown) onto the aggregate and emits `review.completed` through the outbox in the same database transaction as the findings write.

`autoShip` is a type-level `false`. There is no code path that can set it.

## Why the scanner is out-of-process

The control plane must not `eval` or execute uploaded extension JavaScript. The Rust binary reads bytes, extracts evidence, and exits. The worker treats exit `2` as a successful analysis whose verdict is `block`.

## Data stores

- **PostgreSQL** — source of truth. Reviews, findings, hashed keys, outbox.
- **Redis** — ephemeral. BullMQ (at-least-once jobs, exponential backoff) and a consumer-ready event stream.
- **Disk** (`DATA_DIR`) — uploaded zips. SHA-256 of the bytes is stored on the review.

## Observability

- JSON logs via pino; `Authorization` redacted.
- `GET /health/live` — process up.
- `GET /health/ready` — Postgres `SELECT 1` and Redis `PING`.
- `GET /metrics` — Prometheus (`preflight_reviews_processed_total`, outbox counters, Node defaults).
- OpenAPI at `/docs`.

## Security

- API keys are `pf_live_<prefix>_<secret>`. Only the prefix is indexed; the secret is scrypt-hashed.
- Helmet CSP on the dashboard.
- 20 MB upload cap.
- Uploaded JS is never executed by Node.
- Demo key is injected into the dashboard **only** when `DEMO_MODE=true`.

## Failure and retries

BullMQ attempts a review three times with exponential backoff. A scanner crash fails the aggregate and still publishes `review.failed`, so subscribers are not left waiting on `queued`.
