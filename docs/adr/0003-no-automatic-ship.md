# ADR 0003: No automatic ship verdict

## Status

Accepted

## Context

Store review, legal, and user-trust decisions are not functions of a linter. A clean scan means “we did not find a blocker,” not “this is safe to publish.”

An `auto_ship: true` flag would be the most tempting and most dangerous line in the product.

## Decision

The domain `Review` type includes `autoShip: false` (literal). Completing a review cannot change it. Scanner JSON always emits `"auto_ship": false`. CLI usage text states there is no automatic ship. Dashboard copy repeats it.

Allowed verdicts: `block | needs_human | ship_with_conditions`.

High or blocker findings → `block`. Missing/incomplete claims or medium findings → `needs_human`. Otherwise `ship_with_conditions`.

## Consequences

- Humans remain on the sign-off line of `REVIEW.md`.
- We will not add a “ship” verdict without a new ADR and an explicit product owner.
