# Security policy

## Supported deployment

The current `main` branch is the supported deployment line. The public
Preflight sandbox is deliberately **read-only and ephemeral**: it evaluates
only bundled fixtures and does not retain visitor data.

## Reporting a vulnerability

Please do not include a proof of concept, API key, customer artifact, or other
sensitive material in a public issue. Email `yusuf@yusufsaka.dev` with:

- a short description and impact;
- reproduction steps using non-sensitive test data;
- the affected URL, version, or commit; and
- any suggested mitigation.

We aim to acknowledge reports within five business days and will coordinate a
fix and disclosure timeline with the reporter.

## Operational safeguards

- API-key secrets are scrypt-hashed and shown only at creation time.
- Browser sessions use WorkOS Staging unless a deliberate production migration
  is made. Browser sessions are separate from CLI and CI API keys.
- The public dashboard never returns a demo API key.
- The anonymous fixture sandbox is rate-limited through Redis and can only
  evaluate bundled fixture artifacts.
- Extension source is statically inspected; uploaded JavaScript is never
  executed by the TypeScript control plane.
- Input archives are limited to 25 MiB, 5,000 files, 100 MiB expanded size,
  and a 100:1 compression ratio before extraction.
- Workspace artifacts are automatically removed after their retention period;
  review metadata and audit history remain for traceability.

## Scope boundary

Preflight is a release-clearance and policy-validation tool. It is not a
malware scanner, runtime browser sandbox, penetration-testing service, or a
guarantee that an extension is safe. A human reviewer remains responsible for
shipping decisions.
