# Heavy-load reference: `krwawa_rzeka`, twelve AI seats, 100k ticks, sim in a worker

The late-game yardstick for the worker runtime: the sim steps in a Web Worker and the main thread
draws from a snapshot mirror fed by per-tick deltas. Session:
`?map=krwawa_rzeka&player=observer&ai=0,1,2,3,4,5&fog=classic&progression=on&needs=on` (the map adds its
own computer seats, so seats 0-11 all play under AI). Normal play speed is x3 (36 ticks/s); the 120 FPS
target leaves 8.3 ms of main-thread time per frame, and the worker has 27.8 ms per tick on average.

Machine: Apple M2 Pro, 10 cores, Node 26.5, rev 48386937d. The long run shared the box with a live
browser session (load 4.8 per core, calibration kernel steady at 1.88 ms), so its absolute ms read
20 to 50% high; the checkpoint repeats and counters below ran on a quieter box and carry the absolute
numbers. The [`magiczny_las` reference](heavy-load-magiczny-las-6ai.md) predates the worker.

## Reproduce

```bash
export ON_CONTENT_DIR=<primary checkout>/content ON_BENCH_MAP=krwawa_rzeka ON_BENCH_SEATS=0,1,2,3,4,5 \
  ON_BENCH_PROGRESSION=on ON_BENCH_NEEDS=on
ON_BENCH_TICKS=100000 ON_BENCH_WINDOWS=20 ON_BENCH_CHECKPOINT=bench-out/kr.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,20000,40000,60000,80000,100000 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/kr.t100000.checkpoint npm run bench:profile
ON_BENCH_PROFILE=alloc ON_BENCH_TICKS=1000 ON_BENCH_CHECKPOINT=bench-out/kr.t100000.checkpoint npm run bench:profile
ON_BENCH_MIRROR=on ON_BENCH_TICKS=2000 ON_BENCH_CHECKPOINT=bench-out/kr.t100000.checkpoint npm run bench:map
```

The long run takes about 15 minutes; checkpoints are 9 to 11 MB saves written in under 0.5 s. Final
state hash `e98475b0`; the t100k checkpoint's 2000-tick repeat ends at `51b7943a`, the t80k one at
`b7de3ac4`.

## Growth curve (headless, loaded box)

| window | ticks | median ms | p99 ms | max ms | settlers | fighters | buildings | gc ms | heaviest |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 203..5202 | 1.42 | 3.3 | 8 | 546 | 0 | 51 | 53 | planner |
| 6 | 25203..30202 | 1.96 | 4.6 | 28 | 617 | 0 | 114 | 100 | planner |
| 10 | 45203..50202 | 3.71 | 14.6 | 71 | 944 | 24 | 162 | 200 | planner |
| 12 | 55203..60202 | 6.11 | 24.9 | 81 | 1209 | 158 | 206 | 471 | planner |
| 14 | 65203..70202 | 9.41 | 56.0 | 111 | 1534 | 265 | 267 | 685 | planner |
| 16 | 75203..80202 | 15.38 | 94.8 | 280 | 1676 | 362 | 296 | 1149 | aiPlayer |
| 18 | 85203..90202 | 15.44 | 42.8 | 124 | 1861 | 423 | 310 | 974 | planner |
| 20 | 95203..100202 | 17.05 | 41.9 | 110 | 1694 | 322 | 302 | 1192 | planner |

GC columns are per 5000-tick window. Entities stay near 18 000 throughout, mostly landscape. Nine of
the ten slowest ticks (95 to 379 ms of `aiPlayer`) fall on one seat's decision slot.

Per-system mean ms per tick, 2000 ticks from the checkpoints (t80k under the CPU sampler on a quiet
box, t100k beside the mirror probe at load 1.15 per core; both read somewhat high):

| system | t80k | t100k |
|---|---|---|
| planner | 5.44 | 8.30 |
| aiPlayer | 4.35 | 2.37 |
| combat | 1.95 | 2.71 |
| separation | 1.38 | 1.44 |
| movement | 1.04 | 1.29 |
| pathfinding | 1.13 | 1.02 |
| production | 0.52 | 0.59 |

## Where the sim's time goes (CPU profile, t100k, inclusive)

`plannerSystem` 36.9% (`planAdult` 23.1%, `planEconomy` 16.7%, `releaseStaleIntent` 4.8%), combat 13.5%,
`aiPlayer` 12.1% (`runWorkforce` 8.3%), `InteractionCellIndex` linear tail 4.3%, separation 5.8%,
movement 5.6%, pathfinding 5.5%, ECS accessors about 10% self (196 000 calls a tick at about 6 ns),
`staggerShift`/`worldX` 2.8 to 3.2%, signpost `allowsNode` 2.4%, gossip `ensure` 2.0%. At t80k one
seat's collector re-plant loop (`upkeepHolders` 12.8%) dominates `aiPlayer`. The bench's own
per-system wrapper is about 4% self, which inflates every share.

## Allocation (t100k)

5.2 MB allocated per tick, about 165 KB of it promoted. Canonical joint rebuilds 961 KB (18.5%),
iterator results over frozen shared lists 862 KB (16.6%), `region.near` 318 KB, `networkLimitAt` 223 KB,
`engageSpec` 166 KB, A* node records 165 KB (35% of the promoted bytes), `NodeBuckets.refill` 153 KB,
pile merges 144 KB, `nodeOfPosition` 125 KB, per-tick cell indexes 115 KB. About 890 scavenges per 5000
ticks at 0.6 ms each on a quiet box, one mark-compact per 600 to 1000 ticks; the live set after a full
GC is 175 to 186 MB, so the 280 to 1080 MB heap swing is promoted garbage, not retention.

## Delta path (`ON_BENCH_MIRROR=on`)

| | t40k | t60k | t100k |
|---|---|---|---|
| touched entities per delta | 447 | 939 | 1453 |
| components written per delta | 1117 | 2239 | 3542 |
| delta size (V8 serialized) | - | 164 KB | 269 KB |
| take, worker, p50 | 1.6 ms | 3.95 ms | 5.2 to 6.8 ms |
| serialize / deserialize | - | - | 0.9 / 1.7 ms |
| apply, bare / with the runtime's indexes | 0.3 / - | 0.53 / 3.9 ms | 0.8 / 6.4 ms |

A five-tick delta touches 1484 entities against 1453 for one tick, so a delta's cost barely depends on
the ticks it spans. Of the touched entities 85% write only per-tick counters and positions (`Settler`
needs, `PathFollow`, `Position`, `AtomicClock`); `Settler` alone is 40% of the bytes. Index upkeep per
delta at t60k: HUD totals 0.83 ms, bubble carriers 0.44, the `withComponent` lists 0.44 together,
position buckets 0.15. A real-content parity run (150 ticks from t60k, random 1-7-tick batches) found
every runtime index equal to a fresh walk and the mirror equal to the live snapshot.

## Live session

New-headless Chrome for Testing on ANGLE Metal (Apple M2 Pro), 1920x1080, vsync 60 Hz, dev server,
`debug=profile`; main-thread CPU only (headless GPU timing is not evidence). Default camera:

| tick | clock | main ms/frame x3 | worker sim ms/tick | receive ms/tick x3 | delivered at x10 |
|---|---|---|---|---|---|
| 51k | 70m | 8.9 | 5.1-5.8 | 3.0 | 9.9 |
| 61k | 84m | 10.5 | 6.3-8.0 | 3.9 | 9.6 |
| 71k | 97m | 13.2 | 12.3-14.3 | 5.1 | 5.5 |
| 81k | 111m | 15.4 | 11.7-12.5 | 5.7 | 5.7 |
| 101k | 139m | 16.8 | 14.9-16.0 | 5.7 | 4.65 |

Dense settlement at x3: 12.5 to 17.1 ms a frame from 80k on; zoom 0.35: 30.7 to 34.1 ms, 27 to 31 FPS,
1480 to 2190 sprites. Paused with a still camera the main thread still spends about 7 ms a frame, most
of it the sprite pool's present and bind. Main-thread profile at 82k, x10: Pixi render 38%
(`collectRenderables` 17%, `_buildInstructions` 19%, both gone paused), sprite pool 26%, receive 18%
(`SnapshotMirror.merge` 11%, message deserialization 6%), scene build 5%, HUD 3%. About 1500 draw calls
a frame; 590 buffer uploads (1.9 MB) a frame running, none paused. Worker profile: delta take 14%.
GC is small on both threads (scavenges up to 3.3 ms, no major GC in a 5 s trace).

Overload, t85k to t91k: at x20 and x30 the worker is the bottleneck, the clock settles at about x5
within 2 s, the drawn tick stays within four ticks of the worker's, and dropping to x3 recovers within
one 2 s bin; a pause shows in 22 ms at x3 and 41 ms at x30. With the main thread made the bottleneck
(extra work per frame, x10) the worker banks ahead instead: 60 ms extra per frame left it 44 ticks
ahead and a pause took 1.3 s to show while 54 more ticks played; 120 ms left it 140 ticks ahead, 5.2 s
and 145 ticks.

## Tickets filed from this run

- Runtime: [worker-lead-follows-drawn-frames](../tickets/app/worker-lead-follows-drawn-frames.md),
  [relay-pacing-sees-render-cost](../tickets/net-client/relay-pacing-sees-render-cost.md),
  [mirror-truth-check](../tickets/app/mirror-truth-check.md),
  [worker-edge-states-reach-the-view](../tickets/app/worker-edge-states-reach-the-view.md).
- Delta path: [delta-take-copies-carried-components](../tickets/sim/delta-take-copies-carried-components.md),
  [per-tick-counters-rewrite-every-settler](../tickets/sim/per-tick-counters-rewrite-every-settler.md),
  [mirror-index-upkeep-per-touched-entity](../tickets/app/mirror-index-upkeep-per-touched-entity.md).
- Render: [sprite-pool-rebinds-unchanged-entities](../tickets/render/sprite-pool-rebinds-unchanged-entities.md),
  [sprite-layer-instruction-rebuild](../tickets/render/sprite-layer-instruction-rebuild.md),
  [zoom-out-detail-tiers](../tickets/render/zoom-out-detail-tiers.md),
  [scene-rebuild-and-depth-sort-churn](../tickets/render/scene-rebuild-and-depth-sort-churn.md).
- Sim: [ai-dead-holder-replant-retries](../tickets/sim/ai-dead-holder-replant-retries.md),
  [alarmed-idlers-run-full-ladder](../tickets/sim/alarmed-idlers-run-full-ladder.md),
  [combat-pass-scans-every-combatant](../tickets/sim/combat-pass-scans-every-combatant.md),
  [planner-pile-searches-scan-every-pile](../tickets/sim/planner-pile-searches-scan-every-pile.md),
  [canonical-joints-rebuild-every-tick](../tickets/sim/canonical-joints-rebuild-every-tick.md),
  [gossip-candidates-refill-every-tick](../tickets/sim/gossip-candidates-refill-every-tick.md),
  [fixed-point-asserts-ship-enabled](../tickets/sim/fixed-point-asserts-ship-enabled.md).

Below the admission bar at this scale: `nodeOfPosition`'s per-call object (125 KB a tick),
`aiPlayerEntity`'s query per call (52 KB), `WorkshopWorkforce` rebuilt per call (74 KB),
`collectInboundSupply` Maps (77 KB), the housewife's owner-blind food search (1.9% at t100k, mostly
driven by the standing alarm), the mirror keeping the opening `ready` message (about 10 MB), and about
130 unchanged component rewrites a tick (mostly `CurrentAtomic`). Not analysed: pathfinding (4.5%),
separation (5.8%) and movement (5.6%), per-walker work within the scale rule. Unexplained: 3351 loose
piles lie uncollected at t100k, mostly flag-yard goods.
