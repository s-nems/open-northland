# Heavy-load reference: `magiczny_las`, six AI seats, 100k ticks

The yardstick the runtime-architecture epic (`docs/tickets/runtime-architecture/`) measures against
until ticket 00 delivers its war scenario. Session: `?map=magiczny_las&player=observer&ai=0,1,2,3,4,5`
(the map adds its own computer seat, so seven AI seats play), map rules for progression and needs,
100 000 measured ticks after a 200-tick warm-up, headless through `npm run bench:map`. Fog and speed
flags do not change tick cost, so the browser URL with `fog=reveal&speed=10` measures the same world.

Machine: Apple M2 Pro, 10 cores, Node 26.5. The long run shared the box with an IDE and a browser, so
the bench flagged it (load average 5.9 per core at the worst minute) while its calibration kernel held
at 2.00 ms before and after. The repeat runs below, from checkpoints on a quieter box, reproduce the
long run's medians within 4%, so its curve is used with that caveat and the repeat runs carry the
absolute numbers.

## Reproduce

```bash
export ON_CONTENT_DIR=<primary checkout>/content
ON_BENCH_TICKS=100000 ON_BENCH_WINDOWS=20 ON_BENCH_CHECKPOINT=bench-out/ml6.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,30000,40000,50000,60000,70000,80000,90000,100000 npm run bench:map
# late-game re-measure (2k ticks) and profile from a checkpoint
ON_BENCH_CHECKPOINT=bench-out/ml6.t90000.checkpoint ON_BENCH_TICKS=2000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint npm run bench:profile
```

The long run takes about 45 minutes; the checkpoints are plain save games (21 to 23 MB of JSON each,
0.8 to 1.2 s to export and write at every size). The final state hash of the long run is `e72b5da2`.

## Growth curve

| window | ticks | median ms | p95 ms | p99 ms | max ms | settlers | fighters | buildings | gc ms | heap MB | rss MB |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 203..5202 | 2.65 | 18.0 | 31.9 | 154 | 612 | 53 | 62 | 415 | 330 | 729 |
| 4 | 15203..20202 | 3.06 | 8.9 | 18.7 | 119 | 662 | 53 | 95 | 479 | 812 | 1195 |
| 8 | 35203..40202 | 4.19 | 9.2 | 14.6 | 38 | 922 | 89 | 148 | 429 | 654 | 1642 |
| 10 | 45203..50202 | 6.15 | 16.0 | 30.8 | 175 | 1167 | 195 | 191 | 734 | 1090 | 1441 |
| 12 | 55203..60202 | 9.14 | 20.1 | 44.9 | 107 | 1545 | 350 | 243 | 846 | 1338 | 1794 |
| 14 | 65203..70202 | 19.25 | 45.3 | 91.5 | 236 | 1926 | 612 | 303 | 1397 | 786 | 1622 |
| 16 | 75203..80202 | 22.64 | 48.4 | 98.4 | 216 | 2428 | 836 | 341 | 1812 | 716 | 1647 |
| 18 | 85203..90202 | 32.52 | 82.7 | 158.3 | 449 | 2713 | 1051 | 391 | 2874 | 1041 | 1719 |
| 20 | 95203..100202 | 34.07 | 74.3 | 129.7 | 280 | 2613 | 869 | 422 | 2411 | 854 | 1885 |

GC columns are per 5000-tick window. The heap oscillates between 330 and 1340 MB with no monotone
climb, so there is no leak, but late windows pay 2.4 to 2.9 s of GC pauses per 5000 ticks with single
pauses up to 130 ms. RSS peaks at 1.9 GB in Node; the browser held a 1.3 GB JS heap at tick 90k.

Population outgrows the earlier 13-seat reference (about 1000 settlers at 60k): seven AI seats on this
map reach 2700 settlers and 1050 fighters at 90k, and the tick median grows 13x for a 4.3x settler
count. The AI armies reach the 150-per-seat cap around 85k and no war breaks out in 100k ticks, so
every combat number here is peacetime overhead.

Per-system medians per tick (ms), window 1 against window 20:

| system | w1 | w20 | growth | w20 p95 | w20 max |
|---|---|---|---|---|---|
| planner | 0.530 | 13.661 | 25.8x | 26.4 | 91 |
| combat | 0.425 | 3.949 | 9.3x | 6.1 | 28 |
| separation | 0.070 | 3.490 | 49.9x | 5.2 | 28 |
| movement | 0.094 | 2.200 | 23.4x | 3.1 | 53 |
| pathfinding | 0.055 | 1.969 | 35.8x | 4.8 | 100 |
| needs | 0.044 | 0.943 | 21.3x | 1.5 | 9 |
| production | 0.011 | 0.878 | 77.2x | 1.6 | 8 |
| atomic | 0.056 | 0.514 | 9.1x | 0.9 | 5 |
| animalWander | 0.248 | 0.285 | 1.1x | 0.4 | 6 |
| livestockCapture | 0.064 | 0.282 | 4.4x | 0.6 | 8 |
| family | 0.019 | 0.254 | 13.5x | 0.4 | 7 |
| aiPlayer | 0.002 | 0.003 | - | 37.5 | 232 |

`aiPlayer` is the row the median table hid until this branch: one seat decides every 24 ticks, and
seat `p` is due when `tick % 24 === p`, so the seven seats fire on seven consecutive ticks. Late in the
run each of those ticks carries 90 to 200 ms of AI (250 to 357 ms on the loaded box), followed by 17
quiet ticks: a stall cluster every 24 ticks. The worst clusters are the flag-relocation rounds: every
30th decision (once per 720 ticks) all seven seats re-aim their collector flags in the same seven-tick
run (`flagRelocateDue` keys on the tick alone), and every one of the ten slowest ticks in the 80k, 83k,
89k and 100k profiles sits on such a run (for example 89280..89285), 100 to 210 ms of `aiPlayer` each,
with the command system paying 4 to 14 ms on the following ticks to apply the flag moves. `aiPlayer`
topped 10 200 of the run's slow ticks (over twice the median), the planner 23 220, everything else
under 400 together. Since this branch the bench ranks systems by mean tick time, which puts `aiPlayer`
second at 90k.

## Late game from the 90k checkpoint

Two 2000-tick runs restored from `ml6.t90000.checkpoint` (2716 settlers, 1004 fighters, 412 buildings)
agree on the state hash `9b585c63`; medians 19.83 and 19.55 ms, p95 44.9 both, p99 81.2 both. The
same pair from `ml6.t50000.checkpoint`: hash `43f62980`, medians 5.82 and 6.03 ms. Mean per tick and
share of the summed system time at 90k:

| system | mean ms | median ms | p95 ms | max ms | share |
|---|---|---|---|---|---|
| planner | 7.69 | 7.13 | 12.5 | 97.3 | 32.0% |
| aiPlayer | 4.58 | 0.002 | 25.2 | 144.3 | 19.0% |
| separation | 3.09 | 3.04 | 3.8 | 6.2 | 12.8% |
| combat | 2.76 | 2.72 | 3.5 | 8.6 | 11.5% |
| pathfinding | 1.47 | 1.23 | 3.1 | 10.9 | 6.1% |
| movement | 1.41 | 1.38 | 1.9 | 3.6 | 5.9% |
| needs | 0.57 | 0.56 | 0.7 | 1.3 | 2.3% |
| production | 0.56 | 0.52 | 0.9 | 8.7 | 2.3% |
| atomic | 0.36 | 0.34 | 0.6 | 3.0 | 1.5% |
| vision | 0.29 | 0.001 | 1.5 | 2.9 | 1.2% |
| animalWander | 0.26 | 0.25 | 0.3 | 4.1 | 1.1% |

**Sync digest** (`ON_BENCH_SYNC_DIGEST=on`, what every lockstep client pays): the same 2000 ticks cost
a median of 23.11 ms instead of 19.7, so the per-tick digest adds about 3.3 ms (17%) at 2700 settlers.
The systems themselves are unchanged; the cost sits in `step()` after them.

## Where the time goes (CPU profiles)

`npm run bench:profile` over 2000 ticks from four checkpoints, inclusive share of sampled time:

| function | 20k | 50k | 80k | 100k |
|---|---|---|---|---|
| plannerSystem | 25.2% | 29.9% | 31.7% | 35.5% |
| aiPlayerSystem | 16.4% | 19.3% | 15.8% | 18.1% |
| combatSystem | 12.8% | 9.7% | 9.0% | 9.3% |
| separationSystem | 6.8% | 6.8% | 10.4% | 9.2% |
| movementSystem | 4.7% | 5.6% | 6.4% | 5.7% |
| pathfindingSystem | 4.2% | 5.3% | 6.2% | 5.0% |
| animalWanderSystem | 5.0% | 2.1% | 0.8% | 0.5% |

At 80k (52 s sampled) the call trees resolve to these terms:

- **Planner 31.7%.** `planAdult` 19.3%, of which `planEconomy` 14.1%: `planProducer` 5.9%
  (`nearestMissingInputSource` 2.8%, `planVehicleYard` 1.0%, `recipesFor` 0.8%), `planGatherer` 1.6%,
  `planWorkshopSupplier` 1.3% (again `nearestMissingInputSource`), `planPorter` 1.3%, `planDelivery`
  1.3%, `planBuilder` 1.0%; `planNeeds` 1.5% (`nearestFood` 1.1%). Outside the ladder:
  `releaseStaleIntent` 2.9% (runs for every acting settler before the idle gate), `beginPlannerPass`
  2.1% (`StationaryOwned.catchUp` 0.8%), `navigationPlanner` 1.9% (a pass over every walker).
  `nearestMissingInputSource` in total is 4.2%: `inputSources` (`targets/bands.ts`) filters every
  stockpile per good asked (2.2% self) and the cell index falls to its linear scan
  (`linearNearest` -> `nearestByCell` 1.0%).
- **AI 15.8%, all inside 1 tick in 24.** `runWorkforce` 13.7%: `upkeepHolders` 5.6% (`patchWorked` ->
  `patchHarvestable` -> `region.someNear` 2.2%; `replantSpot` -> `flagSpotNear` -> `cheapestRingNode`
  -> `legOf` 2.3%), `supply.of` -> `seatStockOf` -> `deriveSeatStock` 3.0% (a from-scratch fold over
  the seat's stockpiles per query), `allocateScout` -> `nextSignpostTarget` -> `corridorGoals` ->
  `nearestLiveResource` 1.6%; `runMilitary` 1.3%. At 100k `upkeepHolders` alone is 8.7%.
- **Separation 10.4%.** `collectColliders` 5.2% (self 2.0%, `writeLegHeading` 1.5%, `NodeBuckets.refill`
  1.1%), system self 2.5%, `resolveMoverPush` 1.3%. Separation grew 50x over the run, the steepest
  curve of any system, on a 4.3x settler count.
- **Combat 9.0% with no war.** `engageCombatant` 3.7% over every settler and animal, the `CombatIndex`
  build 1.7%, the dormancy gate 0.6%, the canonical join 0.3%: every combatant pays the ladder every
  tick once two owners exist.
- **Movement 6.4%.** `walkHumanLeg` 3.0%; `world.mut` -> `recordValueWrite` 1.1% (revision and
  touched-log bookkeeping per walker per tick).
- **Pathfinding 6.2%.** `findPath.advance` 3.4% (`stepsInto` 1.7%, heap 0.6%); `unitWalkBlocks` 1.9%,
  of which `eachStandingFighter` 0.9% is a scan over every settler per routing tick.
- **ECS floor.** `world.get`/`tryGet`/`has`/`storeOf` about 9% self combined, `query-iterator.next`
  1.4%, `component-revisions.record` 1.2%, `touched-log.record` 0.7%, `block-overlay.has` 2.1%,
  `world-metric.staggerShift` 2.0%, `fixed.assertSafe` 0.9%.

The two static reviews that fed the ticket list predicted most of these terms from loop shapes before
the profiles ran; the profile-confirmed ones became tickets, the rest stay in this report as hypotheses.

## Live session: sim against draw

The 90k checkpoint staged into the app's pending-load store and restored by the `?map=` entry in a
Playwright Chromium (1600x900, `fullscreen=off`, boot from the staged save 3.5 s), read through
`window.__opennorthland.perf()` over 30 s windows:

| mode | fps | frame mean ms | sim ms/frame | snapshot ms/frame | draw ms/frame | frame p95 | frame p99 | delivered speed | dropped ticks |
|---|---|---|---|---|---|---|---|---|---|
| speed 1 | 75 | 13.3 | 4.1 | 1.5 | 11.2 | 58 | 76 | 1.00x (12.0 t/s) | 0 |
| speed 3 | 11 | 95.2 | 69.2 | 6.6 | 22.9 | 176 | 407 | 2.85x (34.2 t/s) | 50 |
| paused | 88 | 11.3 | 0 | 0 | 5.3 (+6.1 GPU) | 19 | 19 | - | - |

At speed 1 the sim takes 20 ms per step spread over frames, but the draw alone costs 11 ms per frame
against 5.3 ms paused: the frame that follows a step re-reconciles about 2000 drawn sprites out of
35 700 entities. Frame p95 at speed 1 is 58 ms, which is the AI stall cluster landing on single frames.
Speed 3 is not sustainable at this scale: the loop caps at 5 steps per frame, drops ticks, and a frame
with the AI cluster inside reaches 400 ms. This is the split ticket 00 asks `FrameStats` to report per
frame class; here it is read from three separate windows instead.

## What this means for the epic

- The worker host (04) removes 20 ms of sim from the frame at speed 1 but not the 11 ms draw; the
  mirror and its indexes (02, 03) have to bring the draw of a stepped frame back toward the 5 ms paused
  floor.
- A full snapshot clone is measured here as 1.5 ms per frame at 35 700 entities on the main thread;
  the delta of 02 has to beat that plus the structured-clone cost of a worker boundary.
- The relay's catch-up store carries a 23 MB JSON save at this scale, exported in about 1 s; a
  compressed and binary form is a 00/10 decision, not a sim one.
- The digest adds 17% to a lockstep tick at 2700 settlers; the split digest of 10 should be measured
  against that number.
- The AI stall cluster is the single largest frame-level defect and is independent of the epic: see
  the AI decision ticket. Spreading seats or modules across the 24-tick window is a behaviour change
  the owner has to rule on.

## Tickets filed from this run

Per-system optimisation runs beside the epic; these tickets carry the numbers above and the code
evidence, all under `docs/tickets/sim/`:

- [`ai-decision-tick-slicing.md`](../tickets/sim/ai-decision-tick-slicing.md) (rewritten): the seat
  pass cost, its terms, the consecutive-tick seat slots and the flag-relocation round.
- [`ai-seat-stock-ledger.md`](../tickets/sim/ai-seat-stock-ledger.md): `deriveSeatStock` folded from
  scratch per AI query because its memo keys on generations that move every tick.
- [`planner-store-searches-scan-every-stockpile.md`](../tickets/sim/planner-store-searches-scan-every-stockpile.md):
  `inputSources` duplicating the fetchable-stock ledger, `sinksFor`, the porter's pile scan and the
  cell index's linear fallback.
- [`planner-standing-waits-replan-every-tick.md`](../tickets/sim/planner-standing-waits-replan-every-tick.md):
  seated crafters, loiterers and site-waiting builders re-planned every tick (owner ruling on latency).
- [`planner-idle-settlers-visited-every-tick.md`](../tickets/sim/planner-idle-settlers-visited-every-tick.md):
  idle settlers visited before the idle gate.
- [`navigation-planner-rechecks-every-walker.md`](../tickets/sim/navigation-planner-rechecks-every-walker.md).
- [`standing-fighters-full-settler-scans.md`](../tickets/sim/standing-fighters-full-settler-scans.md):
  the full-population fighter scans behind separation, routing and melee slots.
- [`combat-pass-visits-every-combatant.md`](../tickets/sim/combat-pass-visits-every-combatant.md): the
  per-combatant ladder with no war.
- [`combat-target-search-at-army-scale.md`](../tickets/sim/combat-target-search-at-army-scale.md) and
  [`combat-route-searches-outside-budget.md`](../tickets/sim/combat-route-searches-outside-budget.md):
  the predicted army-scale terms (band collect and sort without a target lock, chase geometry,
  unbudgeted searches at walls), blocked on ticket 00's war probe.

Confirmed in code but below the admission bar at this scale, with their 80k profile share:
canonical-query joint rebuilds on Position churn 0.55% and `removeSortedById` 0.17%; generation-journal
wrap forcing ledger rebuilds 0.19% (re-count at army scale); `GossipCandidates` refill 0.57%; the
harvest and construction claim passes 0.08%; `animalWander` 0.86%, flat at 0.3 ms; the cut-off check
0.01%; per-walker `world.mut` bookkeeping 2.3%, which is per-change cost as the contract asks. Without a
ticket yet and next in line: the pathfinding search itself (6.2%, 35.8x growth) needs request and node
counts; `production` grew 77x to 2.7%; `nearestFoodStore` and `materialSource` fall back to linear
scans (1.1% together); `needs` grew 21x on a 4.3x population through `drainNeeds` writes; no allocation
profile exists yet for the 2 to 3 s of GC per 5000 ticks; and the bench's own per-system wrapper is
4.9% self time of a profiled run.
