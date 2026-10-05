/** Presentation and movement fallback for clips without a readable movement binding.
 * Approximation: ducks stay on water because their only own locomotion clip is animal_duck_swim.
 * The tribe id is TRIBE_TYPE_ANIMAL_DUCK in logicdefines.inc. Other species retain land movement. */
export const ANIMAL_WATER_TRIBES: ReadonlySet<number> = new Set([31]);
