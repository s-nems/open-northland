# Diagnose the deterministic late-run pathfinding spikes under AI load

**Area:** sim · **Origin:** profiling `magiczny_las` + 6 AI seats 2026-07-18 · **Priority:** P2

Profiled headless (the `ai-map-scenario.test.ts` setup run 2400 ticks with `sim.setInstrument`,
seed 7, 6 AI seats, ending at 175 settlers): the `pathfinding` system spikes to ~0.9–1.2 s in
single ticks late in the run — reproducibly at the same ticks (~2285, 2333, 2381) across runs, so
the trigger is deterministic sim state, not machine noise. Under heavier machine load the same
ticks stretched to multi-second stalls; at ×10 game speed these are the frame hitches the user
reports (worst ~230 ms frames in the browser with the renderer sharing the core).

Suspected shape: a wave of settlers repathing in one tick and/or unreachable targets making A*
exhaust the reachable component of a large half-cell lattice per request. Not confirmed — that is
this ticket's job.

Scope: reproduce with the profiling recipe above, break down the spike tick (how many path
requests, cost per request, failed vs found), identify the trigger (which orders/targets), then
fix or file the fix: candidates are a per-tick path-request budget with deterministic carry-over,
failed-path result caching, or fixing the order source that mass-repaths. Any fix must keep
canonical winners and byte-identical goldens, or move them as a named intentional change.

## Verify

- A repeat profiling run shows the spike ticks flattened (no >100 ms `pathfinding` tick at the
  same seeds); goldens unmoved unless the change is intentional and named; `npm test`,
  `npm run check`, `npm run build`.
