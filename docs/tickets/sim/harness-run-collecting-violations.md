# Share the run-collecting-violations loop the tests re-roll

**Area:** sim · **Origin:** sim refactor-cleanup (deferred), 2026-07-17 · **Priority:** P3
(test debt — no production behavior change)

## Context

`Scenario.run` (`packages/sim/src/harness/scenario.ts`) steps a sim while collecting per-tick invariant
violations. Four test sites re-roll that same loop by hand:

- `packages/sim/test/agents/felling.test.ts` (~:284)
- `packages/sim/test/agents/mining.test.ts` (~:226) — byte-identical to felling's but for the tick count
  and one max-tracking line
- `packages/sim/test/core/fuzz-determinism.test.ts` (~:479)
- `packages/sim/test/agents/gatherer-flag/support.ts` (~:152)

The semantics have **already drifted**: `Scenario.run` *breaks* at the first broken tick, while the four
copies keep running and record only the first violation. A fix to the harness's reporting reaches none of
them.

## Scope

- Export one loop from `src/harness/` (e.g. `runCollectingViolations(sim, ticks, onTick?)`) that owns the
  step + `checkInvariants` + violation-collection contract, including the break-vs-continue decision.
- Have `Scenario.run` and the four sites call it. Decide the break-vs-continue semantics deliberately and
  state it in the doc comment — do not preserve the drift by accident.
- Assertions must stay as strong as they are now; this is a dedup, not a rewrite.

## Done when

- One loop, four callers, `npm test` green with no golden movement.
