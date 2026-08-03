/**
 * The defence-mode balance: how many civilians each garrison building shelters while its alarm is up.
 * The source flags which buildings may raise the mode (`BuildingType.shelterCapacity`) but carries no
 * garrison size, so these numbers are authored, and until that flag is extracted the table doubles as
 * the eligibility set. The barracks is absent on purpose: it trains soldiers rather than hiding civilians.
 *
 * A shelter seat is separate from a tower's employed `logicworker` post, so a full garrison of archers
 * takes nothing from the room the townspeople run into. Keyed by `ir.json` id-slug, so one table serves
 * both content bases.
 */
export const SHELTER_CAPACITY_BY_ID: Readonly<Record<string, number>> = {
  headquarters: 30,
  tower_00: 15,
  tower_01: 20,
};

/** The garrison `shelterCapacity` for a building id, or 0 for a type that takes none. */
export function shelterCapacityById(id: string): number {
  return SHELTER_CAPACITY_BY_ID[id] ?? 0;
}

/**
 * The house bow's damage: an authored override of the extracted `weapons.ini` row (typeId 20, bound to
 * the `civilist` job, so it is the original's defence-mode weapon). The mod data lets a civilian at a
 * window out-damage a trained soldier's short bow against wool, chain and plate (240/150/150 against
 * 128/100/100), so each column is rounded to a third of the short bow's, which is why column 0 reads 167
 * rather than 166; a column already under that keeps its extracted value (wood 11). Band and munition
 * are not overridden, since a wall bow outranging a hand bow is the source's choice.
 */
export const HOUSE_BOW_DAMAGE: Readonly<Record<string, number>> = {
  '0': 167,
  '1': 43,
  '2': 133,
  '3': 33,
  '4': 33,
  '6': 11,
  '7': 33,
};
