# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2

A due seat runs all five strategic modules in one tick (`runAiPlayerModules`, `ai-player/index.ts`;
seat `p` is due when `tick % AI_DECISION_INTERVAL_TICKS === p % 24`), so with 13 seats 13 of every 24
ticks carry one full pass. On `magiczny_las_12_players` with 13 AI seats, the trust-clean
`npm run bench:profile` from the 40k checkpoint (900-922 settlers, 210 buildings; profiled timings are
inflated by the sampler) puts `aiPlayer` at a 0.69 ms median, a 2.86 ms p95 and a 6.8 ms max. The
busy-machine profiles from 50k and 60k show the same p95 and single ticks of 8.4-10 ms (absolute ms
suspect). Timing every module of every seat pass over ticks 40000-43956, 50000-51724 and 60000-61923
(instrumented replay, busy machine, so the ms are suspect) gives a pass median of 1.0-1.2 ms, p95
2.6-3.1 ms and warm worst passes of 4-5 ms, made of two parts:

- **A stalled build entry re-searches every decision.** 617 of 622 `placementSpot` calls
  (`ai-player/build-order/placement.ts`) returned null (exact count), all from seats 10 and 12 for the
  same training building (type 39), each costing 1.5-3.9 ms and repeating every 24 ticks for the whole
  run. Nothing remembers that the spot search already failed: the code itself notes that "a stalled
  entry re-walks the whole fan every decision". Inside the search, the `buildingSpotAccept` closure
  formats a `${x},${y}` string per candidate to test the occupied-anchor set, 45% of
  `placementSpot`'s time at 40k.
- **The workforce module** (`collectResources`, mean 0.8-0.9 ms, peaks 4 ms): `upkeepHolders` 15-18%
  of `aiPlayer`, `allocateScout` -> `nextSignpostTarget` 6-11% (it refloods route-region pockets,
  whose labels every construction advance invalidates; see
  [building-blocked-cells-rebuilt-per-construction-advance.md](building-blocked-cells-rebuilt-per-construction-advance.md)),
  generic collector allocation 8-10%.

The first pass after a checkpoint restore spikes to 30-115 ms on cold code; that is a benchmark
artefact, not part of this ticket.

Expected gain: spike only, `aiPlayer` p95 2.9 ms and max 6.8 ms at 40k toward its 0.7 ms median.

## Scope

- Make the placement search cheaper without changing its answer: a numeric occupied-anchor key
  instead of a string per candidate. State hash unchanged.
- Decision: a stalled placement entry (no spot found) keeps retrying forever, but on a slow cadence:
  one re-search every 30th decision of its seat (`STALLED_PLACEMENT_RETRY_DECISIONS`, about 60 s at the
  24-tick decision interval), not every decision. The case is a map that ran out of room and may free
  up later, for example after many trees are cut, so a late placement is fine and giving up is not.
  Derive the retry from the tick and seat, or keep the failing decision in the seat's AI state; if that
  state is saved, it is a save-format change. This changes when a stuck seat places, so state hashes
  change: regenerate the goldens in the same commit and name the behaviour change.

**Needs the user's decision:** spreading one seat's modules across consecutive ticks (module slot
derived from tick and seat) moves when each module's commands land, so it changes state hashes.
Consider it only if warm passes still exceed ~2 ms after the changes above. Modules communicate only
through commands applied next tick; show that the module pairs that share a tick today do not couple
before splitting them.

## Verify

- Headless: a seat with a permanently unplaceable entry runs the spot search once per
  `STALLED_PLACEMENT_RETRY_DECISIONS` decisions, and places the building on the first retry after
  ground frees; existing build-order tests keep their placements.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `aiPlayer` p95 and max fall toward the
  median. The numeric key keeps the state hash; the retry cadence moves it and the commit names the
  behaviour change.
- `npm test`, `npm run check`, `npm run build`.
