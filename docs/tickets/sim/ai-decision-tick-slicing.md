# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2

A due seat runs all five strategic modules in one tick (`runAiPlayerModules`, `ai-player/index.ts`;
seat `p` is due when `tick % AI_DECISION_INTERVAL_TICKS === p % 24`), so with 13 seats 13 of every 24
ticks carry one full pass. On `magiczny_las_12_players` with 13 AI seats (900-1050 settlers, 210-238
buildings) `aiPlayer` sits at a 0.2-0.7 ms median but a 2.9-3.1 ms p95 in every late profile, with
single ticks of 6.8 ms (quiet profile from the 40k checkpoint) and 8.4-10 ms (busy-machine profiles
from 50k and 60k; profiled timings are inflated by the sampler). Timing every module of every seat
pass over ticks 40000-43956, 50000-51724 and 60000-61923 (instrumented replay, busy machine) gives a
pass median of 1.0-1.2 ms, p95 2.6-3.1 ms and warm worst passes of 4-5 ms, made of two parts:

- **A stalled build entry re-searches every decision.** 617 of 622 `placementSpot` calls
  (`ai-player/build-order/placement.ts`) returned null, all from seats 10 and 12 for the same
  training building (type 39), each costing 1.5-3.9 ms and repeating every 24 ticks for the whole
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

## Scope

- Make the placement search cheaper without changing its answer: a numeric occupied-anchor key
  instead of a string per candidate. State hash unchanged.
- Remember a stalled entry's failed search and skip the re-search until something its answer depends
  on changes (building membership, the seat's placement-probe inputs), with the memo a pure function
  of world state so replays hold. If the probe inputs (fog, contested ground) move too often for an
  exact key, a deterministic retry cadence is the fallback.
- If warm passes still exceed ~2 ms after that, spread one seat's modules across consecutive ticks
  (module slot derived from tick and seat). Modules communicate only through commands applied next
  tick; show that the module pairs that share a tick today do not couple before splitting them.

**Gameplay limit option (needs the user's decision):** a retry cadence for stalled entries (for
example one re-search every fifth decision, 10 s) cuts the stall cost by 80% but lets a seat place
that building up to 10 s after ground frees instead of 2 s. The AI would react visibly slower to
freed ground only for an entry that was already stuck.

## Verify

- Headless: a seat with a permanently unplaceable entry runs the spot search once per change of its
  inputs, not once per decision; existing build-order tests keep their placements.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map`, then
  `npm run bench:compare`: `aiPlayer` p95 and max fall toward the median. The numeric key keeps the
  state hash; a retry cadence or module slicing moves it and the commit names the cadence change.
- `npm test`, `npm run check`, `npm run build`.
