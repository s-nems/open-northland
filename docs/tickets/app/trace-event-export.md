# Export performance traces as Chrome Trace Event JSON (Perfetto)

**Area:** app · **Origin:** diagnostics research discussion 2026-07-16 · **Priority:** P3
**Blocked by:** docs/tickets/sim/per-system-timing-seam.md

Live DevTools profiling (the timing-seam ticket) covers the local-dev scenario, but it requires
DevTools open at the moment of the problem. A recorded trace file covers the rest: a bounded
in-memory trace a player/tester can export after the fact and a dev opens offline. The Chrome
Trace Event JSON format (`{name, ph, ts, dur, …}` duration events) is plain JSON an app can emit
itself and loads directly in Perfetto (ui.perfetto.dev) and DevTools — the browser analogue of
Recoil's Tracy export and 0 A.D.'s Profiler2 `SaveToFile()`. Third consumer of the same
instrumentation points; no new timers.

Source basis: Trace Event format as documented by Perfetto
(https://perfetto.dev/docs/getting-started/other-formats).

## Scope

1. A trace collector in `packages/app/src/diag/`: subscribes to the per-system instrumentation
   seam and the frame-phase marks, records complete-duration (`ph: "X"`) events into a bounded
   ring (e.g. last ~30 s of frames; oldest dropped), off unless enabled (`?debug=trace` or a debug
   toggle) — recording must cost nothing when off.
2. Export: a debug-menu action downloading the ring as a `.json` Trace Event file that opens in
   Perfetto. Optionally attach the trace to the diagnostics bundle
   (`docs/tickets/app/crash-capture-diagnostics-bundle.md`) when both are enabled.
3. Keep it lean: no custom viewer, no server upload — the file + Perfetto is the whole product.

## Verify

- Unit test: collected events serialize to the Trace Event shape (array of `ph:"X"` events with
  monotonic `ts`, `dur >= 0`, expected names); ring bound holds.
- `npm test`, `npm run check`, `npm run build`.
- Manual (human): export a trace from a `?map=` run and open it in Perfetto — per-system and
  frame-phase slices visible on a timeline.
