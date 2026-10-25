# Operating Preflight

Preflight is deliberately split into an API and a scanner worker. Treat the
database as the source of truth: Redis carries jobs and events, but a review
and its findings are only authoritative once persisted in PostgreSQL.

## Health and metrics

| Endpoint | Meaning |
| --- | --- |
| `GET /health/live` | The API process is running. |
| `GET /health/ready` | PostgreSQL and Redis are reachable. Use this for load-balancer readiness. |
| `GET /health/operations` | Database-backed counts of queued/running/completed/failed reviews and unpublished outbox events. |
| `GET /metrics` | Prometheus metrics. Each scrape refreshes fleet-level review and outbox gauges from PostgreSQL. |

Start the local metrics service with:

```bash
docker compose --profile observability up --build
```

Prometheus is then available at `http://localhost:9090` and scrapes the API at
`/metrics` every 15 seconds.

## Slack operational reporting

Set `SLACK_WEBHOOK_URL` in the worker environment to an incoming webhook URL
to receive a message for `block`, `needs_human`, and failed reviews. Delivery
is tracked per outbox event, separately from Redis publishing, so a temporary
Slack outage does not duplicate events on `preflight.events`.

## Alert recommendations

Alert on these conditions rather than on a single failed review:

- `preflight_reviews_by_status{status="queued"}` keeps increasing for 10 minutes: workers are unavailable or saturated.
- `preflight_reviews_by_status{status="failed"}` increases unexpectedly: inspect worker logs and the affected artifact.
- `preflight_outbox_events_pending` is non-zero for 5 minutes: the Redis event stream is unavailable or the publisher is failing.
- `/health/ready` fails: take the API out of service and restore PostgreSQL or Redis before accepting new reviews.

## Artifact transport

Artifacts are private customer data. The `/v1/blobs/*` routes are exclusively
for API-to-worker CAS transfer and require `INTERNAL_BLOB_TOKEN` in the
`x-blob-token` header. Set the same long, random value in API and worker
environments when `CAS_REMOTE_URL` is configured. Do not expose this token to
dashboard users or CI jobs; CI submits artifacts through the authenticated
review endpoint instead.

## Recovery guide

1. Read `/health/operations` and identify whether reviews are queued, running, or failed.
2. For queued work, confirm a worker is up and can connect to Redis and PostgreSQL.
3. For failed work, inspect the review error and worker logs. Fix the scanner or storage issue, then submit a new review; the original record remains the audit trail.
4. For pending outbox events, restore Redis. The publisher retries on its next tick and consumers must treat events as at-least-once delivery.
