# Decide how content-resolver validates the map sidecars

**Area:** content-resolver, data · **Priority:** P3

`packages/content-resolver/src/maps-index.ts` reads `<id>.script.json` and `<id>.meta.json` with a
hand-written structural reader (`multiplayerOf`, `playerSlotOf`, `provenanceOf`) that mirrors
`MapMultiplayer`, `MapPlayerSlot` and `MapProvenance` from `packages/data/src/schema/maps/`. A
malformed table or row already warns and drops instead of inventing a roster (`maps-index.test.ts`
covers it); what remains is the duplicated shape, which every schema change must be mirrored by
hand. `packages/content-resolver/AGENTS.md` allows a second workspace dependency only for a reason
as good as the vfs seam, so the choice has to be recorded either way.

## Scope

- Either add `@open-northland/data` to the resolver and validate both sidecars with the zod schemas
  (`safeParse`, warn and drop on failure), deleting the structural reader; or keep the reader and
  state in the resolver's contract why the schema dependency stays out (bundle size in the service
  worker, host neutrality), so the mirror is a documented decision.
- Non-goal: changing the served `/maps-index` response shape.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
The malformed-sidecar cases in `maps-index.test.ts` must keep passing whichever way is chosen.
