# Investigate the aiSystem's cost share and superlinear curve at multi-settlement scale

**Area:** sim (agents) · **Origin:** first `npm run bench:sim` runs, 2026-07-17 · **Priority:** P3
(measured performance — investigate-first; no behavior change intended)

The per-system benchmark's first runs show `aiSystem` is **where the sim's per-tick budget goes**:
79–89% of the tick at every scale measured, with every other system a rounding error. Its cost also
grows **about twice as fast as the population** — 4× the settlers costs ~7.8× the AI time. Golden
rule 6 says per-tick cost scales with active work, never entities²; this is the first measured
candidate for a violation, but it is *not* proven to be one — see the confound below.

Measured on `ed0bc2e5`, one laptop (economy-only, no fighters; 40 warmup + 120 measured ticks, so
this is the *early window*, every crew busy). Absolute ms are machine-dependent — the **ratios** are
the signal:

| settlements | settlers | map (cells) | ai median | tick median | ai share |
| ----------- | -------- | ----------- | --------- | ----------- | -------- |
| 1           | 72       | 100×100     | 0.635 ms  | 0.905 ms    | 79.2%    |
| 2           | 144      | 196×100     | 2.187 ms  | 2.671 ms    | 87.0%    |
| 4           | 288      | 196×196     | 4.974 ms  | 5.858 ms    | 88.9%    |

Reproduce: `ON_BENCH_SETTLEMENTS=<n> ON_BENCH_FIGHTERS=0 ON_BENCH_WARMUP=40 ON_BENCH_TICKS=120 npm run bench:sim`.

Do not compare against numbers from before `ed0bc2e5`: the same table taken on `a94bbffd` showed a
far worse curve (4× settlers → **39×** AI time, with a 12.9× step from 1 to 2 settlements). The
blocked-spawn fix (`8adb89a6`, "Push settlers that spawn on blocked ground out of the walls") is the
likely cause of the improvement — settlers stuck on blocked ground re-planned fruitlessly every tick.
That is a *hypothesis about a past measurement*, not a claim about current code; it matters only as a
warning that this curve moves with unrelated agent fixes, so always re-measure the baseline.

**Where the AI time goes (measured 2026-07-18, V8 profile of the 4-settlement + 200v200-fighter
bench window, 300 ticks):** the nearest-X scans are ~49% of all sampled time — `nearestStoreFor`
4.3 s, `nearestWorkplaceOutput` 1.6 s, `nearestMissingInputSource` 1.2 s of a 13.8 s window — and
the `canStoreGood` accept alone is ~15%. The ring index is already in place, so the cost is scan
COUNT × accept cost, not the walk. Candidate constant-factor lever: memoize the accept's
per-(store, good) capacity answer for the planner tick (the `SinkAvailability` shape) so N settlers
scanning the same stores stop re-deriving `mergedRecipeOf`/`stockCapacity` per probe — coordinate
with `farm-crop-sink-gate.md` (P1), which is about to change `canStoreGood`'s semantics. The five
per-tick `NodeBuckets` builds (combat, separation, ai spacing, production, job) total only ~3%
inclusive — not the lever.

## Investigate first (do not assume a cause)

1. **Disentangle population from map area.** The bench derives its map size from the settlement
   tiling, so the runs above grow *both* (100×100 → 196×196 is 3.8× the area). A cost that tracks map
   area is a different defect from one that tracks entities², and at 4× population / 3.8× area a 7.8×
   cost is consistent with either. The bench needs a knob that holds one fixed while varying the
   other (or a hand-built world that does). **This measurement is step one — everything below is
   unranked speculation until it exists**, and it may well show there is no defect here at all.
2. **Candidate-set growth across settlements.** The tiled settlements share one map with no signposts
   placed, so a settler's nearest-X searches may range over *every* settlement's stores and
   workplaces rather than its own — settlers × map-wide candidates. If so, the bench world is
   unrepresentative of confined play *and* representative of an 8-player map; say which before fixing.
3. **The share itself may be the more useful finding than the curve.** Even at one settlement the
   planner is ~79% of the tick. If that is inherent (the planner *is* the game's work), then the
   scaling question is the only one worth asking; if it is not, there is a constant factor to win
   that no scaling fix would find.

## Not a duplicate of the known planner tickets (but they overlap — re-measure both)

- The *late-run, confined, idle* rescan cost (~0.7 ms → ~12 ms by ticks 2000–2300) was FIXED on
  2026-07-17 by the porter dormancy gate (`systems/agents/economy/porter-dormancy.ts`; 1-settlement
  2400-tick median 8.94 → 0.674 ms). This curve is early-window with crews busy, and its 1-settlement
  figure (0.635 ms) independently reproduced the pre-fix ~0.7 ms early-run baseline. Re-measure the
  curve on top of the gate before investigating — busy crews don't go dormant, so the superlinear
  early-window growth may stand unchanged.
- `sim/lazy-target-cell-indexes.md` (P3) touches the index machinery the planner reads through and
  could be the mechanism here. The other index candidate was FIXED on 2026-07-18: the spatial index
  memos (region/stockpile/tile) are now maintained incrementally via the World membership journal
  (`systems/spatial-memo.ts`) instead of rebuilding wholesale per generation bump — re-measure the
  curve on top of that too.

Grep these before filing any new work — the fix may belong in one of them instead.

## Verify

- The bench curve flattens: re-run the table above; AI cost must grow no faster than the population
  once the map-area confound is separated out.
- `npm test` with **goldens byte-identical** — a planner optimization that moves a golden has changed
  a pick (canonical ascending-id / `(distance, id)` winners must survive).
- `npm run check`, `npm run build`.

## Source basis

None needed — an engine cost budget, not a mechanic. No original behavior is being matched.
