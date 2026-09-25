# Clear the base's ground when the AI settlement stretches away from it

**Area:** sim · **Priority:** P3

The AI hires clearing gatherers only while a placement finds no spot at all (`StalledPlacement`).
On maps where the base sits against forest, placements keep finding spots, but each lands farther
out, so the settlement grows as a narrow strip away from the headquarters: long carrier walks and a
front the towers cannot cover. Felling the forest beside the base would keep it compact.

## Scope

- Record where the build order's latest base-affine placement landed (an entry with no `resource` or
  `front` affinity), and arm the clearing gatherers while it lies beyond
  `TOWER_DEFENCE_RADIUS_NODES` of the base anchor, the base's own defence circle.
- Point those gatherers at the wood nearest the base rather than any nearest collected good, so the
  felling opens ground where the next placement would search first.
- Keep the stalled-placement trigger and its civilian-scaled count; this is a second trigger of the
  same posts, not a second pool.

## Verify

- A scenario test with a forest wall beside the base: the placement lands beyond the radius, the
  clearing posts appear with wood flags near the base, and they go once a placement lands inside it.
- The stalled-placement tests keep their commands.
- `npm test` and the AI content test.
