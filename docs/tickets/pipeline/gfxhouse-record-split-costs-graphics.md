# Fix the `[GfxHouse]` multi-record lumping in the cost/hitpoint/graphics extractors (defect)

**Area:** pipeline · **Priority:** P1

A `[GfxHouse]` bracket can hold many house records; reading it as one section staples every
sub-house's props to a last-wins `LogicType`/`GfxBobId`, "dropping/mis-joining 63 of the 234
building types" (`tools/asset-pipeline/src/decoders/ini/buildings-gfx/shared.ts`,
`splitGfxHouseRecords` doc). The footprint and two visuals passes already walk
`splitGfxHouseRecords(sec)`; three extractors still loop raw sections with the lumping bug — the
`shared.ts` comment names them as the follow-up this ticket files:

- `collectGfxHouseWinner` (`buildings-gfx/structure.ts` ~line 29), which backs both
  `extractConstructionCosts` (`LogicConstructionGoods`) and `extractHouseHitpoints`
  (`logichitpoints`) — so saracen/egypt costs and hitpoints join to the wrong typeId or drop.
- `extractBuildingGraphics` (`buildings-gfx/visuals.ts` ~line 176), which binds a single `EditName`
  to every bob/palette pair in the bracket — so the non-first sub-houses' atlases are incomplete.

**Source basis:** the real `ejkfhsnkjehbhouses.ini` record layout, pinned by the existing
`splitGfxHouseRecords` implementation + its tests; this is a defect fix toward faithful extraction,
not a new mechanic.

## Scope

- Move the three extractors onto the same `splitGfxHouseRecords` walk so per-record
  `LogicConstructionGoods`/`logichitpoints`/`EditName` join to their own record's
  `LogicType`/`GfxBobId`; keep the existing tribe/size winner rules.
- Update the `shared.ts` "flagged follow-up" comment once it lands (it becomes stale).

## Verify

- Extraction unit tests on a synthetic multi-record `[GfxHouse]` fixture (one bracket, several
  `EditName` records with distinct costs/hitpoints/bobs).
- Real pipeline run against the owned game copy; report the recovered-type count. This is an
  intentional extraction behavior change — `content/ir.json` moves for the previously mis-joined
  (saracen/egypt) types; the viking demo lanes should stay byte-identical (single-tribe records were
  never lumped) — verify and name any exception in the commit.
- `npm test`, `npm run check`, `npm run build`.
