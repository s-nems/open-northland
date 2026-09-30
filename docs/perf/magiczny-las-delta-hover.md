# Magiczny las: delta and hover follow-up

This series builds on the [second reviewed series](magiczny-las-followup.md), frozen at
`9b4fbabc4`. Its runtime revision is `c3df38943`; it adds two independently reviewed commits.
The complete branch includes both earlier series. It preserves gameplay, AI cadence, population,
graphics settings and save format 66. The original main control remains `5f97f5084`.

## Changes retained

- Accumulate each delta stream’s pending component writes in a private array. Identity checks
  deduplicate writes; emission sorts that array in component registration order. This removes the
  per-entity Set and the extra array copied for sorting. Streams, emitted records and clone-cache
  sets retain separate ownership; removal, re-addition and overflow keep their existing behavior.
- Ask whether any selectable target exists under the cursor, stopping at the first accepted hit.
  Hover no longer builds and ranks complete target arrays. Click selection keeps its existing
  ranking. Shared visitors preserve ownership, fog, livestock, portrait and in-house exclusions,
  flag proxies, signposts, road margins and solid-pixel tests. Queries read current bounds each time;
  there is no new cache or delayed cursor update. Door-marker selection is unchanged.

Linear membership is a tradeoff for small component lists. In the measured late-game window,
77.4% of one-tick partial changes contain at most two components (mean 1.99, maximum 16).
At three ticks per delta, the mean is 2.47 and maximum 17. This is scenario evidence, not a bound
for every possible backlog. No pool or retained scratch lifetime is added.

## Verification

All 9726 default tests pass, with 3 intentional skips; all 203 real-content tests and 25 script
tests pass. Build, production/test typecheck, asset and documentation gates pass. Biome reports
zero errors and 155 existing warnings. Content tests explicitly use the late checkpoint and include
worker and relay parity. Electron, Chromium, WebKit and Firefox match 150 sandbox hashes through
tick 3000 and 20 map hashes through tick 2000; browser engine checks ran headed.

Four independent active-consumer replays from tick 97200, with 200 warm-up and 500 measured ticks,
end at tick 97900 with hash `fc0ab18a` and byte-identical complete saves: 20579061 bytes, SHA-256
`944672b17360194cd63cec055e40cadeaf808f9576ba8b5590fcf248394d2ce6`. Both mirrors and their indexes
are checked outside measurement. The earlier reports cover complete-state comparisons over longer
replays and the original representation change.

Live browser checks at paused tick 97200 compare hover existence with click selection over 914
queries, two cameras and both observer and owner views. They use actual drawn bounds and pixel hits,
cover positive and negative answers, preserve the checkpoint hash and find no mismatch or browser
error. Door markers are omitted from this live probe and covered by unit tests. The two screenshots
were inspected; no visible regression was found. Earlier reports retain the more extensive image
comparisons and their small GPU pixel-repeat limitations.

## Incremental measurement

Same late-game scenario as the parent: seed 7, six requested AI seats plus scripted seat 6,
Apple M2 Pro, Node 26.5.0. ABBA means independent control, candidate, candidate, control processes.
The first delta timing series is excluded because two runs failed the system-load guard.

The repeated delta ABBA passes all guards and reaches `fc0ab18a` in all four runs. Delta-take
medians are 5.569 / 5.363 / 5.141 / 5.303 ms (control / candidate / candidate / control). The
average is 5.436 → 5.252 ms (−3.4%); the ranges overlap, so this supports only a modest result
in this window. Payload stays at median 336.3 KiB and 4461 components. Indexed apply averages
3.939 → 3.979 ms, effectively unchanged. The retained justification is less allocation machinery
and no extra sorting copy, with preserved ownership, rather than a general frame-rate claim.

Active-consumer allocation sampling, separately from timing, averages 15516.09 → 15375.94 KiB/tick
(−0.90%). Both candidate samples are below both controls, but the 140.15 KiB difference is close
to the 136.11 KiB spread between controls. Treat it as a small directional result, not a strong
percentage claim. These are sampled allocations, not retained memory.

## Complete stack compared with main

Fresh serial ABBA restores equivalent format-65/66 checkpoints at tick 97200. Plain simulation
warms 200 ticks and measures 2000, without a snapshot consumer. All four guards pass:

| ABBA run | Median, ms | p95, ms | Maximum, ms |
| --- | ---: | ---: | ---: |
| main 1 | 12.635 | 28.966 | 124.023 |
| candidate 2 | 12.376 | 28.736 | 52.991 |
| candidate 3 | 12.607 | 29.134 | 53.107 |
| main 4 | 12.503 | 28.849 | 121.561 |

Mean median 12.569 → 12.492 ms (−0.6%) and p95 28.907 → 28.935 ms are neutral. The repeatable
benefit is removal of vehicle-clearance spikes: main spends 96–98 ms in `vehicleMovement` at tick
98013 and 91–92 ms at tick 98443. Candidate maxima are approximately 53 ms; both now occur at
tick 99394, including 45.4–45.6 ms of combat. An isolated CPU profile of the single tick attributes about 50 ms of inclusive samples to
`engageVehicle → startVehicleDrive → vehicleRouteTo → findPath`, principally repeated passability
checks. That instrumented trace identifies the stack, not its unprofiled timing. The
[route-search ticket](../tickets/sim/combat-route-searches-outside-budget.md) tracks this lead. Main and candidate final hashes are respectively `e6f9c243` and `e32b1456`;
they differ because the first series changed state representation. The original report’s full-state
projection and the follow-ups’ exact-save comparisons establish the behavioral comparison.

Delta/mirror ABBA uses 500 measured ticks after 200 warm-up; all guards pass. Mean run medians:

| Stage | Main | Complete stack |
| --- | ---: | ---: |
| Payload | 422.9 KiB | 336.3 KiB |
| Delta take | 7.381 ms | 5.026 ms |
| Serialization | 1.227 ms | 1.056 ms |
| Deserialization | 2.729 ms | 2.298 ms |
| Bare mirror apply | 1.331 ms | 1.845 ms |
| Apply with frame indexes | 3.711 ms | 3.722 ms |
| Paired index upkeep | 2.321 ms | 1.866 ms |

Payload falls 20.5% and delta take 31.9%. Indexed application is neutral; bare application remains
more expensive (+38.5%); the cause of that difference remains unresolved. Both versions already
support partial records and held snapshots. This tradeoff was reviewed again; replacing records
in place would break ownership and does not provide a safe shortcut.

Active-consumer allocation sampling averages 14979.79 → 15152.68 KiB/tick (+1.15%).
The two main samples are 14940.68 / 15018.91, candidates 15161.81 / 15143.55. The full stack
therefore still trades a small increase in sampled allocation for smaller and faster deltas;
it does not establish reduced retained memory. Candidate complete saves match the incremental
comparison exactly; main saves use the older representation and are not byte-comparable.

Headed Chromium, 1440 × 900, default graphics, requested ×3: every browser window passes
visibility, camera and load guards and delivers approximately ×3. Uninstrumented ABBA FPS:

| Camera | Main | Complete stack | Interpretation |
| --- | ---: | ---: | --- |
| dense | 98.78 | 97.98 | Neutral (−0.8%); both versions slow between the two rounds. |
| wide | 24.10 | 24.93 | Small apparent gain (+3.4%), within candidate process variation. |

Dense controls are 104.90 and 92.66 FPS, candidates 103.70 and 92.27. Wide candidates are
25.75 and 24.12 FPS. These variations prevent a reliable general FPS improvement claim.

A separate instrumented ABBA measures render submission and GL traffic:

| Camera | Stage CPU, ms | Draws/frame | Upload, KiB/frame | GPU query, ms |
| --- | ---: | ---: | ---: | ---: |
| dense | 2.269 → 2.221 | 542.3 → 496.1 | 558.7 → 611.0 | 4.508 → 4.685 |
| wide | 12.955 → 12.311 | 1315.2 → 1125.6 | 4161.6 → 4174.9 | 4.515 → 4.646 |

Draw calls fall by 8.5% / 14.4%. Stage CPU is time inside `app.render`, excluding scene
reconciliation; it is not whole-frame time. GPU queries all complete with matching frame counts
and no disjoint event. GPU time does not improve in this series. Instrumented FPS also differs
from the primary uninstrumented series (dense 104.80 → 90.12; wide 24.70 → 24.04); this discrepancy
remains unresolved, so diagnostic FPS is not substituted for the uninstrumented result. Upload bytes
per rendered frame depend on the number of sim updates delivered between frames.


## Integration and remaining work

Merge the last branch to include all three series, or integrate the frozen series in order. Each
runtime change has its own commit. None has been merged into main by this work. The first series
changes save format 65 to 66; old saves are rejected under the repository’s no-migration policy.
The follow-ups do not change that format again.

The [original report](magiczny-las-late-game.md) and [second report](magiczny-las-followup.md)
retain their rejected experiments and remaining costs. Population limits, detail tiers and AI
cadence changes were not introduced. Gameplay proposals stay in their existing consultation tickets.
The small [wildlife default-record task](../tickets/sim/settler-needs-are-human-only.md) remains a
storage improvement, without a demonstrated ordinary tick benefit. Combat searches and panning
bursts remain separate workload investigations; this series does not claim to resolve them.

## Evidence

Local artifacts are under `bench-out/third/`: `final-gates.json`, `final-alloc/`,
`pending-written-histogram.json`, `hover-parity/`, `third-clean-mirror-*`, `aggregate-plain-*`,
`aggregate-mirror-*`, `main-alloc/`, `main-render-plain/`, `main-render-diagnostics/` and `combat-t99394/`.
Use the existing map/browser benchmark controls and the checkpoint recipe in the original report.
