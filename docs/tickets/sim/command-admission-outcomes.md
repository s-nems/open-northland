# Report deterministic command admission outcomes

**Area:** sim, app · **Focus:** systems/command · **Priority:** P2

`CommandSystem` calls void handlers and appends every drained input to the applied replay log. Invalid
content ids, stale entities, unavailable upgrades, and unauthorized targets are recoverable no-ops in
the handlers, so callers cannot distinguish an accepted action from a rejection and the log calls both
"applied". This hides player-facing failures and makes a diagnostics replay preserve attempted inputs
without explaining which ones changed state.

## Scope

- Make exhaustive command dispatch return a serializable `CommandOutcome` discriminated union:
  `accepted` or `rejected` with a stable machine-readable reason code. Keep localized prose in app.
- Convert every recoverable guard in command handlers to an explicit rejection. Programmer errors and
  broken trusted setup remain exceptions rather than user-facing outcomes.
- Record every normalized envelope with its outcome in a command-attempt replay stream. Emit the same
  envelope identity and outcome as a per-tick result event so app diagnostics and player feedback observe
  rejections without reading the queue internals.
- Share pure admission checks with the existing placement probes and app-side ownership/target filters.
  Do not execute a mutating handler twice merely to implement query/execute semantics.

## Verify

- Exhaustive tests cover one accepted and representative rejected outcome from each command family,
  including stale entity, wrong owner, invalid content id, blocked placement, and unavailable upgrade.
- Rejected commands do not change the state hash; their replay entry and result event carry the stable
  code. Replaying the attempt stream reproduces both outcomes and the original hash.
- `npm test`, `npm run check`, and `npm run build`.
