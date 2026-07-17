# Investigate the aiSystem's superlinear cost curve at multi-settlement scale

**Area:** sim (agents) · **Origin:** first `npm run bench:sim` run, 2026-07-17 · **Priority:** P2
(measured performance — investigate-first; no behavior change intended)

The per-system benchmark's first run shows `aiSystem` taking **~97% of the tick** at RTS scale, and
growing **faster than the population**: 4× the settlers costs ~39× the AI time. Golden rule 6 says
per-tick cost scales with active work, never entities²; this curve is the first measured candidate
for a violation.

Measured on one laptop (economy-only, no fighters; 40 warmup + 120 measured ticks; ticks 40–160, so
this is *early-window*, every crew busy). Absolute ms are machine-dependent — the **ratios** are the
signal:

| settlements | settlers | map (cells) | ai median | tick median | ai share |
| ----------- | -------- | ----------- | --------- | ----------- | -------- |
| 1           | 72       | 100×100     | 0.684 ms  | 1.005 ms    | 79.8%    |
| 2           | 144      | 196×100     | 8.808 ms  | 9.496 ms    | 95.4%    |
| 4           | 288      | 196×196     | 26.596 ms | 27.782 ms   | 97.3%    |

Reproduce: `ON_BENCH_SETTLEMENTS=<n> ON_BENCH_FIGHTERS=0 ON_BENCH_WARMUP=40 ON_BENCH_TICKS=120 npm run bench:sim`.

## Investigate first (do not assume a cause)

1. **Disentangle population from map area.** The bench derives its map size from the settlement
   tiling, so the runs above grow *both* (100×100 → 196×196 is 3.8× the area). A cost that tracks map
   area is a different defect from one that tracks entities². The bench needs a knob that holds one
   fixed while varying the other (or a hand-built world that does), and that measurement is step one —
   every hypothesis below is unranked until it exists.
2. **The 1→2 step (12.9×) is far steeper than the 2→4 step (3.0×)**, though each doubles both
   settlers and area. A smooth O(n²) does not produce that shape; a **threshold cutover** does.
   `docs/tickets/sim/confined-idle-worker-dormancy.md` names one such cutover already landed —
   `RING_MIN_BUCKETS`, the linear-vs-ring path choice for sparse indexes (`cell-index.ts`). Check
   whether the 1-settlement world sits on the cheap side of it and 2+ settlements on the other.
3. **Candidate-set growth across settlements.** The tiled settlements share one map with no signposts
   placed, so a settler's nearest-X searches may range over *every* settlement's stores and
   workplaces rather than its own — settlers × map-wide candidates. If so, the bench world is
   unrepresentative of confined play *and* representative of an 8-player map; say which before fixing.

## Not a duplicate of the known planner tickets (but they overlap — re-measure both)

- `sim/confined-idle-worker-dormancy.md` (P2) is the *late-run, confined, idle* rescan cost (~0.7 ms →
  ~12 ms by ticks 2000–2300). This curve is early-window with crews busy, and its 1-settlement figure
  (0.684 ms) **independently reproduces that ticket's ~0.7 ms early-run baseline** — a useful
  cross-check that both measurements are sound. Fixing dormancy may or may not move this curve.
- `sim/lazy-target-cell-indexes.md` (P3) and `sim/incremental-spatial-index-memos.md` (P2) both touch
  the index machinery the planner reads through; either could be the mechanism here.

Grep these three before filing any new work — the fix may belong in one of them instead.

## Verify

- The bench curve flattens: re-run the table above; AI cost must grow no faster than the population
  once the map-area confound is separated out.
- `npm test` with **goldens byte-identical** — a planner optimization that moves a golden has changed
  a pick (canonical ascending-id / `(distance, id)` winners must survive).
- `npm run check`, `npm run build`.

## Source basis

None needed — an engine cost budget, not a mechanic. No original behavior is being matched.
