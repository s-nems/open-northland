# Validate map script sidecars in content-resolver through the data schema

**Area:** content-resolver, data · **Priority:** P3

`packages/content-resolver/src/maps-index.ts` hand-rolls a structural re-parse of
`<id>.script.json` (`multiplayerOf`, `playerSlotOf`: `typeof player !== 'number'`, allowed-type
string checks), duplicating `MapPlayerSlot`/`MapMultiplayer`/`MapMultiplayerSlot` from
`packages/data/src/schema/maps/script.ts`. A comment frames the missing schema dependency as a
design fact, but `content-resolver/package.json` has zero dependencies by choice, not constraint.
It compounds: `claimable`/`hidden`/`aiAllowed` are derived at serve time in the HTTP layer, so a
consumer reading the sidecar directly gets different answers than one reading `/maps-index`, and
any schema evolution must be mirrored by hand.

Related: [maps-index-multiplayer-degrade](../app/maps-index-multiplayer-degrade.md) fixes the
*behavior* of this same path (malformed rosters must warn and drop, not invent defaults). This
ticket fixes its *structure*; done together, `safeParse` failure is the natural warn-and-drop
trigger and completing both closes both.

## Scope

- Add `@open-northland/data` as a dependency and validate sidecars with the zod schema
  (`safeParse`). On validation failure follow the degrade ticket's outcome: warn and drop the
  roster; an absent table stays silent.
- Move the `claimable`/`hidden`/`aiAllowed` derivation to one shared producer (pipeline emit or a
  helper in `data`), so the served index and the raw sidecar agree by construction.
- Non-goal: changing the served `/maps-index` response shape.

## Verify

`npm test`, `npm run check`, `npm run build`; `npm run test:content` where local content exists.
The existing maps-index tests must pass unchanged, plus one case proving an invalid sidecar still
degrades instead of throwing.
