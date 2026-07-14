import { z } from 'zod';

/** One half-cell offset of a building footprint, relative to the building's placed anchor node —
 *  the original's `2W×2H` logic lattice, the same grid `map.cif` placements address. Extracted
 *  verbatim from the source's `<x> <y>` values. */
export const FootprintCell = z.strictObject({
  dx: z.number().int(),
  dy: z.number().int(),
});
export type FootprintCell = z.infer<typeof FootprintCell>;

/**
 * A building type's ground footprint, extracted from the graphics table's `[GfxHouse]` record (the
 * readable `DataCnmd/budynki12/houses/houses.ini`) — the collision/placement model the original
 * carries per house. All cells are half-cell offsets from the building's anchor node, each
 * source line `<x> <y> <run>` expanding to `run` half-cells starting at `(x, y)` and extending
 * along +x (the `2W×2H` lattice every map lane addresses).
 *
 *  - `blocked` — `LogicWalkBlockArea <sizeIdx> <x> <y> <run>` for THIS type's size level: the cells
 *    the standing building makes unwalkable (its physical body — settlers cannot path through them).
 *  - `familyBody` — the union of `blocked` across ALL the record's size levels: the largest body the
 *    building can grow to through its upgrade chain (a level-0 hut's future max-level walls).
 *  - `reserved` — `familyBody` ∪ the record's `LogicBuildBlockArea` cells (which the source defines
 *    ONCE per record, with no level index — the level-independent build-exclusion zone). This is the
 *    area the building keeps clear of other construction: a level-0 hut reserves exactly what its
 *    top level needs, plus the margin ring the source draws around the walls (the "minimum distance
 *    from other houses / blocking terrain" the original enforces).
 *  - `door` — `LogicDoorPoint <sizeIdx> <x> <y>` for this size level: the entry cell settlers use to
 *    interact with the building (adjacent to the walls for houses; the defence-wall records put it
 *    inside the walk-block — a wall's door is its passable gate, which the sim's nav overlay carves out).
 *
 * Absent on a building the graphics table omits (and on synthetic test content) — such a type places
 * with no collision, blocks nothing, and is interacted with on its anchor tile (the pre-footprint
 * behavior).
 */
export const BuildingFootprint = z.strictObject({
  blocked: z.array(FootprintCell).default([]),
  familyBody: z.array(FootprintCell).default([]),
  reserved: z.array(FootprintCell).default([]),
  door: FootprintCell.optional(),
});
export type BuildingFootprint = z.infer<typeof BuildingFootprint>;
