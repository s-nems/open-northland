# Extend the determinism hygiene scan to the app's world setup

**Area:** app · **Focus:** scenes · **Priority:** P3

`packages/sim/test/core/hygiene.test.ts` rejects `Math.random`, `Date.now`, `new Date`,
`performance.now`, transcendental `Math.*`, and locale APIs, but it scans `packages/sim/src` only.
The acceptance scenes' `build(sim)` bodies and the sandbox catalog under `packages/app/src` also write
pre-tick-zero simulation state, and no scan or run-twice check covers them: every same-seed hash
comparison lives in `packages/sim/test/`, over sim fixtures rather than the app's setup path.

The closure is clean today. No banned call appears under `packages/app/src/{scenes,game,catalog}`
outside `src/diag/`, which feeds a bounded ring and never sim state. This hardens an unguarded
boundary rather than fixing a defect, which is what puts it at P3.

## Scope

- Scan the app modules that assemble pre-tick-zero sim state with the rule table the sim hygiene test
  already uses, sharing that table instead of copying it.
- Non-goal: scanning the rest of `packages/app/src`. Browser APIs, wall clock, and presentation floats
  are legal there by contract (`packages/app/AGENTS.md`).

## Verify

- The sim hygiene case and the new app-side case both green.
- Temporarily put a `Math.random` in a scene's `build` and confirm the scan fails on it.
