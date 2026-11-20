/** One retired trade a map may still name, by its `jobtypes.ini` slug or its id, and the trade played in
 *  its place. */
export interface LegacyJob {
  readonly name: string;
  readonly typeId: number;
  readonly target: string;
}

/**
 * Trades the data pack no longer carries, each to the trade a map that names it fields instead: the
 * sabres and axes to the sword of their length, the nameless axe hero to Bjarni. A name the pack still
 * defines resolves as itself.
 */
export const LEGACY_JOBS: readonly LegacyJob[] = [
  { name: 'soldier_saber_short', typeId: 36, target: 'soldier_sword_short' },
  { name: 'soldier_axe_small', typeId: 38, target: 'soldier_sword_short' },
  { name: 'soldier_saber_long', typeId: 37, target: 'soldier_sword_long' },
  { name: 'soldier_axe_big', typeId: 39, target: 'soldier_sword_long' },
  { name: 'hero_axe', typeId: 46, target: 'hero_sword_bjarni' },
];

/** A settler a map places or spawns as one tribe and trade, by catalog slug. */
export interface UnitSlugs {
  readonly tribe: string;
  readonly job: string;
}

/**
 * The spawned units a map authors as one tribe and trade that the pack plays as another. The maps place
 * the dragon as a Byzantine wooden spearman; the pack gives it its own monster tribe, which fights in
 * the unarmed soldier's slot. Only a placement or a spawn moves: a trade opcode naming the wooden
 * spearman keeps meaning the Byzantine trade.
 */
export const LEGACY_UNITS: readonly { readonly from: UnitSlugs; readonly to: UnitSlugs }[] = [
  {
    from: { tribe: 'byzantine', job: 'soldier_spear_wooden' },
    to: { tribe: 'dragon', job: 'soldier_unarmed' },
  },
];
