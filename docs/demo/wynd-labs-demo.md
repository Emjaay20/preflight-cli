# Wynd Labs demo: record this in 2 minutes 30 seconds

This is a screen-recording script, not a claim that Preflight is a production
security guarantee. Record the real hosted sandbox and repository; never show
an API key, `.env`, dashboards containing secrets, or customer data.

## Before recording (5 minutes)

1. Open `https://preflight.aetherhost.com.ng` in a clean browser profile.
2. Open the GitHub repository in a second tab, starting at the Actions page.
3. Keep the terminal ready with `cargo test` and `npm test` already completed,
   or show the green GitHub workflow instead of a terminal.
4. Use the public sandbox. It is anonymous and ephemeral, so it demonstrates
   the real Rust analysis without using a shared workspace key.

## Voice-over and screen plan

### 0:00–0:18 — the problem

**Show:** the Preflight landing page.

**Say:** “Preflight is a release-clearance system for browser extensions. It
checks whether a release artifact still matches the permissions, network
destinations, and privacy claims the team is about to ship.”

### 0:18–0:48 — a real verdict

**Show:** the Sandbox. Select `extra-host`, leave the supplied claims in
place, and run the evaluation.

**Say:** “This is not a visual mockup. The request goes through a TypeScript
API to an isolated Rust scanner. The build introduced a host that is not in the
claims, so the policy evaluator returns a block with the evidence and rule ID.”

### 0:48–1:10 — explainability, not magic

**Show:** the findings, inventory, and verdict details. Then select
`clean-relay` and run it.

**Say:** “A clean fixture gets a conditional ship verdict, not an automatic
release. A reviewer must still make the final sign-off. That is intentional:
software can make evidence reliable, but it should not silently authorize a
release.”

### 1:10–1:38 — backend architecture

**Show:** the Pipeline or Documentation page, then the architecture diagram in
the repository.

**Say:** “The control plane is NestJS and TypeScript: tenant isolation, API
keys, invitations, quotas, Postgres persistence, Redis queues, audit events,
and metrics. Rust is used for deterministic static scanning and runs outside
the Node process.”

### 1:38–2:03 — operational thinking

**Show:** `/health/operations`, then GitHub Actions’ green workflow.

**Say:** “I designed for the operational path too: readiness and metrics,
retries and an outbox for review completion events, retention cleanup, archive
limits to reduce file-processing risk, and a release workflow that builds and
checks the CLI.”

### 2:03–2:30 — scope and relevance

**Show:** `docs/portfolio-case-study.md`, especially Honest limits.

**Say:** “This is a public evaluation deployment, so enterprise SSO and
billing are intentionally not enabled. The important point for a backend role
is the same: I can take an ambiguous release-safety problem and build the
service, queue, storage, observability, and guardrails around it.”

## Suggested title and description

**Title:** `Preflight — Explainable release clearance for browser extensions`

**Description:** `A short TypeScript + Rust backend demo: upload/review flow,
policy evidence, asynchronous processing, operations, and human sign-off.`
