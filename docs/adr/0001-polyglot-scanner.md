# ADR 0001: Polyglot scanner (Rust) + Node control plane

## Status

Accepted

## Context

Preflight has two jobs that pull in opposite directions:

1. Deterministic static analysis of untrusted extension bytes (zip/crx/dir).
2. A multi-tenant control plane: auth, jobs, persistence, HTTP, operators.

Putting both in one Node process would mean parsing zips and walking JS in the same runtime that serves the internet. Putting both in Rust would hide the operational surface this product actually needs (queues, tenancy, metrics).

## Decision

Keep analysis in a **Rust CLI** with `forbid(unsafe_code)` and no third-party crates. Orchestrate it from a **Node.js / TypeScript** control plane (NestJS) that talks to the scanner only as a subprocess.

The TypeScript domain (`packages/domain`) owns review lifecycle and ports. `packages/scanner` is an adapter that spawns `preflight` and parses `review.json`.

## Consequences

- CI can keep running `preflight review` with no platform.
- The worker image contains the Rust binary; the API image does not have to.
- Two build toolchains (cargo + npm). Docker multi-stage absorbs that.
- Rule changes happen in Rust and are contract-tested via `review.json` parsing.
