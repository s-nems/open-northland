import { z } from 'zod';

/** One half-cell offset of a building footprint, relative to the building's placed anchor node, on the
 *  original's `2W×2H` logic lattice that `map.cif` placements also address. */
export const FootprintCell = z.strictObject({
  dx: z.number().int(),
  dy: z.number().int(),
});
export type FootprintCell = z.infer<typeof FootprintCell>;

/**
 * A building type's ground footprint, extracted from the graphics table's `[GfxHouse]` record (the
 * readable `DataCnmd/budynki12/houses/houses.ini`), in half-cell offsets from the building's anchor
 * node. Absent on a building the graphics table omits: such a type places with no collision, blocks
 * nothing, and is interacted with on its anchor tile.
 */
export const BuildingFootprint = z.strictObject({
  /** `LogicWalkBlockArea` for this size level: the cells the standing building makes unwalkable. */
  blocked: z.array(FootprintCell).default([]),
  /** Union of `blocked` across every size level: the largest body the upgrade chain can grow to. */
  familyBody: z.array(FootprintCell).default([]),
  /** `familyBody` ∪ the record's level-independent `LogicBuildBlockArea` cells: the area kept clear of
   *  other construction, including the margin ring the source draws around the walls. */
  reserved: z.array(FootprintCell).default([]),
  /** `LogicDoorPoint` for this size level: the cell settlers interact from. A defence wall's door sits
   *  inside its walk-block, the passable gate the sim's nav overlay carves out. */
  door: FootprintCell.optional(),
});
export type BuildingFootprint = z.infer<typeof BuildingFootprint>;
