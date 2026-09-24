# Settle the houses that only the base house table declares

**Area:** pipeline, app · **Priority:** P2
**Needs user:** the deciding evidence is the running CulturesNation original.

Mod maps name 16 houses that no `[GfxHouse]` record in the IR carries, so `resolveAuthoredPlacements`
(`packages/app/src/game/world/authored-placements.ts`) skips 70 `sethouse` rows on 10 maps:
`tutorial_007` 29, `tutorial_006` 13, `tutorial_005` 11, `specjalna_forteca` 4, `smocza_kraina` 3,
`saracen_2_sub_1` 3, `saracen_3_sub_3` 3, `tutorial_001` 2, `saracen_2` 1, `saracen_4` 1. They are
computer players' town houses. None carries a mission id and no `attachtohouse` targets one, so only
the towns lose buildings, and no script breaks.

Evidence so far:

- The pipeline reads `[GfxHouse]` only from the mod's `DataCnmd/budynki12/houses/houses.ini`. The base
  `Data/engine2d/inis/houses/houses.cif` ships in the mod archive, byte-identical to the owned install,
  and declares 15 of the 16 names: `frank patricianhouse 01/02/03`, `byzantine home01/02/03`,
  `saracen mosqe`, `saracen palace`, `saracen residence 01/03`, `saracen tent 02/03/04`,
  `Egypt MainHouse`, `Egypt Residence 04`. `byzantine bakery` exists in neither table, so that name is
  an authoring error.
- Original behavior (unconfirmed): the mod appears to replace the base house table rather than layer
  on it, so the original may drop these houses exactly as the port does now.

## Investigate

Load `tutorial_007` in the running CulturesNation original and check whether the Saracen town shows its
palace, mosque, tents and residences.

## Scope

- If the houses appear: add the base `houses.cif` as a lower-precedence `[GfxHouse]` source, so a mod
  record wins wherever one exists, and merge by `EditName` without duplicating a name at one level.
- If they do not: keep the drop, record the observation as the source basis next to the house-table
  source in `tools/asset-pipeline/src/stages/ir/sources.ts`, and delete this ticket.

## Verify

- Houses appear: `npm run test:pipeline`, then rerun the authored-placement count. The 69 rows naming
  the 15 base houses place, the one `byzantine bakery` row stays skipped, and nothing else moves.
- Houses absent: the note lands and the placement counts are unchanged.
