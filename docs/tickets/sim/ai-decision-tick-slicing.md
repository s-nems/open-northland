# Slice one seat's AI decision pass across ticks

**Area:** sim · **Focus:** ai-player · **Priority:** P2 · **Complexity:** medium

A due seat runs all five strategic modules (workforce, build order, scout, population, military) in
one tick. With the placement grid now maintained incrementally, the fortress at tick ~48k (13 AI seats,
`npm run bench:map` from the 48k checkpoint) still shows `aiPlayer` at a 0.05 ms median but a due-tick
max of 12.6 ms, the second-largest single-system spike after the planner's; its inclusive profile splits
44% workforce, 27% build-order placement search, 24% military. At speed x3 a 12 ms tick costs a frame.

## Scope

- Profile one due tick (`npm run bench:profile` from the checkpoint) to see which module the residual
  spike sits in.
- Spread one seat's modules across consecutive ticks (module index derived from tick and seat, same
  stagger idea as seats today) or give the pass an explicit per-tick budget with deterministic
  carryover. The schedule must stay a pure function of (tick, seat) so replays hold.
- Command semantics unchanged: modules already communicate through commands applied next tick, so
  inter-module ordering within one tick must be shown not to matter before slicing, module pairs
  that do couple stay on the same tick.

## Verify

- Live probe: `aiPlayer` max approaches its mean; the every-4th-tick spike leaves the rAF delta
  histogram.
- Goldens or a dedicated AI scenario confirm identical build-out against the unsliced schedule, or
  the golden move is justified as an intended cadence change.
- `npm test`, `npm run check`, `npm run build`.
