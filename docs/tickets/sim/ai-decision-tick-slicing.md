# Slice one seat's AI decision pass across ticks

**Area:** sim · **Focus:** ai-player · **Priority:** P2 · **Complexity:** medium
**Blocked by:** [work-flag rebuild invalidation](work-flag-blocks-rebuild-invalidation.md)

A due seat runs all five strategic modules (workforce, build order, scout, population, military) in
one tick. Live magiczny_las 6-AI evidence (rev fb833032, `?debug=profile`): `aiPlayer` mean
3.8-5.1 ms/tick but max 41-54 ms on the due tick, and with six staggered seats a due tick lands
every ~4th tick - the per-seat pass is the dominant recurring frame spike. Most of today's max is
the work-flag rebuild (its own ticket); this ticket bounds whatever remains.

## Scope

- Re-measure the due-tick max after the blocker-rebuild fix lands; proceed only if the residual
  still spikes past a normal tick.
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
