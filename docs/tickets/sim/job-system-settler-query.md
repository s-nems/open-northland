# Drive job matching from settlers instead of all entities

**Area:** sim · **Priority:** P2

`systems/economy/jobs/system.ts` scans `world.canonicalEntities()` every tick and discards every
non-settler before matching jobs. Real maps are dominated by thousands of scenery/resource entities,
so this violates the active-work budget even when only a few settlers are unemployed.

## Scope

Iterate the canonical ascending-id `Settler` query, preserving the same subsequence and first-match
winners. Confirm the ECS invariant that destroyed entities cannot remain in a component store before
removing the old alive check.

## Verify

Goldens remain byte-identical. Measure with the benchmark's scenery axis; run `npm test`,
`npm run check`, and `npm run build`.
