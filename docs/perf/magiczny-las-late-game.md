# Magiczny las: late-game simulation and rendering

## Scope and comparison

The candidate preserves simulation decisions and visual settings. It changes elapsed-time storage,
needs storage, delta bookkeeping, interaction caches, vehicle clearance, soft-shadow texture storage,
and GPU instruction/buffer reuse. No population cap, AI cadence change, gameplay limit or detail tier
is included.

The clearest measured benefits are fewer clearance rebuild stalls, smaller deltas and fewer draw
calls. Ordinary simulation ticks and matched-speed browser FPS are approximately unchanged. Bare
mirror copying, active allocation and texture-page storage retain documented costs below.

The fresh control is `main` at `5f97f5084`, which already includes the earlier low-risk optimizations.
These numbers describe the additional work on the research branch. Historical measurements against
older gameplay revisions are not a valid control for this world and are superseded here.

Scenario: `magiczny_las`, seed 7, requested AI seats 0–5 plus the map's scripted seat 6, normal needs
and progression, observer. The long runs reach tick 100202 (about 2 h 19 min), with 2368 settler entities,
670 fighters and 426 buildings. Tick 97200 contains 37230 entities and 2470 settlers, including 337
wildlife. Machine: Apple M2 Pro, 10 CPU cores, 32 GiB RAM; Node 26.5.0. Tests and measurements run
serially. OS load and calibration guards do not certify an otherwise idle machine.

## Implementation

| Change | Preserved contract |
| --- | --- |
| Derive action and path progress from ticks; separate `SettlerNeeds` | Action timing, needs values, save/restore and renderer interpolation |
| Track written components for snapshot deltas | Detached held records, independent streams, overflow recovery and index coherence |
| Cache resource interaction stance candidates | Fresh nearest/reachability decisions, topology/content invalidation and owned arrays |
| Update vehicle clearance locally | Same blockers and routes; full rebuild remains for lost changes or overflow |
| Pack soft shadows into shared pages | Same silhouettes, blur, padding, anchors and useful-pixel budget |
| Retain stable-order instructions and upload changed attribute ranges | Painter order, custom depth notifications and pending renderer uploads |
| Index revisions and value generations by component ID | Per-world isolation, registration, removal, restore and mutation counters |

The save layout is version **66**. Version 65 is rejected; there is no migration. The format change
accounts for changed raw state hashes. Component deltas already existed on the control: the new work
records writes directly instead of rediscovering them by scanning carried-component revisions.

### Recovered validation

Complete saves from independent control/candidate growth runs match after projecting the new clock
and needs representation at ticks 10000, 50000, 70000, 90000, 97200 and 100000. The projection compares
all remaining save sections, membership/order and session state; it is a diagnostic, not a
save-reader compatibility path. A separate vehicle scenario comparison at tick 444 also matches.

Current automated gates: build/typecheck, Biome (0 errors, 155 existing warnings), 25 script tests,
and 9697 default tests passed with 3 skipped. Real-content checks passed all 203 tests, including
late-checkpoint worker and relay parity. The two cross-engine workloads matched in Electron, Chromium,
WebKit and Firefox: 150 sandbox hashes through tick 3000 and 20 map hashes through tick 2000.
Browsers ran headed because the software GPU stalled in headless mode; this is not a headless pass.
Repository asset and documentation checks also passed (4025 tracked files and 176 Markdown files).
Focused regressions cover delta ownership/overflow, needs/action timing, cache invalidation and
subscription reuse, local-clearance oracle comparisons, depth hooks and GPU upload ranges, shadow
pixels/packing and cleanup. The complete runtime diff received independent review by scope.

### Fresh simulation comparison

Late game (restore tick 97200), milliseconds:

| ABBA run | Median | p95 | p99 | Maximum | Guard |
| --- | ---: | ---: | ---: | ---: | --- |
| 1: control | 13.265 | 30.154 | 39.625 | 132.365 | pass |
| 2: candidate | 13.115 | 29.389 | 38.504 | 56.815 | pass |
| 3: candidate | 12.979 | 29.135 | 37.469 | 52.355 | pass |
| 4: control | 13.049 | 29.468 | 38.234 | 125.873 | pass |

The mean of run medians changes from 13.157 to 13.047 ms (−0.8%); ordinary tick cost is effectively
neutral at this resolution. The maxima fall from 126–132 to 52–57 ms in these windows. The vehicle
operation counts below explain removed rebuild spikes; other workloads and GC can still stall.
Earlier valid runs varied substantially between processes, including a +3.6% candidate comparison,
so this is not evidence of a broad percentage reduction in ordinary simulation cost.

Middle game (restore tick 50000), milliseconds:

| ABBA run | Median | p95 | Maximum | Guard |
| --- | ---: | ---: | ---: | --- |
| 1: control | 3.903 | 9.777 | 17.552 | pass |
| 2: candidate | 3.866 | 9.579 | 17.475 | pass |
| 3: candidate | 3.874 | 9.592 | 17.399 | pass |
| 4: control | 3.899 | 9.447 | 18.013 | pass |

The mean of run medians is 3.901 → 3.870 ms (−0.8%). A previous middle-game series contained one
failed CPU-calibration guard (1.28× drift); that series is excluded from timing conclusions.


Each plain run restores the corresponding semantically equivalent checkpoint, warms 200 ticks and
measures 2000 with sync digest disabled. ABBA order interleaves control and candidate. Report each
run and its guard verdict; a mean of run quantiles is descriptive, not a pooled percentile. The
initial control growth run failed its load guard, so the growth curves establish state/scale only,
not a before/after speed claim.

#### Delta and mirror diagnostic

Tick 97200, 200 warmup ticks, 500 measured ticks, one tick per delta, digest/parity sampling off,
split reader mirrors off. The independent bare and indexed mirrors each receive their own freshly
deserialized copy; application order rotates. Both are checked against the live snapshot and fresh
indexes outside the measured window. Values below average the two run medians. All four runs passed their timing guards.

| Stage | Control | Candidate | Change |
| --- | ---: | ---: | ---: |
| Serialized delta | 422.900 KiB | 336.300 KiB | -20.5% |
| Delta take | 8.044 ms | 5.104 ms | -36.6% |
| Serialization | 1.254 ms | 1.052 ms | -16.1% |
| Deserialization | 2.764 ms | 2.289 ms | -17.2% |
| Bare mirror apply | 1.429 ms | 1.805 ms | +26.3% |
| Apply with frame indexes | 3.848 ms | 3.701 ms | -3.8% |
| Paired index upkeep | 2.382 ms | 1.873 ms | -21.4% |

The bare-copy regression remains visible; the native no-removal copy path reduced it compared with
the rejected manual copy loop. A bounded native/split/hybrid/native experiment found no improvement
from extracting the removal fallback and worse results from copying written keys manually, so the
native path remains. A three-tick V8 shape probe found only fast-property records in both worlds,
including candidate settlers with 21 keys; it did not support a dictionary-property threshold cause.
The remaining cause is unresolved. Smaller deltas and faster extraction come with slower bare record
replacement. Do not add these medians or call this a browser-frame speedup: the probe uses two mirrors
and reports stages separately.

#### Matched active/no-consumer profiles

Separate CPU and allocation samples restore tick 97200, warm 200 ticks and sample the next 500.
The active case includes transport and two mirrors; the no-consumer case creates neither snapshot
streams nor mirrors. Final hashes agree across modes and samplers within each save layout.
The CPU samples below precede the final cache narrowing; allocation sampling was repeated on the
completed simulation. Sampling, JIT inlining and profiler overhead prevent treating these timings as
plain benchmarks or subtracting the two modes to estimate a production consumer's cost.

| Sampled CPU per tick | Control | Candidate |
| --- | ---: | ---: |
| Touched-log record, active (self) | 0.253 ms | 0.703 ms |
| Touched-log record, no consumer (self) | 0.233 ms | 0.305 ms |
| Touched-log drain, active (inclusive) | 0.210 ms | 1.038 ms |
| Delta next, active (inclusive) | 12.122 ms | 8.505 ms |
| Mirror patched, active (self, two mirrors) | 3.326 ms | 5.649 ms |
| Component revision lookup, active (self) | 0.422 ms | 0.056 ms |
| World value-write bookkeeping, active (self) | 0.184 ms | 0.041 ms |

The candidate's no-consumer profile has no snapshot or mirror work, consistent with lazy detailed
tracking. Active tracking still costs more in record/drain, while extraction and revision lookup
cost less. Mirror samples concentrate in the native record-copy site; the removal-copy helper is
only 0.091 ms/tick, which gives little support for optimizing that rare fallback.

| Sampled allocation per tick | Control | Candidate | Change |
| --- | ---: | ---: | ---: |
| Active, total | 14761.20 KiB | 15394.28 KiB | +4.3% |
| No consumer, total | 4380.75 KiB | 4285.60 KiB | −2.2% |
| Active, plain clone (inclusive) | 1067.05 KiB | 776.51 KiB | −27.2% |

These are sampled allocation estimates, not retained or peak memory. Mirror application allocation
rises from approximately 1896.01 to 2059.83 KiB/tick. The control attributes much of record-copy allocation
to an inlined merge, while the candidate attributes it to `patched`; function names alone would
misstate the difference. Touched-log drain also rises from 160.47 to 1031.35 KiB/tick inclusive,
including snapshot-refresh callback allocations. The active path therefore retains an allocation
tradeoff despite fewer cloned component values.

#### Vehicle clearance counts

Instrumented replay covers ticks 90000–100000 with no recorded diagnostic errors. Counts describe
operations and invalidation triggers; instrumentation timings are not speed measurements.

| Operation | Control | Candidate |
| --- | ---: | ---: |
| Full rebuilds | 5 | 1 |
| Local updates | 939 | 940 |
| Membership batches | 1826 | 95 |
| Membership history gaps | 1 | 0 |
| Resource-feed batches | 0 | 1733 |
| Landscape changes | 3 | 3 |

Both perform a cold rebuild at tick 90003. The control additionally rebuilds for landscape changes
at ticks 90538, 98013 and 98443, and a ResourceFootprint membership-history gap at tick 99586.
The candidate handles all three landscape changes locally and reads 3211 resource-feed entries
without overflow. These counts establish fewer full rebuilds in this replay; they do not establish
that the full-rebuild fallback can be removed or predict another world's invalidation rate.

#### Interaction cache

Only resource stance pools are cached. Positioned targets derive their small pool directly, and drops
choose their current stocked good on each call; a matching resource-backed drop shares the resource
pool. Nearest-cell and reachability decisions still run for each origin. The Position removal feed is
reused, and its captured cleanup callback is created only when changes are pending.

The broader positioned-target cache was removed: diagnostic hit rates were 28.0% for positioned
pools versus 58.5% for resources, with extra validation for the cheaper derivation. Both neighboring
comparisons in a resource-only ablation favored the smaller cache, but large variation between runs
prevents a percentage speed claim. All variants reached the same gameplay state hash. Final
no-consumer stance-family allocation is 514.18 → 414.20 KiB/tick (−19.4%).

### Fresh browser comparison

Headed Chromium 153, ANGLE Metal on Apple M2 Pro, 1440 × 900, default graphics, observer camera
fixed at the densest settlement. Each camera independently restores tick 97200 and warms for five
seconds. Running windows last ten seconds. Dense zoom is 1; wide zoom is 0.35. All four runs
in each ×3 series passed visibility, camera, restore-hash and system-load guards, with no browser
errors. The diagnostic series additionally passed GPU query/disjoint checks.

Uninstrumented ×3 series (each cell lists both runs):

| Camera | Control FPS | Candidate FPS | Control RAF p95 | Candidate RAF p95 |
| --- | --- | --- | --- | --- |
| Dense | 105.57, 97.12 | 102.66, 104.86 | 16.7, 16.9 ms | 16.7, 16.7 ms |
| Wide | 25.37, 24.92 | 24.46, 24.98 | 42.4, 50.0 ms | 50.0, 42.6 ms |

Both deliver approximately ×3. Mean FPS changes by +2.4% dense and −1.7% wide, inside the observed
run variation. This does not establish a whole-frame speedup or regression.

Separate instrumented diagnostics, averaging each pair of run means:

| Metric | Dense control → candidate | Wide control → candidate |
| --- | --- | --- |
| Pixi stage CPU | 2.319 → 2.004 ms | 13.541 → 13.180 ms |
| Measured stage GPU | 4.816 → 4.740 ms | 4.722 → 4.659 ms |
| Draw calls per render | 542.3 → 496.1 | 1315.3 → 1125.6 |
| Buffer uploads per render | 575.4 → 536.5 KiB | 4171.4 → 4195.8 KiB |
| Sprite instruction rebuilds per render | 0.547 → 0.490 | 1.000 → 1.000 |

The wide scene still changes painter order every rendered frame, so instruction retention and
partial uploads provide little benefit there. Shadow-page sharing reduces draw calls in both views.
Stage CPU excludes scene update and mirror work; GPU queries exclude compositor and later inset
renders. Diagnostic wrappers add overhead, so their RAF values are not the uninstrumented comparison.

Uninstrumented ×10 stress test, averaging the two runs per side:

| Camera | Control → candidate FPS | Delivered simulation speed | RAF p95, both runs |
| --- | --- | --- | --- |
| Dense | 98.77 → 91.01 (−7.9%) | ×3.405 → ×3.796 (+11.5%) | Control 16.7/16.7 ms; candidate 16.8/16.7 ms |
| Wide | 25.00 → 22.53 (−9.9%) | ×4.496 → ×4.664 (+3.7%) | Control 49.9/50.1 ms; candidate 50.1/50.1 ms |

All restore, camera, visibility and load guards passed, with no browser errors. Neither version
sustained the requested ×10. Under saturation the candidate advanced more simulation ticks while
drawing fewer frames. This is a throughput/frame-rate tradeoff with unequal simulation work, not an
isolated rendering comparison. The wide control's delivered speed varied from ×4.22 to ×4.77, so its
small average throughput difference is inconclusive. The matched ×3 series above remains the check
at approximately equal delivered simulation speed.

A same-candidate ABBA experiment replaced only the depth sort with a linear order check and native
stable sorting on an inversion. Sorting CPU per render fell from 0.961 to 0.780 ms, while FPS remained
near 25. A separate allocation sample found sort allocation 75.2 → 440.6 KiB/render and total page
allocation 6389.3 → 6799.8 KiB/render. The native variant was rejected: a small CPU saving did
not justify that allocation increase. The retained merge buffers remain in the candidate. Allocation
timings are diagnostic and are not included in the performance table.


#### Image controls

Paused captures restore tick 97200 independently, force interpolation alpha to 1, drain deferred
bakes and freeze presentation updates. Dense and wide views contain 1638 and 6150 drawn items.
The agent inspected both views for sprite placement, depth order, clipped edges and shadows; no
visible regression was found. Final visual acceptance remains human.

Strict byte identity was not established. Default captures of the same frozen control differed in
three pixels (maximum channel difference 1 in one capture and 3 in another). Disabling WebGL DITHER
only for a separate capture diagnostic produced some exact repeats but did not eliminate all
same-version differences. This is not a graphics-setting change in the game. A fourth control launch aborted after three
same-version pixels differed by up to 9 channel levels; its files are retained. An additional control
launch collected both views without an exactness gate. Across the completed captures, the primary
images repeat exactly within each version. Control/candidate differences are 9 pixels dense (22
channels, maximum difference 5) and 6 pixels wide (6 channels, maximum difference 1), out of 1,296,000
pixels. The completed candidate's same-launch repeats are exact. No strict full-image identity is
claimed, and the capture experiment is not a performance measurement.
The raw RGBA captures and same-version repeats are retained; do not attribute these small differences
to the candidate without a stable control.

The multisets of cached soft-shadow frame geometry and alpha hashes match between versions. Atlas
identity was not captured, and different atlases can share frame coordinates, so this establishes a
multiset comparison rather than per-atlas frame identity. Dedicated synthetic tests separately cover
shadow pixels, geometry, packing and lifetime.

| Soft-shadow cache | Dense control → candidate | Wide control → candidate |
| --- | --- | --- |
| Frames | 366 → 366 | 308 → 308 |
| Texture sources | 366 → 11 | 308 → 11 |
| Useful RGBA bytes | 8,278,892 → 8,278,892 | 8,388,464 → 8,388,464 |
| Allocated source bytes | 8,278,892 → 10,356,504 | 8,388,464 → 10,356,504 |

Page gaps cost about 1.9–2.0 MiB of additional texture storage in these views. The 8 MiB budget still
bounds useful pixels, not total page allocation. These figures count RGBA source dimensions, not a
measurement of total GPU or process memory.

## Remaining work

- [Detail tiers](../tickets/render/zoom-out-detail-tiers.md),
  [AI decision cadence](../tickets/sim/ai-decision-interval-48.md) and
  [farm claim behavior](../tickets/sim/farm-claim-keys-on-stance-cell.md) remain separate proposals.
  Their gameplay/visual-policy changes require the owner's decision.
- [Default wildlife records](../tickets/sim/settler-needs-are-human-only.md) remain a P3 storage task.
  Their readers make a constructor-only deletion unsafe. The measured potential is 29836 save bytes
  and roughly 33700 complete-snapshot bytes; unchanged records already cost nothing in normal deltas.
  No runtime gain has been demonstrated, so this follow-up is outside the current validated change.
- Planner, AI, combat, separation and pathfinding remain the principal ordinary tick costs. They are
  observations for future profiling, not a reason to change scheduling or gameplay here.

## Reproduce

Use independent worktrees with their own dependencies and the same generated content. The existing
benchmark controls and validity rules are in [Development](../DEVELOPMENT.md#measuring-performance).
Generate checkpoints independently on each save format; do not load an older format into the candidate.

```sh
ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5 \
ON_BENCH_CHECKPOINT=bench-out/current.checkpoint \
ON_BENCH_WARMUP=200 ON_BENCH_TICKS=100000 \
ON_BENCH_WINDOWS=20 ON_BENCH_SYNC_DIGEST=off \
ON_BENCH_CHECKPOINTS=10000,50000,70000,90000,97200,100000 npm run bench:map

ON_BENCH_CHECKPOINT=bench-out/current.t97200.checkpoint \
ON_BENCH_WARMUP=200 ON_BENCH_TICKS=2000 ON_BENCH_WINDOWS=2 \
ON_BENCH_SYNC_DIGEST=off npm run bench:map

ON_BENCH_CHECKPOINT=bench-out/current.t97200.checkpoint \
ON_BENCH_WARMUP=200 ON_BENCH_TICKS=500 ON_BENCH_WINDOWS=1 \
ON_BENCH_SYNC_DIGEST=off ON_BENCH_MIRROR=on ON_BENCH_MIRROR_SPLIT=off npm run bench:map
```

The map benchmark pins seed 7. Use a new, unused base checkpoint path for the growth command;
an existing file selects restore mode instead. The local completion artifacts retain the independent
checkpoints, semantic comparisons, raw profiles, per-run JSON/logs, RGBA captures and screenshots.
The browser checks use `npm run bench:browser -- checkpoint origin output-directory 10` as their
base, with an ignored ABBA driver that separates uninstrumented timing, drawing diagnostics and
paused pixel captures.
