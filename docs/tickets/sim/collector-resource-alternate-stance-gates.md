# Select a collector resource through every eligible work stance

**Area:** sim · **Priority:** P2

A collector can idle with a harvestable resource in range because `nearestHarvestableFor` resolves
one nearest `interactionCell` before applying the settler's failed-goal memo, work-flag radius and
signpost gate. If that cell fails, it rejects the whole resource even when another work stance passes.
The harvest starter already evaluates the whole stance pool, so a remembered resource can be worked
while the same resource cannot be discovered by a fresh scan.

Verified with the existing two-stance tree fixture on an open map: collector at node `(1,1)`, tree at
`(7,1)`, work stances `(6,1)` and `(8,1)`. Two independent cases both leave it without `HarvestFocus`:

- Flag radius 40 and a live failed-goal entry for `(6,1)`; `(8,1)` remains reachable and permitted.
- Flag at `(9,1)` with radius 1; `(6,1)` lies outside the work area, while `(8,1)` lies inside it.

In each case, setting `HarvestFocus` to that tree and waking the planner immediately selects `(8,1)`
and starts walking there. The failed-goal case can suppress work until memo expiry even after the
route clears. The radius case persists until the collector, flag or resource changes.
This is a synthetic reproduction of current simulation behavior. It applies to resources with
multiple work stances; map-specific incidence and correspondence to the player report remain unverified.

## Scope

Select a resource through an eligible member of `resourceStanceCells`, applying the same per-settler
stance gates used by `startHarvestFromNode` before rejecting it. Preserve deterministic ranking,
resource claims and the remembered approach. Check the corresponding loose-drop selection where a
pile shares its resource's work pool. Keep covered-deposit stance semantics in
[the existing ticket](clay-work-cell-real-content-resolution.md).

## Verify

Add focused cases beside `gatherer-flag/harvest/focus.cases.ts` using the geometry above, without a
pre-existing focus. Both must select `(8,1)`; with both stances excluded, no harvest may begin. Add a
signpost-boundary case and an own-drop case if those paths share the fix. Repeat with the same seed
and assert identical results. Run `npx vitest run packages/sim/test/settlers/gatherer-flag.test.ts` and
the applicable checks in `docs/TESTING.md`.
