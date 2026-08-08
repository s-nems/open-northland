# Replay long diagnostics bundles from a state checkpoint

**Area:** tooling, sim, app · **Focus:** replay, diag · **Priority:** P3
**Blocked by:** [SaveGame restore](../features/save-load-sim-restore.md), [Replay CLI](bundle-replay-cli.md)

Diagnostics bundles currently contain the full command log and the replay API rebuilds a fresh simulation
from tick 1. The cost and payload therefore grow with the whole session even after a restorable state
format exists. Long-session reports need a bounded reconstruction path without turning the presentation
snapshot into persistence state.

## Scope

- Extend the versioned diagnostics schema with an optional validated save checkpoint, its checkpoint tick,
  and the command-attempt tail after that tick. Keep the existing seed/world replay form readable for
  older bundles.
- Make the CLI restore the checkpoint and replay only its tail to the recorded final tick. Reject content,
  map, save-schema, or command-envelope mismatches before stepping.
- Bound automatic bundle size with one checkpoint and a configured recent command window. If a report
  cannot reproduce because its required tail was evicted, state that explicitly instead of silently
  replaying an incomplete session.
- Keep checkpoint creation outside the deterministic tick and do not attach decoded map bytes or original
  assets to a bundle.

## Verify

- A long fixture session replayed from a mid-session checkpoint reaches the same final hash as replay from
  tick 1 while stepping only the tail interval.
- The CLI reads a legacy seed/log bundle, rejects a mismatched checkpoint, and reports a deliberately
  truncated tail as incomplete.
- Serialized bundles remain bounded under a fixed command rate; `npm test`, `npm run check`, and
  `npm run build`.
