# Take defence-mode eligibility from the source flag, not an app allowlist

**Area:** pipeline, data, app · **Priority:** P2

Which buildings can raise the alarm is carried by the source and never extracted: `houses.ini` marks
logictypes 1 (headquarters), 39 (barracks), 40 and 41 (both watchtowers) `logicCanEnableDefenceMode 1`
(verified against the owned copy). The decoder skips the key -
`tools/asset-pipeline/src/decoders/ini/types/buildings.ts` still files it under "later
construction/combat/placement systems" - so eligibility is re-derived from the three-entry authored
table in `packages/app/src/catalog/defence.ts`, whose capacities double as the eligibility set.

Consequences: the barracks, flagged in the source, has no Obrona window at all; a mod that renames a
defence-capable house, or adds one, gets nothing. The capacity itself is authored balance and stays
so - only the SET should come from the source.

`packages/app/src/content/real-content.ts` also states that "the extracted table carries the
`logicCanEnableDefenceMode` flag but no capacity", which is not true today; that sentence is corrected
in the commit that files this ticket.

## Scope

- Extract the flag into `BuildingType` (`canEnableDefenceMode`), through the ini decoder and the schema.
- Gate the panel's defence window and the `setDefenceMode` order on `canEnableDefenceMode &&
  shelterCapacity > 0`, keeping the barracks' zero capacity as the stated design choice (it trains
  soldiers rather than hiding civilians).
- Keep `SHELTER_CAPACITY_BY_ID` as authored balance; drop its second role as the eligibility set.

## Verify

- `npm run test:pipeline` against the owned copy: the flag decodes for logictypes 1/39/40/41 and for
  nothing else.
- `npm test` - the defence tests keep passing on synthetic content (fixtures set both fields).
- `?scene=tower-defence` - unchanged, and a barracks still offers no garrison.
