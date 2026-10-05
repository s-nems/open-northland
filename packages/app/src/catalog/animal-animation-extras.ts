/** Unbound clips in mapmoveableanimations/animations.ini. Selecting them is a presentation
 * approximation; the source supplies no action programs or selection cadence for these clips. */
export const ANIMAL_EXTRA_ANIMATIONS: ReadonlyMap<
  number,
  { readonly idle?: string; readonly alternateWalk?: string; readonly swimming?: string }
> = new Map([
  [11, { idle: 'animal_deer_male_wait_1' }],
  [19, { idle: 'animal_sheep_wait' }],
  [20, { idle: 'animal_wolf_wait_normal' }],
  [25, { alternateWalk: 'animal_lion_male_walk_bak' }],
  [31, { swimming: 'animal_duck_swim' }],
]);
