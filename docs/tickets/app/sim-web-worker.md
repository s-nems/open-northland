# Run the deterministic sim step in a Web Worker

**Area:** app (+ sim seam) · **Origin:** sim-perf plan reconciliation, 2026-07-12

The fixed-timestep loop runs in-thread today: `packages/app/src/view/frame-loop.ts` creates
`FixedTimestep` (L72) and calls `sim.step()` inside `timestep.advance(...)` (L98) on the RAF frame. No
`Worker`/`postMessage` exists in `packages/{app,render,sim}`. The sim is already worker-ready: the
snapshot is a plain transferable structure, pinned by
`packages/sim/test/inspect/snapshot-transferable.test.ts` (survives `structuredClone`).

This does not speed the sim up; it keeps rendering responsive during heavy ticks.

## Scope

- App-side seam only: post commands in / snapshots out across the worker boundary.
- Degrade to the current in-thread loop when workers are unavailable; headless tests stay
  in-thread.
- The sim package stays untouched.

## Verify

- `npm test`; manual responsiveness check under heavy tick load (e.g. the battle scene).
- Cross-package seam → run the code-reviewer lens with architecture weight
  (`packages/app/AGENTS.md` one-way-flow boundary).
