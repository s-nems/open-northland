# Make AI dry-patch checks use gatherer eligibility

**Area:** sim · **Priority:** P3

AI workforce `patchAlive` and `nearestLiveResource` count resource anchors in a world-metric circle and
skip a node whose stance cells are all walk-blocked (`workableResourceTest`). The gatherer also resolves
its work cell from where it stands, uses a Manhattan radius, and rejects wrong-component, XP-gated,
claimed, and route-region-sealed nodes (`routeRegions`, the sealed-pocket veto). A patch can therefore
still look live to the allocator while containing no target the worker may choose. The sealed-pocket
case is the widest gap: the pick skips an enclosed patch silently (no route failure is emitted any
more), so the allocator keeps a flag alive over ground the collector will never touch; the probes
should share the same `routeRegions` verdict.

## Scope

Extend the workable test with the gatherer's remaining eligibility checks while retaining the
resource-region index. Keep the current Manhattan work-area shape in this task; changing that mechanic
requires separate source evidence. The generic-collector probe (`allocateGenericCollectors`,
`jobCanHarvestGood` without the XP gate) needs the same verdict: a circle holding only XP-gated goods
parks an idle generic collector forever.

## Verify

An AI-module test leaves only sealed or XP-gated nodes and requires flag relocation. That test is the gate;
run `npm test`, `npm run check`, and `npm run build`.
