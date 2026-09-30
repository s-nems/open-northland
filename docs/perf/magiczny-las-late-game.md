# Magiczny las: late-game simulation and rendering

Reference workload for the performance tickets linked below. The simulation runs through tick
100202, about 2 h 19 min at 12 ticks/s, with a checkpoint at **97200 (2 h 15 min)**.
No gameplay settings, population limits or simulation algorithms were changed for this measurement.

## Branches for separate review

`perf/magiczny-las-low-risk` contains the smaller-scope candidates below. "Lower risk" is a relative
assessment, not a measured speedup guarantee. This subset has not had its own timing comparison.

| Change | Commit | Why it is in this branch |
| --- | --- | --- |
| perf(sim): retain AI traversal storage | `111a31a29e` | Paged traversal storage and reused queue capacity; search order, budgets and cadence stay the same. |
| perf(render): retain scene depth order and numeric sort keys | `f306c163bf` | Retained numeric sort keys and order repair preserve the existing total comparator; oracle tests cover reordering and fallback. |
| perf(sim): select the minimum stocked good without sorting | `947f2586bb` | An order-independent minimum scan replaces a temporary sorted array; no retained cache is added. |

`research/magiczny-las-performance` is based on this branch and adds seven higher-risk scopes:

- Tick-derived clocks and separate needs: a broad change to state representation, timing readers and save format.
- Reused combat contexts: mutable callbacks and records depend on strict per-unit lifetime.
- Retained presentation and shadow pages: ownership, graphics precision and texture-memory tradeoffs.
- Retained GPU instructions and partial uploads: child hooks, invalidation and upload ownership.
- Local vehicle clearance: topology invalidation and an unresolved sparse journal rollover.
- Cached interaction candidates: invalidation complexity and measured validation CPU overhead.
- Written-component deltas: snapshot ownership, independent streams and measured bookkeeping/apply overhead.

The last three also retain unfinished work. The higher-risk classification is broader than the list
of unfinished tickets. Existing timing results describe the combined implementation, not this subset.
The higher-risk branch needs the clocks/needs change before the delta change because its hot clone
reads `SettlerNeeds`. None of the three lower-risk runtime changes requires that save-format change.

Compare the branches with `git diff perf/magiczny-las-low-risk...research/magiczny-las-performance`.
Keep performance measurements separate from compilation/tests. Before integrating either branch,
measure its actual candidate tree against the intended control and check the final gameplay hash.


## Scenario and measurement conditions

- Engine revision `fa9978e40`; task changes are benchmark tooling and documentation only.
- Apple M2 Pro, 10 CPU cores, 32 GiB RAM, macOS arm64, Node 26.5.0.
- `magiczny_las`, seed **7**, observer, requested AI seats 0–5; the map adds seat 6.
  Progression and needs retain map defaults; no sync digest. The supplied `fog=reveal` is an
  unrecognized URL value and falls back to the scripted map's classic fog. An observer sees the map.
- Generated content IR 46, fingerprint
  `78ecbdebba851dc75c97252793641a0ce0baef1c41201d1ea2c8188e9bd946c4`, map fingerprint `9d770dd3`.
- Node uses compiled workspace code; the browser uses the development server. These are development
  measurements, with fixed-point assertions enabled, not a production-build FPS promise.
- Heavy runs were sequential. The long run passed the benchmark's trust checks: maximum load/CPU
  0.890, calibration 1.908 → 1.876 ms. Its wall time was 733.8 s. Checkpoint writes are outside
  tick timing but their garbage affects the GC columns; use the restored repeats for absolute cost.
- Raw reports, profiles, checkpoints and screenshots remain local under `bench-out/`; generated game
  content and captures are not repository artifacts.

The existing benchmark's **settlers** field counts the `Settler` component, including wildlife.
At tick 97200 it means **2008 people + 331 animals**, of which 77 are owned livestock. There are
385 buildings, 32 unfinished buildings and 143 road construction sites, 1190 active paths,
129 engagements and 16 projectiles. Cumulative statistics record 748 human deaths, including 707
soldiers. This is a wartime workload; the older reference's peacetime assumptions do not apply.

## Simulation growth

Each row is a 5000-tick window ending at the named tick. Times are ms/tick; GC is total pause ms in
that window. Population columns describe its end, not the start.

| End tick | Median | p95 | p99 | Max | People + animals | Fighters | Buildings | GC ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5202 | 1.62 | 3.42 | 4.95 | 51.42 | 610 | 53 | 58 | 81 |
| 20202 | 2.37 | 5.12 | 7.49 | 37.24 | 668 | 53 | 86 | 86 |
| 30202 | 2.38 | 4.78 | 6.67 | 21.98 | 763 | 53 | 122 | 258 |
| 50202 | 4.26 | 11.06 | 15.95 | 32.65 | 1073 | 165 | 172 | 418 |
| 70202 | 7.24 | 16.11 | 21.46 | 72.74 | 1672 | 405 | 270 | 560 |
| 90202 | 12.82 | 30.07 | 40.53 | 169.46 | 2468 | 885 | 348 | 845 |
| 100202 | 15.35 | 32.74 | 43.15 | 122.81 | 2359 | 771 | 397 | 1182 |

The long run ends at hash `5e1466d1`. Its peak sampled RSS is 2478 MiB; endpoint heap occupancy
oscillates with collection and checkpoint exports. This run alone neither establishes nor excludes
a leak.

### Restored late-game baseline

Both repeats restore tick 97200, warm 200 ticks, then measure **97401–99400** without checkpoint
writes, mirror copies or CPU/allocation sampling. Per-system clock instrumentation remains enabled.
Both pass trust checks, end at hash **`deba3ba1`**, and agree within 0.3% on median tick cost.

| Run | Median | p95 | p99 | Max | Load/CPU |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 13.69 | 30.33 | 38.17 | 73.08 | 0.404 |
| B | 13.66 | 30.70 | 38.35 | 68.30 | 0.397 |

For comparison, a restored 50k checkpoint over ticks 50201–52200 costs median 4.58 ms,
p95 9.63 ms, p99 14.61 ms, with a passing trust verdict. It ends at `fd105e98`.

The following system means and shares are from repeat A. Ranking by mean exposes AI work that
runs periodically; its median is almost zero.

| System | Mean ms/tick | Share of system time |
| --- | ---: | ---: |
| Planner | 4.06 | 25.3% |
| AI | 3.07 | 19.2% |
| Separation | 1.60 | 10.0% |
| Combat | 1.53 | 9.5% |
| Pathfinding | 1.44 | 9.0% |
| Movement | 1.16 | 7.3% |

### CPU and allocation attribution

The separate CPU sample covers the same 2000 late ticks and ends at the same hash. Inclusive shares
overlap along a call chain and must not be added: AI workforce 14.3%, collector upkeep 9.5%,
`regionOf` 7.5%, `WalkFlood.costTo` 6.4%, `interactionCell` 6.6%, `nearestOpenStance` 5.5%,
`findPath` 6.8%, and `collectColliders` 4.0%. `CountedBlocks.has` is 6.2% self time across callers;
its current dense array implementation makes reducing repeated traversal the first investigation,
rather than replacing its storage on the strength of that aggregate.

Allocation sampling over ticks 97401–97900 includes collected objects: **4658 KiB/tick** across
the instrumented process. `positionedStanceCells` accounts for 243 KiB self / 341 KiB inclusive per
tick, `resourceStanceCells` 115 KiB inclusive, and `engageSpec` 235 KiB self / 246 KiB inclusive.
These are allocation rates, not retained heap or leak measurements.

The isolated vehicle spike is reproducible: tick **94298** spends **107.64 ms** in `vehicleMovement`
in the long run and **105.68 ms** in a targeted profiled repeat (restore 90000, warm 4200, measure
200 ticks). The vehicle subtree contains 152.48 ms of samples across that window, including
136.81 ms in clearance lookup/upkeep and 103.34 ms in its full rebuild. These are nested totals.
The expensive operation rebuilds clearance over **182400 half-cell nodes**; the profile does not
yet distinguish a membership-journal gap from landscape invalidation as its trigger. This is a
clearance-cache task, not evidence that vehicle route search caused this stall.

### Worker delta and mirror cost

The Node mirror probe restores the same checkpoint, with one delta per tick and each index reader
measured on an independent mirror. Its medians include the 200 warm-up deltas plus 500 measured
ticks; it is a serialization/index cost proxy, not a browser FPS measurement. Mirror/snapshot and
index parity checks pass. The sim timing and GC in this run include pressure from many probe mirrors
and must not replace the plain baseline.

At about 37220 entities: median **2124 touched entities**, **5268 changed components**, **397 KiB**
per delta. Median costs: take **8.31 ms**, V8 serialize **1.24 ms**, deserialize **2.56 ms**, bare apply
**1.31 ms**, apply with frame indexes **3.73 ms**. Individual reader upkeep over a bare control:
HUD totals **0.649 ms**, position buckets **0.324 ms**, settler bubbles **0.250 ms**. Tiny negative
reader differences are measurement noise. A full snapshot clone took 409 ms in this diagnostic.

## Browser rendering

Headed Chromium 153, ANGLE Metal on Apple M2 Pro, 1440×900 canvas, DPR 1, fullscreen off,
uncapped frame rate on a display delivering about 120 RAF callbacks/s. Fresh browser settings keep
the default enhancements enabled: xBR sampling, soft shadows, enhanced water, environment motion,
grounded buildings, weather and post-processing. Audio runs normally but Chromium output is muted.

Every condition restores the checkpoint and verifies its hash, applies the same camera, warms for
5 s and measures for 15 s. Camera input is suspended; every measured RAF checks camera, canvas size,
DPR and tab visibility. The accepted baseline has no browser errors or guard failures; load/CPU at
the window boundaries stays below 1.5. A prior series with a disturbed camera is excluded.
There is no browser CPU calibration, and the repeated dense window shows the remaining variation.
These are fixed-camera tests, not a panning, interaction or enhancement-toggle benchmark.

Dense camera: world centre `(12988, 5681)` in projected pixels; at zoom 1 its offsets are
`(-12268, -5231)`. Other zooms keep this centre. The empty control points outside the map while the
same world continues to simulate. The running windows advance to slightly different ticks because
they measure equal wall durations, not equal numbers of delivered ticks.

| View / zoom | Requested speed | Delivered speed | Drawn items at end | Approx. FPS | RAF p50 ms | RAF p95 ms | RAF p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Dense / 1 | Paused | 0 | 1804 | 119 | 8.3 | 9.3 | 9.4 |
| Dense / 1 | 1 | 0.99 | 1750 | 114 | 8.3 | 15.6 | 16.9 |
| Dense / 1 | 3 | 2.85 | 1751 | 86 | 8.6 | 17.6 | 25.1 |
| Dense / 1, repeat | 3 | 2.98 | 1753 | 92 | 8.4 | 17.4 | 25.0 |
| Dense / 1 | 10 | 3.14 | 1753 | 79 | 9.2 | 24.9 | 25.9 |
| Dense / 0.7 | 3 | 2.99 | 2569 | 47 | 24.9 | 33.4 | 34.2 |
| Dense / 0.5 | 3 | 3.00 | 4102 | 31 | 33.3 | 41.7 | 42.4 |
| Dense / 0.35 | Paused | 0 | 6248 | 94 | 8.4 | 16.9 | 17.5 |
| Dense / 0.35 | 3 | 3.00 | 6219 | 22 | 41.9 | 50.7 | 59.2 |
| Dense / 0.35 | 10 | 4.33 | 6213 | 22 | 49.6 | 50.9 | 58.4 |
| Empty | 3 | 3.00 | 0 | 120 | 8.3 | 9.3 | 9.4 |

FPS uses measured callbacks divided by wall duration. RAF percentiles are exact sample quantiles,
not the app's histogram buckets. App CPU/draw fields are recent EMAs: at zoom 0.35, speed 3 they
read **44.74 / 41.54 ms**, against **7.99 / 6.74 ms** in the first dense speed-3 window and
**5.74 / 5.01 ms** in its repeat. They are not whole-window averages. Paused zoom 0.35 reads
4.90 ms CPU, so the running scene's repeated work is the main CPU investigation.

The wider camera delivers more sim ticks at requested speed 10 despite drawing fewer frames.
The measured batches differ: dense averages **1.03 ticks/message**, wide **2.45**; main-thread
receive cost is **5.37 vs 2.57 ms/tick**. This supports investigating delta cost and batching together;
it is not an isolated experiment proving that a slower renderer improves the simulation.

### Separate CPU, GPU and allocation diagnostics

The dense and wide x3 diagnostic windows pass the same camera, visibility and load checks. CPU
profiles sample the browser main thread; worker simulation is measured separately above. Self-time
shares include idle and runtime samples in the denominator. Dense `presentPooled` is 5.72%,
`merge` 6.05% and `bind` 2.40%; wide `presentPooled` is 5.53%, `merge` 3.95%, `bind` 5.11%,
scene `emit` 3.13% and Pixi batch `break` 3.54%. Multiple renderable-collection sites also appear
among the largest entries. These point to presentation, scene preparation, instruction collection
and delta application; samples alone do not count instruction rebuilds or prove a particular fix.

GPU timer queries surround the main Pixi stage, including world, HUD and weather. They exclude
subsequent portrait/inset renders and compositor work. The CPU sampler runs during these queries,
so this is diagnostic attribution rather than the uninstrumented baseline:

| View | Window | GPU samples | Mean ms | p95 ms | Disjoint / discarded |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dense / 1 | 15.734 s | 1197 | 4.65 | 6.70 | 0 / 0 |
| Dense / 0.35 | 15.440 s | 325 | 4.86 | 6.64 | 0 / 0 |

The similar GPU submission times and much higher running CPU cost at wide zoom prioritize main-thread
scaling in this workload. They do not establish the cost of individual graphics enhancements; those
need controlled toggles. The app's `gpuMs` residual includes idle/vsync and is not used as GPU evidence.

Allocation sampling is a separate fresh restore: dense 15.180 s / 1351 frames, wide 15.228 s /
340 frames. Estimated totals include objects collected during the window: 2200 MiB dense and
2423 MiB wide. Selected self-allocation sites, summing matching call sites in the profile:

| Site | Dense MiB/window | Wide MiB/window |
| --- | ---: | ---: |
| `presentItem` | 295.1 | 245.3 |
| Scene comparator | 214.5 | 457.5 |
| `assembleItem` | 78.4 | 181.7 |
| Pixi `sortChildren` | 95.2 | 113.0 |

For `presentItem` this is roughly 224 vs 739 KiB per drawn frame. Wide zoom draws fewer frames during
an equal wall interval, so compare both per-frame and per-second allocation volumes. The comparator
attribution needs a split of sorting, item access and item construction before choosing a fix.
These are sampled allocation estimates, not retained memory or evidence of a leak.

## Prioritized work

The ordering below is a proposed implementation sequence based on measured cost and scope, not an
estimate of independent savings. Several tasks affect the same call chains. Each ticket owns its
verification and correctness conditions; no fixed frame-time target is imposed.

| Order | Task | Evidence / scope |
| --- | --- | --- |
| 1 | [Scene preparation and depth sorting](../tickets/render/scene-rebuild-and-depth-sort-churn.md) | Wide view scene comparator + item construction churn; preserve draw ordering. |
| 2 | [Sprite presentation and enhancement cost](../tickets/render/graphics-enhancement-frame-cost.md) | `presentItem` allocates about 224–739 KiB/frame; measure each effect independently. |
| 3 | [Sprite instruction rebuilds](../tickets/render/sprite-layer-instruction-rebuild.md) | Collection, batching and sort allocations; count invalidations before changing them. |
| 4 | [Delta component copying](../tickets/sim/delta-take-copies-carried-components.md) | 8.31 ms median take; browser mirror and receive costs warrant end-to-end validation. |
| 5 | [AI traversal](../tickets/sim/ai-decision-tick-slicing.md) | 3.07 ms/tick mean; AI p95 about 17 ms and maximum 46–48 ms. |
| 6 | [Interaction stance pools](../tickets/sim/interaction-stance-pool-recomputation.md) — new | Repeated origin-independent candidate generation and allocations. |
| 7 | [Vehicle clearance rebuild](../tickets/sim/vehicle-clearance-full-rebuild-spike.md) — new | Reproducible roughly 106–108 ms single-system spike. |
| 8 | [Combat engagement specifications](../tickets/sim/engage-spec-allocates-per-unit.md) | 235 KiB/tick self allocations in active combat. |
| 9 | [Per-tick counters and deltas](../tickets/sim/per-tick-counters-rewrite-every-settler.md) | Delta and mirror pressure confirmed; remeasure counter attribution before implementing. |
| 10 | [Zoom-dependent detail](../tickets/render/zoom-out-detail-tiers.md) | 1751 → 6219 drawn items and RAF p95 17.6 → 50.7 ms; consider after removing repeated work. |

No settler limit or other gameplay restriction is proposed as a prerequisite. Changes to decision
cadence or gameplay rules require agreement before implementation. Zoom-detail tradeoffs also need
visual review; the measurements do not justify silently hiding useful information.

These results cover one map, seed, machine and browser configuration. There is no pan/zoom gesture,
multiplayer, lower-end GPU or production-build comparison, and no controlled enhancement A/B yet.
Other maps and combat distributions can change the ranking. Use the retained checkpoints to compare
candidate fixes on this workload, then check another workload before generalizing.

## Reproduce

Use the matching engine/content versions. Checkpoints are replaced, not migrated, when save format
or behavior changes. Source changes require a rebuild; the public commands below rebuild the Node
benchmark automatically.

```bash
export ON_CONTENT_DIR=/path/to/generated/content
ON_BENCH_TICKS=100000 ON_BENCH_WINDOWS=20 \
  ON_BENCH_CHECKPOINT=bench-out/ml6-current.checkpoint \
  ON_BENCH_CHECKPOINTS=10000,30000,50000,70000,90000,97200,100000 \
  ON_BENCH_JSON=bench-out/ml6-growth.json npm run bench:map

ON_BENCH_CHECKPOINT=bench-out/ml6-current.t97200.checkpoint \
  ON_BENCH_TICKS=2000 ON_BENCH_WINDOWS=2 npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml6-current.t97200.checkpoint \
  ON_BENCH_TICKS=2000 npm run bench:profile
ON_BENCH_CHECKPOINT=bench-out/ml6-current.t97200.checkpoint \
  ON_BENCH_TICKS=500 ON_BENCH_PROFILE=alloc npm run bench:profile
ON_BENCH_CHECKPOINT=bench-out/ml6-current.t97200.checkpoint \
  ON_BENCH_TICKS=500 ON_BENCH_WINDOWS=1 ON_BENCH_MIRROR=on ON_BENCH_MIRROR_SPLIT=on npm run bench:map
ON_BENCH_CHECKPOINT=bench-out/ml6-current.t90000.checkpoint \
  ON_BENCH_WARMUP=4200 ON_BENCH_TICKS=200 npm run bench:profile
```

For browser measurements, start the development server from the same worktree in a separate terminal
with the same `ON_CONTENT_DIR`, then run:

```bash
npm run dev -- --port 5186
# In another terminal, after the server is ready:
npm run bench:browser -- bench-out/ml6-current.t97200.checkpoint \
  http://127.0.0.1:5186 bench-out/browser-stable 15
```

The default runs the full baseline matrix and separate diagnostics. See
[benchmark controls](../DEVELOPMENT.md#measuring-performance) for modes, validity checks and outputs,
and [preview cleanup](../DEVELOPMENT.md#worktree-previews) for stopping the owned server afterwards.
The accepted browser report is `bench-out/browser-stable/report.json`; CPU, allocation and GPU
summaries and PNGs sit beside it. Node baselines are `ml6-growth.json`, `ml6-mid-repeat.json`,
`ml6-late-a.json`, `ml6-late-b.json` and `ml6-late-mirror.json` under `bench-out/`.

## Split validation

The lower-risk runtime tree passed the production build, typecheck, 18 script tests and the default
suite (9504 passed, 3 skipped). The split does not establish a standalone timing improvement.
