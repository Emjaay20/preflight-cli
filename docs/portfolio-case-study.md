# Preflight: TypeScript backend case study

## The product problem

Extension teams often have a gap between what they claim to stores and users
and what the release archive actually contains. A newly added host permission,
remote script, or consent bypass can be easy to miss in code review and costly
to discover after release.

Preflight turns that ambiguity into a repeatable release review: it compares a
build with its baseline, evaluates versioned policy packs, records evidence,
and requires a human decision before a release can move forward.

## What I built

- A NestJS/TypeScript control plane for workspaces, projects, API keys,
  invitations, reviews, audit records, quotas, and operational endpoints.
- A Rust static-analysis CLI that is deterministic, runs out of process, and
  never executes an uploaded extension.
- An asynchronous review pipeline using PostgreSQL, Redis, BullMQ, a
  transactional outbox, and an append-only event stream.
- A browser console plus an anonymous, ephemeral sandbox, so a recruiter can
  see a real verdict without receiving a shared workspace credential.
- A WorkOS Staging browser-login path that is intentionally separate from CLI
  and CI API keys.
- Artifact retention, content-addressed storage, metrics, readiness probes,
  audit trails, operator access-request visibility, and CI/release workflows.

## Engineering decisions

| Decision | Trade-off | Why it is useful |
|---|---|---|
| Rust scanner + TypeScript control plane | More deployment surface than a single-language app | The scanner stays deterministic and isolated; TypeScript is used where web services, queues, persistence, and operations matter. |
| Async worker queue | A review is not instant | The API stays responsive, retries can be controlled, and review state is durable. |
| Human sign-off | No automatic “ship” result | A scanner can provide evidence, but it should not authorize a production release. |
| Versioned policy packs | Rules must be maintained over time | Every review records the exact policy version used, which makes decisions explainable. |
| Browser identity separate from API keys | More identity concepts to explain | CI keys can be scoped and rotated independently; a browser session never needs a CI credential. |
| Free evaluation limits | Not unlimited self-service | Prevents an open portfolio demo from becoming an unbounded file-processing service. |

## Reliability and safety work

The API enforces workspace quotas with short database-backed reservations so
concurrent requests cannot simply bypass a monthly limit. Artifacts have a 25
MiB upload ceiling; the scanner rejects archives with more than 5,000 files,
more than 100 MiB expanded content, or suspicious compression ratios before
extracting them. Uploaded source is inspected statically, never run by Node.

Operationally, the service exposes liveness, readiness, metrics, and operations
views. A review uses at-least-once queue processing, database transactions for
its final state and outbox record, and idempotent worker behavior. Artifacts are
cleaned up on retention while the review and audit record stay available.

## Honest limits

This is intentionally a portfolio-safe public deployment, not a claim that all
extension security is solved. The hosted login uses WorkOS Staging. Enterprise
SSO, Directory Sync, billing, and unrestricted uploads are not enabled. The
scanner does not execute extension code or replace malware analysis. Those are
deliberate product boundaries, not hidden omissions.

## Why this maps to a backend role at Wynd Labs

The project demonstrates TypeScript service design beyond web scraping:
asynchronous pipelines, observable operations, scoped credentials, tenant
isolation, job retries, durable data modeling, safe file handling, release
automation, and practical debugging boundaries. The Rust component is an
additional signal that the service can safely delegate deterministic work to a
separate process.

## Evidence to show

1. Live sandbox at `https://preflight.aetherhost.com.ng` — choose
   **extra-host** to produce a real blocking result.
2. Repository tests — `cargo test`, `npm test`, and Prisma validation.
3. GitHub Actions — scanner fixture gate, Node tests, and container publishing.
4. [Demo recording guide](demo/wynd-labs-demo.md) — a short walkthrough that
   presents the actual system rather than a scripted mockup.
