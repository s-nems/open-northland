# Fall back to the base `[GfxHouse]` table when the mod does not carry a house

**Area:** pipeline · **Priority:** P2

`tools/asset-pipeline/src/stages/ir/sources.ts` reads the `[GfxHouse]` table only from the mod's
`DataCnmd/budynki12/houses/houses.ini`. The base table, `Data/engine2d/inis/houses/houses.cif`, is
never read, so any house the mod does not redeclare has no bob record, no `typeId` and no join key.
The root `AGENTS.md` source precedence calls for the decoded `.cif` exactly here: a base table with no readable
twin.

Verified against the owned copy by decoding `houses.cif` with the repository's own
`decodeCifStringArray`: it carries `frank patricianhouse 01/02/03` as `EditName` records with
`LogicType` and `LogicTribeType`, and the mod table carries none of them.

Cost: 15 house names are invisible to the join (`frank patricianhouse 01/02/03`, `byzantine
home01/02/03`, `saracen mosqe/palace/residence 01/03`, `saracen tent 02/03/04`, `Egypt MainHouse`,
`Egypt Residence 04`). Authored maps name one of them in 105 `sethouse` rows across 12 maps, and 8
`attachtohouse`
rows target a `frank patricianhouse` that therefore resolves to nothing. Those buildings do not appear
on the map at all, so this is a missing-building bug first and a missing-attachment bug second.

## Scope

- Add the base `.cif` as a lower-precedence source for the `[GfxHouse]` table, so a mod record still
  wins where one exists.
- Confirm the two tables' records merge by `EditName` without duplicating a name at the same level.

## Verify

`npm run test:pipeline` against the owned copy, then re-count: the placed authored buildings per map
and the landed `attachtohouse` rows, which should reach 162 of 188 from 154 once the frank
patricianhouses resolve.
