# Trim duplicated unit-order command contracts

**Area:** sim · **Origin:** workflow readability audit, 2026-07-21 · **Priority:** P3

`packages/sim/src/core/commands/unit-orders.ts` has 132 full comment lines for 74 code lines. The
discriminated union already makes each command's kind and payload readable, while many variant
comments repeat handler implementation, invalid-input behavior, and lifecycle details documented by
the corresponding order systems and tests. The result hides the command vocabulary inside prose.

This is a comment-contract cleanup, not a command or behavior redesign. Source-basis facts and
caller-visible semantics that cannot be inferred from a variant's fields remain documented.

## Scope

- Run the `/trim-comments` classification over `core/commands/unit-orders.ts` and the corresponding
  handler docs in `systems/orders/` to identify duplicated facts.
- Keep each command variant's intent, non-obvious payload meaning, source basis, and caller-visible
  persistence/cancellation semantics concise at the command boundary.
- Delete handler walkthroughs, exhaustive guard lists already pinned by handler tests, repeated
  "skipped but logged" boilerplate, and `See <handler>` narration when the command kind already names
  the handler.
- If classification reveals a genuine invalid-state type problem, leave that comment intact and file
  a separate structural ticket rather than widening this pass.

## Verify

- `npm run check` and `npm test`; no golden or generated declaration changes.
- Identify every retained long contract with the irreducible fact it carries; judge success by the
  command vocabulary becoming easier to scan, not by a target deletion count.
