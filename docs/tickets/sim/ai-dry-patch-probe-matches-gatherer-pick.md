# Make AI dry-patch checks use gatherer eligibility

**Area:** sim · **Priority:** P3

AI workforce `patchAlive` and `nearestLiveResource` count resource anchors in a world-metric circle.
The gatherer resolves work cells, uses a Manhattan radius, and rejects building-blocked, wrong-component,
XP-gated, and claimed nodes. A patch can therefore look live to the allocator while containing no target
the worker may choose. A 26k-tick real-map soak confirmed 3–25 falsely counted blocked deposits per
collector, although it did not reproduce a complete stall from this cause alone.

## Scope

Share the gatherer's work-cell eligibility with the dry-patch and relocation probes while retaining the
resource-region index. Keep the current Manhattan work-area shape in this task; changing that mechanic
requires separate source evidence.

## Verify

An AI-module test leaves only ineligible nodes and requires flag relocation. Re-run
`npm run soak:gatherers`; run `npm test`, `npm run check`, and `npm run build`.
