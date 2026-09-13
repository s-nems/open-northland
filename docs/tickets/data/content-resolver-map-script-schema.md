# Validate map script sidecars in content-resolver through the data schema

**Area:** content-resolver, data · **Priority:** P3

`packages/content-resolver/src/maps-index.ts` hand-rolls a structural re-parse of
`<id>.script.json` (`multiplayerOf`, `playerSlotOf`: `typeof player !== 'number'`, allowed-type
string checks), duplicating `MapPlayerSlot`/`MapMultiplayer`/`MapMultiplayerSlot` from
`packages/data/src/schema/maps/script.ts`, and `provenanceOf` mirrors `MapProvenance` from
`packages/data/src/schema/maps/provenance.ts` the same way for the `.meta.json` sidecar. A comment
frames the missing schema dependency as a design fact, but `content-resolver/package.json` already
carries one workspace dependency (`@open-northland/vfs`), so the boundary is a choice, not a
constraint.
It compounds: `claimable`/`hidden`/`aiAllowed` are derived at serve time in the HTTP layer, so a
consumer reading the sidecar directly gets different answers than one reading `/maps-index`, and
any schema evolution must be mirrored by hand.

The duplicate parser also gives malformed data plausible defaults. A present but invalid
`multiplayer` node becomes `NO_MULTIPLAYER`, and malformed `slotOptions` rows are skipped while the
rest of the roster is still served. In the current CnMod 1.3.1 corpus, the authored table makes 45 AI
slots across 18 maps claimable by a human and denies AI for 47 Human/Closed-only rows across 15 maps.
Losing that table makes the first group unseatable and gives the second a bogus Idle/AI toggle.

## Scope

- Add `@open-northland/data` as a dependency and validate both sidecars with the zod schemas
  (`safeParse`), the provenance mirror included. A present invalid script or multiplayer table must
  warn and drop the roster; an absent table stays silent.
- Add one pure data-package helper that derives `claimable`/`hidden`/`aiAllowed` from a validated
  `MapScript`; use it from the resolver and direct sidecar consumers instead of reimplementing the
  lobby rules at the HTTP boundary.
- Non-goal: changing the served `/maps-index` response shape.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
The maps-index tests cover malformed metadata, a malformed script, a malformed `multiplayer` node,
and malformed `slotOptions`: invalid roster data warns and drops instead of throwing or inventing
defaults. The real corpus must trip no new warning.
