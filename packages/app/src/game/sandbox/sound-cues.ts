/**
 * The sandbox clips' authored sound cues, transcribed from `DataCnmd/atomicanimations12/atomicanimations.ini`.
 * The sim plays a settler's action sound off its animation's `event <at> 34 <id>` rows, so a sandbox clip
 * without them works in silence.
 */

/** `ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX` in `logicdefines.inc` (l.754): the frame an animation sounds
 *  its FX, which is mid-swing rather than at completion. */
const PLAY_SOUND_FX_EVENT_TYPE = 34;

/**
 * The `soundfx.cif` `SoundFXStatic` `logicSoundType` ids the cues below name, with the group each resolves
 * to. `STONE_STRIKE` and `IRON_STRIKE` resolve to no group in the mod's bank, so those two swings work
 * silently here exactly as they do on a real map.
 */
const SOUND = {
  /** Hammer Wood */
  HAMMER_WOOD: 1,
  /** Hammer Sign */
  HAMMER_SIGN: 2,
  STONE_STRIKE: 3,
  /** Stone Ore */
  STONE_ORE: 5,
  IRON_STRIKE: 6,
  /** Shovel Clay */
  SHOVEL_CLAY: 7,
  /** Shovel Clay2 */
  SHOVEL_CLAY_2: 8,
  /** Woodcutter Axe */
  WOODCUTTER_AXE: 9,
  /** Farmer Scythe */
  FARMER_SCYTHE: 12,
  /** Watering Can */
  WATERING_CAN: 13,
  /** SocialTalk Male */
  SOCIALTALK_MALE: 61,
  /** SocialTalk Female */
  SOCIALTALK_FEMALE: 62,
  /** Weapon Spear */
  WEAPON_SPEAR: 67,
  /** Weapon Bow Short */
  WEAPON_BOW_SHORT: 73,
  /** Weapon Bow Short Arrow */
  WEAPON_BOW_SHORT_ARROW: 74,
  /** Weapon Bow Long */
  WEAPON_BOW_LONG: 75,
  /** Weapon Bow Long Arrow */
  WEAPON_BOW_LONG_ARROW: 76,
  /** Weapon Sword Short */
  WEAPON_SWORD_SHORT: 81,
  /** Weapon Sword Long */
  WEAPON_SWORD_LONG: 85,
  /** Weapon Fist */
  WEAPON_FIST: 92,
} as const;

/** One authored cue: frame `at` of a clip `of` ticks long, naming the `SOUND` group id to play. The source
 *  length travels with the frame because several sandbox clips run at their own tick count. */
interface AuthoredSoundCue {
  readonly at: number;
  readonly of: number;
  readonly soundType: number;
}

/**
 * The transcribed cues per sandbox animation name. A sandbox name that renames its source clip carries that
 * clip beside it; the rest transcribe the row of the same name.
 */
const SOUND_CUES: Readonly<Record<string, readonly AuthoredSoundCue[]>> = {
  viking_collector_harvest_tree: [{ at: 19, of: 30, soundType: SOUND.WOODCUTTER_AXE }],
  viking_collector_harvest_stone: [{ at: 19, of: 29, soundType: SOUND.STONE_STRIKE }],
  viking_collector_harvest_mud: [
    { at: 3, of: 23, soundType: SOUND.SHOVEL_CLAY },
    { at: 16, of: 23, soundType: SOUND.SHOVEL_CLAY_2 },
  ],
  viking_collector_harvest_iron: [{ at: 16, of: 23, soundType: SOUND.IRON_STRIKE }],
  viking_collector_harvest_gold: [{ at: 16, of: 23, soundType: SOUND.STONE_ORE }],
  viking_collector_harvest_mushroom: [{ at: 20, of: 35, soundType: SOUND.WOODCUTTER_AXE }],
  viking_farmer_harvest_wheat: [{ at: 12, of: 24, soundType: SOUND.FARMER_SCYTHE }],
  viking_farmer_cultivate: [{ at: 7, of: 29, soundType: SOUND.WATERING_CAN }],
  viking_builder_build_house: [{ at: 4, of: 15, soundType: SOUND.HAMMER_WOOD }],
  viking_scout_build_guide: [{ at: 4, of: 15, soundType: SOUND.HAMMER_SIGN }],
  viking_civilist_talk: [{ at: 0, of: 247, soundType: SOUND.SOCIALTALK_MALE }],
  viking_civilist_listen: [{ at: 135, of: 247, soundType: SOUND.SOCIALTALK_MALE }],
  viking_woman_talk: [{ at: 0, of: 100, soundType: SOUND.SOCIALTALK_FEMALE }],
  viking_woman_listen: [{ at: 22, of: 100, soundType: SOUND.SOCIALTALK_FEMALE }],
  // viking_soldier_attack_unarmed
  viking_fist_attack: [{ at: 5, of: 12, soundType: SOUND.WEAPON_FIST }],
  // viking_soldier_attack_spear_iron
  viking_spear_attack: [{ at: 16, of: 27, soundType: SOUND.WEAPON_SPEAR }],
  // viking_soldier_attack_sword_short
  viking_sword_attack: [{ at: 6, of: 12, soundType: SOUND.WEAPON_SWORD_SHORT }],
  // viking_soldier_attack_sword_long
  viking_broadsword_attack: [{ at: 14, of: 29, soundType: SOUND.WEAPON_SWORD_LONG }],
  // viking_soldier_attack_bow_short - the draw, then the arrow leaving the string
  viking_bow_attack: [
    { at: 6, of: 12, soundType: SOUND.WEAPON_BOW_SHORT },
    { at: 9, of: 12, soundType: SOUND.WEAPON_BOW_SHORT_ARROW },
  ],
  // viking_soldier_attack_bow_long
  viking_bow_long_attack: [
    { at: 15, of: 28, soundType: SOUND.WEAPON_BOW_LONG },
    { at: 20, of: 28, soundType: SOUND.WEAPON_BOW_LONG_ARROW },
  ],
  viking_hunter_attack: [
    { at: 1, of: 25, soundType: SOUND.WEAPON_BOW_LONG },
    { at: 11, of: 25, soundType: SOUND.WEAPON_BOW_LONG_ARROW },
  ],
};

/** The `event <at> 34 <id>` rows a sandbox clip carries, rescaled from the authored length onto the
 *  `length` this clip actually runs; `[]` for a clip the original leaves silent. */
export function soundCueEvents(
  animation: string,
  length: number,
): readonly { at: number; type: number; value: number }[] {
  const cues = SOUND_CUES[animation];
  if (cues === undefined) return [];
  return cues.map((c) => ({
    at: Math.round((c.at * length) / c.of),
    type: PLAY_SOUND_FX_EVENT_TYPE,
    value: c.soundType,
  }));
}
