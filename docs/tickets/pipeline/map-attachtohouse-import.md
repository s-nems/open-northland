# Import authored settler-to-house attachments

**Area:** pipeline + app · **Priority:** P2

`staticobjects.inc` places `attachtohouse <hx> <hy> <slot>` inside `sethuman` blocks, but
`extractStaticObjects` drops it. Imported settlers therefore lose authored homes and workplaces.
Corpus inspection shows slot values 1 and 2; their meanings and target resolution still need to be
pinned from the readable maps before implementation.

## Scope

- Verify the slot meanings and coordinate join across the owned mod corpus.
- Capture the modifier on its enclosing human row and carry it through `TerrainEntities` and authored
  placement loading.
- Resolve the referenced placed building and apply housing/employment through existing sim commands.
- When a human also has `setproducedgood`, attach first and restore the gather selection second so the
  job change cannot erase it.

## Verify

Use synthetic decoder cases for modifier scoping and both slot kinds, a real-content join test, and one
browser map with an authored attachment. Run normal gates plus `npm run test:pipeline` and
`npm run test:content`.
