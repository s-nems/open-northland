# Extract LogicConstructionWorkArea and stand builders on the data's work cells

**Area:** pipeline + sim (+ data schema) · **Origin:** gathering-economy plan reconciliation,
2026-07-12 · **Priority:** P2

Builder work slots use a uniform door-anchored yard placeholder: `claimWorkCell` takes the walkable
region within `WORK_YARD_RADIUS_NODES = 4` of the site's `interactionCell` (flagged PLACEHOLDER in
`packages/sim/src/systems/agents/destack.ts`). The original pins per-building stand cells.

**Source basis (verified against the real data 2026-07-12):** `[GfxHouse]` records carry
`LogicConstructionWorkArea <sizeIdx> <dx> <dy> <run>` — 3745 rows across 165 records in
`Cultures 8th Wonder/EdytorByRemik/ejkfhsnkjehbhouses.ini`, co-located with the
`LogicWalkBlockArea`/`LogicDoorPoint` keys the pipeline already parses, same run encoding. The
pipeline's `extractBuildingFootprints` (`tools/asset-pipeline/src/decoders/ini/buildings-gfx/structure.ts`,
re-exported via `decoders/ini.ts`) skips this key and `BuildingFootprint` has no work-area field.
Sanity-check the `run` semantics (+x half-cell run
assumed, like walk-block) against OpenVikings before trusting it.

## Scope

1. Add a `constructionWorkArea` `FootprintCell[]` to `BuildingFootprint`
   (`packages/data/src/schema/economy/building-footprint.ts`).
2. Parse the key in `extractBuildingFootprints` via the existing `expandAreaRun` + per-`sizeIdx` +
   tribe/size winner path.
3. In `claimWorkCell`/`yardCells`: when the site's type carries a work area, use those cells
   (anchored, intersected with walkable); keep the uniform yard as fallback for types the table
   omits and synthetic test content.

Split if it balloons: (a) pipeline+schema (no sim change), then (b) the sim consumer + golden move.

## Verify

- Pipeline extraction test on a synthetic `[GfxHouse]` fixture + real pipeline run.
- `test/conflict/spacing.test.ts` builder-slot cases; **golden moves — builder stand cells change;
  name the mechanic in the commit**.
- A construction-site scene: stand cells hug the site's footprint — **user's eyes**.
