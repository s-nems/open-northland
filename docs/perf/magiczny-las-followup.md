# Magiczny las: follow-up performance changes

This series builds on the [reviewed late-game branch](magiczny-las-late-game.md), frozen at
`a7d449a41`. It preserves gameplay, AI budgets, update cadence, visibility, graphics settings and
save format 66. The runtime comparison uses `f8091d5a2`; later documentation does not change it.

## Changes retained

- Remove the separation ghost memo: each mover queried it once before the next clear, so it never
  reused an answer. Calm-zone construction remains lazy.
- Share the immutable good-to-harvest-atomic table through the existing content index. Preserve
  duplicate-key order, last defined value and atomic zero.
- Score AI flag candidates with scalar coordinates and allocate only the winning point. Preserve
  resource-before-origin flood queries, tie order, fallback and fixed-point arithmetic.
- Reuse mover world X in separation. Row differences still round after subtraction, as before.
- Use 128-slot lazy walk-cost pages instead of 256. Flood budgets, ordering and independently owned
  lifetimes are unchanged; this reduces unused slots without adding a pool.
- Reuse the last world shader variant using its scalar settings before formatting a cache key.
  Texture limits, mutable shadow styles and live graphics changes still select the proper program.
- Pass the already acquired plain sprite to its binder.
- Skip `atan` and `hypot` for zero shear, preserving signed zero and all numeric scale values.

## Scenario and verification

Same machine, content, seed 7 and six requested AI seats as the parent report, including scripted
seat 6. Restore tick 97200; warm up 200 ticks. Plain ABBA measures 2000 ticks per process, mirror
ABBA 500. Allocation sampling runs separately for no consumer and one delta stream feeding two
independently copied mirrors.
The parent report's comparison against main remains separate: these results measure the added series.

### Plain simulation

Milliseconds, no snapshot consumer:

| ABBA run | Median | p95 | p99 | Maximum | Guard |
| --- | ---: | ---: | ---: | ---: | --- |
| 1: control | 12.637 | 28.859 | 38.643 | 80.807 | pass |
| 2: candidate | 12.400 | 29.005 | 37.626 | 52.745 | pass |
| 3: candidate | 12.412 | 29.044 | 37.916 | 52.336 | pass |
| 4: control | 12.713 | 28.998 | 37.401 | 54.049 | pass |

The average run median is 12.675 → 12.406 ms (−2.1%). Both candidate medians are below both
controls, but p95 is effectively unchanged (28.929 → 29.025 ms). The isolated control maximum is
not a repeatable stall reduction. These quantiles describe this workload on this machine.
All four final hashes are `e32b1456` at tick 99400.

### Delta and mirror diagnostic

Mean of the two run medians, milliseconds; both mirrors are verified outside the measured window.

| Stage | Parent | Follow-up |
| --- | ---: | ---: |
| Delta take | 4.990 | 5.013 |
| Serialization | 1.044 | 1.040 |
| Deserialization | 2.299 | 2.255 |
| Bare mirror apply | 1.800 | 1.798 |
| Apply with frame indexes | 3.654 | 3.683 |
| Paired index upkeep | 1.834 | 1.855 |

Payload is identical: median 336.3 KiB and 4461 written components per delta. These small timing
differences do not establish a mirror speedup; this series leaves the delta implementation unchanged.
All four runs passed their guards and reached `fc0ab18a` at tick 97900.

### Sampled allocation per tick

Separate ABBA samples, 500 ticks each; `active` includes independent bare and indexed mirrors plus
serialization/deserialization. This measures sampled allocation, not retained or peak memory.

| Consumer | Parent | Follow-up | Change |
| --- | ---: | ---: | ---: |
| none | 4284.70 KiB | 4214.21 KiB | -1.65% |
| active | 15451.49 KiB | 15322.96 KiB | -0.83% |

The no-consumer reduction repeats across both candidate runs. The active difference is comparable
to the spread between control runs; treat it as a small or unresolved effect. All samples reach
`fc0ab18a`. Do not subtract these modes to estimate browser transport cost.

### Complete-state comparison

Independent replays from tick 97200 to 100000 produce byte-identical complete saves: 20487676 bytes,
SHA-256 `f516124e839f45a37f6a60b00ccdf43b392210e9621c745d62df125f4ea48379`.
Unlike the parent series, this comparison requires no representation projection: both sides use
save format 66. The final simulation state hash is `e2325447`.

### Automated checks

Build and production/test typecheck pass. Biome reports no errors (155 existing warnings).
All 25 script tests, 9712 default tests and 203 real-content tests pass; the default suite retains
its 3 intentional skips. The content run explicitly selects the late checkpoint and includes worker
and relay parity. Electron, Chromium, WebKit and Firefox match all 150 sandbox hashes through tick
3000 and all 20 map hashes through tick 2000. These browser engine checks ran headed.
Repository asset and documentation gates pass. Focused tests cover ordering, page boundaries and
budgets, fractional-row rounding, layer reuse, live shader settings and zero-shear transitions.
All retained runtime changes were reviewed separately from their author. Rejected experimental
commits are retained only in the local backup.

### Browser rendering

Headed Chromium, 1440 × 900, default graphics, requested ×3 simulation. Uninstrumented ABBA
uses four separate browser processes; all windows pass camera/visibility/load guards and deliver
approximately ×3. Average run FPS from measured RAF counts:

| Camera | Parent | Follow-up | Change |
| --- | ---: | ---: | ---: |
| dense | 105.43 | 105.22 | -0.20% |
| wide | 24.64 | 24.79 | +0.59% |

FPS is effectively unchanged at this resolution. Treat the small source-level reductions in binding
and shader selection as removed work, not an established frame-rate gain.

A separate instrumented ABBA passes all guards. These values describe CPU time inside `app.render`
and GL traffic; they exclude scene reconciliation and are not whole-frame or GPU time.

| Camera | Stage CPU, ms | Draw calls/frame | Buffer upload, KiB/frame |
| --- | ---: | ---: | ---: |
| dense | 1.987 → 1.945 | 496.2 → 496.1 | 538.3 → 534.5 |
| wide | 12.367 → 12.223 | 1125.6 → 1125.5 | 4185.8 → 4169.6 |

GPU interval-query means are 4.506 → 4.459 ms in the dense view and 4.635 → 4.603 ms in the wide
view. Every query completed, sample counts match rendered frames and no disjoint event occurred.
These differences are small. Wide-view stage CPU also drifted across processes (parent 13.208 then
11.525 ms; candidate 13.068 then 11.377 ms), so its mean difference is not a reliable speedup.

At paused tick 97200, primary RGBA captures are byte-identical between both versions and across
both independent initializations, for both cameras (1440 × 900). One immediate same-version re-render
changes four color channels by one level; all other immediate repeats are exact. This establishes
matching primary captures in the tested scenes, not general byte-stable GPU output. Inspection of
the dense and wide screenshots found no visible regression.

## Experiments excluded

| Experiment | Evidence and decision |
| --- | --- |
| Reuse pending write Sets | Isolated ABBA allocation 15229.43 → 15203.55 KiB/tick (−0.17%, within variation); delta take 4.946 → 5.003 ms. No useful benefit; removed. |
| Pool AI walk pages | Allocation 4263.39 → 4138.25 KiB/tick (−2.94%); ordinary tick median 12.716 → 12.605 ms (neutral). The additional lifetime and retained-memory machinery was replaced with smaller independently owned pages. |
| 64-slot walk pages | Allocation 4259.87 → 4203.02 KiB/tick (−1.33%), with no demonstrated advantage over 128 slots. The 128-slot comparison was 4257.16 → 4196.93 KiB/tick (−1.42%), with neutral tick time. |
| Cache packed sprite quads | About 89.6% hits, but instrumented wide-view stage CPU rose from 11.28 to 13.38 ms, with about 4.77 MB of cumulative cache arrays. Removed prototype. |
| Atlas grounded overlays | A model matching all 76387 observed world batches saved only 574 batches even with an unlimited ideal page. Insufficient benefit for the ownership and texture-storage cost. |
| Merge consecutive terrain/decor meshes | A conservative full-material comparison found 3 compatible pairs per frame out of approximately 1126 total draws; 7 decor draws/frame were unsupported and excluded. No renderer rewrite. |
| Memoize stranded piles | No repeated non-building query under an unchanged world mutation version in 227538 calls. No cache added. |

CPU sampling attributes substantial main-thread work to sprite binding/presentation and hover
selection. These are diagnostic samples, not measured savings. No population restriction, detail
tier or gameplay adjustment is introduced by this series.


## Evidence

Local artifacts are under `bench-out/followup/`: `final-plain-*`, `final-mirror-*`, `final-alloc/`,
`final-state.json`, `final-gates.json`, `render-final-plain/`, `render-final-diagnostics/`,
`render-final-pixels/` and `pixel-analysis.json`. The parent report describes checkpoint generation;
use the existing map and browser benchmark controls to reproduce the same seed, content and windows.
