/**
 * How many civilians a garrison building shelters while its alarm is up. Which types may raise the mode is
 * the extracted `logicCanEnableDefenceMode` flag; no readable record carries the size. Original behavior:
 * the headquarters takes 30, the large tower 20 and every other defence house 10.
 *
 * A shelter seat is separate from a tower's employed `logicworker` post, so a full garrison of archers
 * takes nothing from the room the townspeople run into. Keyed by `ir.json` id-slug, so one table serves
 * both content bases.
 */
export const SHELTER_CAPACITY_BY_ID: Readonly<Record<string, number>> = {
  headquarters: 30,
  tower_01: 20,
};

/** The garrison of every other flagged type: the small tower, the barracks, a mod's own defence house. */
export const DEFAULT_SHELTER_CAPACITY = 10;

/** The garrison `shelterCapacity` a defence-capable building of this id takes. */
export function shelterCapacityById(id: string): number {
  return SHELTER_CAPACITY_BY_ID[id] ?? DEFAULT_SHELTER_CAPACITY;
}

/** The garrison a building type takes: the original's size for a flagged type, none for the rest. */
export function shelterCapacityFor(building: {
  readonly id: string;
  readonly canEnableDefenceMode?: boolean;
}): number {
  return building.canEnableDefenceMode ? shelterCapacityById(building.id) : 0;
}
