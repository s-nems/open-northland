# Log long-tick / slow-frame reports through the diagnostics channels

**Area:** app · **Origin:** diagnostics follow-up 2026-07-16 · **Priority:** P2

The perf paths so far are pull-only: DevTools marks and the trace ring need the right `?debug=`
flag on *before* the problem. But the common tester report is "it stuttered" with no flag on — and
the diagnostics bundle they download carries no perf evidence. OpenRA's answer is `PerfTickLogger`:
any world tick over a threshold writes a per-trait ms breakdown to the ordinary `perf` log channel,
so slow moments self-document in every log. Ours can do the same for near-free: the frame loop
already times sim/snapshot/draw every frame, and `Simulation.setInstrument` gives per-system ms.

Source basis: none needed — self-consistency tooling (OpenRA's PerfTickLogger is the pattern, not
a fidelity target).

## Scope

1. In the frame loop (`view/runtime/frame-loop.ts`): when a frame's `cpuMs` exceeds a named
   threshold (e.g. 2× the 60 fps budget — a constant, not a magic number), log one `perf`-channel
   entry with the frame's `simMs`/`snapMs`/`drawMs`, tick, entity count, and steps. Rate-limit
   (e.g. at most one report per second) so a sustained stutter can't flood the ring.
2. Per-system attribution for slow TICKS: a lightweight always-on instrument that accumulates
   per-system ms only long enough to attribute a slow tick, then logs the top offenders. Watch the
   cost: the hook allocates a closure per system per tick — measure before making it default-on;
   if it's not effectively free, keep it behind `?debug=perf`/`diag` and log only the frame-level
   split by default.
3. No new UI: the reports live in the log ring → console (warn level) → diagnostics bundle.

## Verify

- Unit test: a synthetic slow frame produces exactly one rate-limited `perf` entry with the split.
- `npm test`, `npm run check`, `npm run build`; perf overlay numbers unaffected.
- Manual: throttle CPU in DevTools on `?map=`, download a bundle, and see the slow-frame reports.
