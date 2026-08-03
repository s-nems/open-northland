/**
 * The defence-mode balance: how many civilians each garrison building shelters while its alarm is up.
 *
 * AUTHORED (user decision) - `houses.ini` marks the headquarters (logictype 1), barracks (39) and both
 * watchtowers (40/41) `logicCanEnableDefenceMode 1`, but no readable record carries a garrison SIZE, so
 * the numbers are ours: the headquarters holds the town, a watchtower a squad, and its upgraded tier a
 * larger one. The barracks is deliberately absent - it trains soldiers rather than hiding civilians, so
 * it takes no garrison here even though the source lets it raise the mode.
 *
 * Separate seats from the tower's employed posts (`logicworker` slots, `conflict/tower-post.ts`): an
 * archer holds a job, a sheltering civilian holds a shelter seat, and a full garrison of archers takes
 * nothing from the room the townspeople run into.
 *
 * Keyed by the building's `ir.json` id-slug so the one table serves both content bases, like the hunter
 * and farming balances (`catalog/hunting.ts`, `catalog/farming.ts`).
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
 * The house bow's damage - a DESIGN OVERRIDE of the extracted `weapons.ini` row (typeId 20), the same
 * call {@link import('./hunting.js').HUNTER_BOW_BALANCE} makes for the hunter: a civilian shooting from a
 * window must do less than a trained soldier with a short bow (user decision), and the mod data does not
 * hold that - against wool/chain/plate the extracted wall bow beats the short bow (240/150/150 against
 * 128/100/100).
 *
 * The rule is one line: no column above three quarters of the short bow's. The bare-target and leather
 * columns already sit exactly there (375 of 500, 300 of 400) and are the source's own numbers; the three
 * that overshot are reined in to it; the two already below it (house 50, wood 11) keep their extracted
 * value. The band and munition are NOT overridden - a wall bow outranging a hand bow is the source's
 * choice and the point of a tower.
 */
export const HOUSE_BOW_DAMAGE: Readonly<Record<string, number>> = {
  '0': 375,
  '1': 96,
  '2': 300,
  '3': 75,
  '4': 75,
  '6': 11,
  '7': 50,
};
