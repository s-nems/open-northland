# Vehicle route predicate reuse

This final series starts from `a53060873`, the frozen [delta/hover comparison](magiczny-las-delta-hover.md).
Runtime commit `0408bf167` adds one local optimization to `vehicleRouteTo`. The branch includes all
three earlier series and preserves gameplay, route ordering, command timing and save format 66.

## Change and review

The final late-game comparison exposed a repeatable combat spike at tick 99394. An isolated CPU
profile identified `engageVehicle → startVehicleDrive → vehicleRouteTo → findPath`, with repeated
passability checks dominating the route. That trace was diagnostic, not an unprofiled timing result.

A fresh Map, passed to the existing private blocker predicate, now records each node’s complete blocked/unblocked answer during one synchronous
vehicle route search. It avoids repeated ground, clearance and other-vehicle checks. Both true and
false answers are cached. The Map is neither exported nor reused by a later search. Public overlay
APIs, traversal, blocked-start exemption and search ordering are unchanged. No request is deferred.

Independent review found no correctness issue: nothing mutates the relevant blockers or yields
during `findPath`. Tests compare the complete route with an uncached reference, leaving the vehicle’s
own footprint, adding a blocking vehicle and removing it before another query. Existing land and
ship movement tests cover both traversal classes. The optimization and its test are kept in one runtime commit.

## Measurements

Restore seed-7 `magiczny_las` at tick 97200 with six requested AI seats plus scripted seat 6.
Timing attempts with failed system-load guards are excluded. The final repeat waits for the
machine to settle before starting. It uses 200 warm-up ticks and 2000 measured ticks, ending at tick 99400.

Two independent clean ABBA series pass every guard and end with hash `e32b1456`. Values below
are means of the two process medians/p95s or maxima in each series:

| Series | Tick median, ms | Tick p95, ms | Combat maximum, ms |
| --- | ---: | ---: | ---: |
| first | 12.429 → 12.508 | 28.845 → 29.040 | 45.626 → 30.150 |
| repeat | 12.449 → 12.326 | 28.785 → 28.708 | 44.604 → 31.877 |

Ordinary tick cost is neutral across the repeats; the first series’s +0.6% median does not recur.
Across all four processes per version, mean combat maximum falls 45.115 → 31.014 ms (−31.3%).
This describes the system maximum in this scenario, not every combat operation or every map.
One first-series candidate has an isolated 78.64 ms tick at 98694, including 60.15 ms in the planner;
the other candidate maximum is 49.76 ms. Repeat candidate maxima are 55.72 and 51.55 ms. The
local route improvement does not establish a reduction in every whole-tick maximum.

Allocation sampling uses no snapshot consumer, 2000 warm-up ticks and 500 measured ticks
(99201–99700), including the expensive vehicle route. ABBA means 4031.34 → 4038.90 KiB/tick
(+0.19%), a small increase. A per-search Map does allocate; this result does not establish
zero allocation or lower peak/retained memory. All four full saves are byte-identical at tick 99700:
20403585 bytes, SHA-256 `958d9af66249de693e24d59fd59b04b160b227a9f4432a9e2d70cb064a15377b`,
state hash `6e0478e1`.

## Rejected wrapper prototype

The first prototype wrapped the existing blocker with another `has` function. Its clean ABBA
reduced combat maximum 47.292 → 32.155 ms, but raised ordinary tick median 12.350 → 12.623 ms
(+2.2%) and p95 28.774 → 29.743 ms (+3.4%). A separate comparison with main also showed slower
ordinary ticks. That prototype is excluded from the retained history and preserved only in a backup.

The final form places the memo in the existing private predicate instead. This removes the extra
forwarding call and callback; the exact cause of the earlier slowdown is not established.

## Complete stack compared with main

A fresh final ABBA compares runtime `0408bf167` against main `5f97f5084`, with equivalent
format-66/65 checkpoints and the same 200 warm-up plus 2000 measured ticks. Every guard passes:

| ABBA run | Median, ms | p95, ms | Maximum, ms |
| --- | ---: | ---: | ---: |
| main 1 | 12.539 | 28.561 | 123.383 |
| candidate 2 | 12.376 | 28.983 | 51.434 |
| candidate 3 | 12.299 | 28.479 | 51.865 |
| main 4 | 12.538 | 29.190 | 122.670 |

Mean median is 12.538 → 12.337 ms (−1.6%); p95 is 28.876 → 28.731 ms, essentially unchanged.
The most repeatable whole-tick benefit remains the removal of vehicle-clearance stalls: maxima
are 122.7–123.4 → 51.4–51.9 ms in these runs. This is not a universal frame-time bound.
Main reaches `e6f9c243`, candidate `e32b1456`; the representation change and normalized full-state
comparison are documented in the original report. The later series’ complete saves are compared
without normalization.


The parent report retains the complete delta/mirror and headed-browser comparisons against main,
including neutral FPS, slower bare mirror application and a small active-allocation increase. This
last change touches only synchronous vehicle routing; it does not change rendering or delta handling.
Those earlier measurements are identified by their own runtime revision, not relabeled as this one.

## Verification and integration

All 9727 default tests pass with 3 intentional skips; all 203 real-content and 25 script tests
pass. Build, production/test typecheck, asset and documentation checks pass. Biome reports no
errors and 155 existing warnings. The content suite explicitly selects the late checkpoint and
includes worker and relay parity. Electron, Chromium, WebKit and Firefox match all 150 sandbox
hashes through tick 3000 and all 20 map hashes through tick 2000; these checks ran headed and muted.
Focused land/ship coverage passes 46 tests. Independent source and numerical reviews found no
remaining issue in the retained change. Earlier reports retain the render and cursor verification.

All four performance branches remain separate. Merging this last branch includes the complete stack
of 18 runtime commits; each optimization can be reviewed or reverted separately. Main is unchanged.
The first series changes save format 65 to 66 and rejects old saves under repository policy; later
series do not bump it again. No population limit, detail tier or gameplay restriction was added.

The [combat route-search ticket](../tickets/sim/combat-route-searches-outside-budget.md) retains the
other direct searches and possible further work. Budget deferral and altered decision cadence require
the owner’s decision and are excluded. No claim is made that all combat or rendering bottlenecks
have been removed.

Local evidence: `bench-out/fourth/integrated-clean-plain-*`, `integrated-repeat-plain-*`,
`retained-main-plain-*`, `final-alloc/`,
`focused.log`, `final-gates.json` and the parent’s `bench-out/third/combat-t99394/` CPU trace.
