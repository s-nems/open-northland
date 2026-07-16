# Add a per-system instrumentation seam and DevTools performance marks

**Area:** sim + app · **Origin:** diagnostics research discussion 2026-07-16 · **Priority:** P2

The perf overlay splits a frame into sim/snapshot/draw (`view/runtime/frame-loop.ts`), but nothing
attributes sim cost **per system** — the granularity the RTS budget rule ("per-tick cost scales
with active work") actually needs. `Simulation.step()` hardcodes the loop over `SYSTEM_ORDER`
(`packages/sim/src/simulation.ts:131`), so there is currently no seam to time systems from outside,
and the hygiene test rightly bans `performance.now` inside `packages/sim/src`. The Recoil engine's
pattern is the one to copy: the SAME instrumentation points feed the live overlay and an external
profiler (`SCOPED_TIMER` → in-game `/debug` graph AND Tracy zones). In the browser, the external
profiler is free: `performance.mark`/`measure` entries appear automatically in the Timings track of
Chrome DevTools' Performance panel.

`docs/tickets/sim/perf-benchmark-harness.md` already assumes "inject a timer through the existing
system-runner seam" — this ticket creates that seam; the bench harness becomes a second consumer.

Source basis: none needed — self-consistency tooling.

## Scope

1. **Sim seam** (pure, deterministic): an optional hook on `Simulation` — e.g. a constructor option
   `instrumentSystem?: (name: string, run: () => void) => void`, defaulting to a direct call —
   wrapping each system invocation in `step()`. Systems need stable names: either rely on the
   exported function names (`system.name`) or make `SYSTEM_ORDER` a named table
   `{name, system}[]`. The hook receives no world/ctx access; it cannot perturb state, and the
   hygiene scan stays green because the timer lives in the caller.
2. **App consumer**: when enabled (`?debug=perf`, or piggyback the existing `debug` carried param
   in `view/params.ts`), wrap with `performance.mark`/`measure` named e.g. `sim/jobSystem` — zero
   further UI work, the measures show up in DevTools' Performance Timings track. Consider the
   DevTools extensibility API (`devtools` object in the measure `detail`) for a named custom track,
   but the plain Timings track is the acceptance bar.
3. Also mark the frame phases already timed in `frame-loop.ts` (`sim`, `snapshot`, `draw`) so one
   DevTools recording shows the whole frame anatomy.
4. **Stretch (optional)**: aggregate per-system EMA ms into the perf overlay (extend `PerfInfo`).
   Skip if it bloats the change — the DevTools track is the deliverable.
5. Update `docs/tickets/sim/perf-benchmark-harness.md` to point at the seam once it exists.

## Verify

- Determinism: golden/determinism tests unchanged; add a test running a sim with an active
  (counting) hook and asserting `hashState()` equals the un-instrumented run.
- Hygiene test still green (`packages/sim/test/core/hygiene.test.ts`).
- `npm test`, `npm run check`, `npm run build`.
- Manual: record a DevTools Performance profile on a `?map=` run with the flag on — per-system
  measures visible per tick; overhead with the flag off is zero (default direct call).
