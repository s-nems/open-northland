# Stop rebuilding every placement blocker per `placeBuilding` command

**Area:** sim · **Priority:** P2

`canPlaceBuilding` (`systems/footprint/placement/building.ts`) calls `collectPlacementBlockers` inline
on every invocation, and `collectPlacementBlockers` runs a full `eachBlockerCell` pass: every
`Resource`, every `Building`, every `DeliveryFlag`, every `Signpost` on the map, stamping two
`Set<string>` through `nodeKey` string allocation. It then probes a **single anchor** against that set
and throws it away.

`CommandSystem` gates each `placeBuilding` command on it (`systems/command/placement.ts`). Six AI
seats place and re-probe through the same gate, and a rejected probe mutates nothing, so consecutive
failed placements rebuild an identical set each time.

The dense twin already avoids this: `placementProbe` stamps the same `eachBlockerCell` pass into a
`Uint8Array` and memoizes it on `placementBlockerVersion`, precisely so the per-frame overlay can
re-probe a whole visible band. The one-shot command gate kept the slow sparse form and no memo.

## Evidence

Live session `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal&debug=profile` at tick
~46 500: `command` averages 0.30 ms per tick but peaks at **89.6 ms**, the largest single-system
maximum in the schedule, against a clean `p50` frame. V8 CPU profile of `Simulation.step` over ticks
2000-4000 of the same world attributes it: `commandSystem` → `applyCommand` → `placeBuilding` →
`canPlaceBuilding` → `collectPlacementBlockers` at 6.2% inclusive, with `eachBlockerCell` 8.2% and
`resourceBlockerCells` 7.3% self across all callers.

A 90 ms tick lands inside one frame, so this reads to the player as a stutter whenever the AI builds.

## Scope

Give the command gate the same version-memoized blocker state the overlay probe already has, so a
placement probe is O(footprint) rather than O(map). Either memoize `PlacementBlockers` on
`placementBlockerVersion`, or route `canPlaceBuilding` through the existing dense `PlacementGrid`.

The two forms must stay in lockstep — the existing `placementProbe matches canPlaceBuilding at every
anchor` test is the contract, and it must still pass unchanged. Do not relax the rule while making it
cheaper.

## Verify

`npm test` with no golden movement, and the lockstep test specifically. A placement decision that
changes is a rule change, not a speedup.

`npm run bench:compare` on `magiczny_las` with AI seats building, reporting the `command` system's
maximum rather than only its mean — the mean is not where this shows. `npm run check` and
`npm run build`.
