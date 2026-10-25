# Preflight

Release clearance for Chromium / Chrome Web Store extension builds.

The question the system answers:

> Does this build still match the last shipped artifact and the claims we made to users and stores?

It never answers “ship”. Verdicts are `block`, `needs_human`, or `ship_with_conditions`. A human signs the release.

## Why it exists

Chrome extension zips drift. A teammate adds `https://cdn.partner-analytics.example/*`, or `eval`, or `*://*/*`. The store listing still says “we only talk to our relays after you opt in.” Google rejects the review, or the build ships and the promise is false.

Preflight is the gate in front of that. CI and humans get the same record: inventory, diff against the last artifact, rule packs, and a verdict.

Harbor Node (bandwidth-relay client) is the **demo tenant**, not the product. It is the fixture used to prove the gate.

## Architecture

```
                    ┌─────────────┐
  zip / crx / dir → │  NestJS API │──PostgreSQL (reviews, findings, API keys)
                    │  :3000      │──Redis (BullMQ + event stream)
                    └──────┬──────┘
                           │ job: preflight.reviews
                    ┌──────▼──────┐
                    │  Worker     │──spawns Rust `preflight` scanner
                    │             │──writes findings + transactional outbox
                    └──────┬──────┘
                           │ XADD preflight.events
                    ┌──────▼──────┐
                    │ Redis Stream│  ReviewCompleted | ReviewFailed
                    └─────────────┘
```

Two languages on purpose:

| Piece | Why |
|---|---|
| Rust CLI (`src/`) | Deterministic static analysis. `forbid(unsafe_code)`, no crates.io deps, exit `2` on block. Same binary CI already runs. |
| Node.js / TypeScript control plane (`apps/platform`) | Auth, tenancy, async jobs, persistence, HTTP, observability. NestJS + Prisma + BullMQ. |

Domain logic lives in `packages/domain` and has **no I/O**. Adapters implement ports (`ScannerPort`, `ReviewRepository`, `ReviewQueue`).

## Quick start

### CLI (local, no Docker)

```bash
cargo test
cargo run -- review fixtures/harbor-node/clean-relay \
  --claims fixtures/harbor-node/claims.json --out reviews/clean
cargo run -- review fixtures/harbor-node/extra-host \
  --claims fixtures/harbor-node/claims.json --out reviews/extra-host
# extra-host exits 2 (block): undeclared partner analytics host
```

### Platform (API + worker + Postgres + Redis)

```bash
cp .env.example .env
docker compose up --build
# dashboard: http://localhost:3080
# openapi:   http://localhost:3080/docs
# health:    http://localhost:3080/health/ready
# operations: http://localhost:3080/health/operations
```

Demo API key is only for the optional local demo tenant (`Use demo instead of creating an org`).

**Real use:** open the dashboard → create an organization → copy the API key (shown once) → upload your zip + claims.

Click **extra-host** on a workspace to see `block`. Click **clean-relay** for `ship_with_conditions`. A human still signs off.

### Tests

```bash
cargo test
npm test
```

## HTTP API

Auth: `Authorization: Bearer pf_live_…` (scrypt-hashed at rest, prefix lookup, secret never stored).

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/projects` | Projects for this org |
| POST | `/v1/projects/:id/reviews` | Multipart `artifact` (+ optional `claims` JSON) |
| GET | `/v1/reviews` | Recent reviews |
| GET | `/v1/reviews/:id` | Review + findings |
| GET | `/v1/reviews/:id/markdown` | `REVIEW.md` |
| POST | `/v1/reviews/demo` | `{ "fixture": "extra-host" }` |
| GET | `/health/live` `/health/ready` `/health/operations` `/metrics` | Probes + Prometheus |

## Rule packs

- `cws-2026.1` — Manifest V3, missing files, broad hosts, sensitive APIs, privacy URL, cleartext, remote/dynamic code.
- `node-client-2026.1` — host allowlist vs claims, consent gate, kill switch, disclosure, private-network targets, first-party updates.

## Design record

- [ADR 0001 — Polyglot scanner](docs/adr/0001-polyglot-scanner.md)
- [ADR 0002 — Async review pipeline](docs/adr/0002-async-review-pipeline.md)
- [ADR 0003 — No automatic ship](docs/adr/0003-no-automatic-ship.md)
- [Architecture](docs/architecture.md)
- [Operations](docs/operations.md)

## Layout

```
src/                     Rust scanner + CLI
fixtures/harbor-node/    Demo extension (clean vs failing builds)
packages/domain/         Pure TypeScript domain (lifecycle, API keys, events)
packages/scanner/        Adapter: spawn CLI, parse review.json
apps/platform/           NestJS API + worker, Prisma, dashboard
docs/adr/                Architecture decision records
infra/k8s/               Deployment manifests
```
