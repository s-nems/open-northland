import type { EventSound, SoundBindings } from './types.js';

/**
 * The Cultures event→sound map: which sim event triggers which sound group. The original drives these
 * off animation / `LogicSoundType` / `MusicType` ids; this binds by the names + `MusicType`s decoded
 * from the decoded `soundfx.cif` mapping.
 */

// --- Jingle MusicType ids, straight from soundfx.cif's SoundFXJingle records ---
/** `MusicType` of the birth jingle (`jingles_birth.wav`). */
export const JINGLE_BIRTH = 23;
/** `MusicType` of the death jingle (`jingles_death.wav`). */
export const JINGLE_DEATH = 25;
/** `MusicType` of the house-built jingle (`jingles_housebuilt.wav`). */
export const JINGLE_HOUSE_BUILT = 26;

// --- Static sound-group names (SoundFXStatic `Name`s) for the positioned action SFX ---
/** Construction hammering — placed at a newly-sited building/boat. */
export const GROUP_HAMMER_WOOD = 'Hammer Wood';
/** Axe chops — the woodcutter working a tree (bound to the chop atomic by the caller). */
export const GROUP_WOODCUTTER_AXE = 'Woodcutter Axe';
/** Sawing — a workshop producing (bound to `goodProduced`). */
export const GROUP_CARPENTER_SAW = 'Carpenter Saw';

// --- Combat impact / weapon SFX (SoundFXStatic `Name`s, the weapon-impact `LogicSoundType` 67–96 set
//     decoded from `soundfx.cif`). ---
/** Melee swing swoosh — plays on every swing, hit or miss. The melee weapons share one swing wav set in
 *  the bank (`Weapon Sword Short` / `Weapon Spear` / `Weapon Fist` all point at the same `swing0N.wav`),
 *  so one generic swing group covers sword/spear/fist. */
export const GROUP_MELEE_SWING = 'Weapon Sword Short';
/** Fist impact — a bare-handed civilian brawl connecting (LogicSoundType 93). */
export const GROUP_FIST_HIT = 'Weapon Fist Hit';
/** Spear thrust connecting (LogicSoundType 68). */
export const GROUP_SPEAR_HIT = 'Weapon Spear Hit';
/** Sword blow connecting — the short-sword impact, the generic melee-thunk fallback too (LogicSoundType 82). */
export const GROUP_SWORD_HIT = 'Weapon Sword Short Hit';
/** Bow release — the string loosing an arrow (LogicSoundType 75, the long/hunter bow twang). */
export const GROUP_BOW_SHOT = 'Weapon Bow Long';
/** Arrow impact — the shot landing its blow (LogicSoundType 77). */
export const GROUP_ARROW_HIT = 'Weapon Bow Hit';

/**
 * The three melee weapon-classes (`weaponMainType`) with a distinct impact SFX in the
 * {@link defaultBindings} `byCombatWeapon` map. Saber/axe (4/5) and unclassified weapons have no entry
 * and fall through to the {@link GROUP_SWORD_HIT} generic melee thunk (`byEvent.combatHit`) — the mod
 * ships no dedicated saber/axe impact group. Ranged classes (bow 6 / catapult 7) never emit a
 * `combatHit` (their hit is the arrow/rock `projectileHit`).
 */
const WEAPON_MAIN_TYPE_FIST = 1;
const WEAPON_MAIN_TYPE_SPEAR = 2;
const WEAPON_MAIN_TYPE_SWORD = 3;

/** A settler's voice class — the axis the ambient chatter picks its pool by. */
export type VoiceClass = 'male' | 'female' | 'child';

/**
 * The mod's viking `woman` job (`jobtypes.ini` id 5) — the one adult job with a female body/voice; every
 * other adult trade and the soldiers share the male body. Mirrors the render roster's
 * `ADULT_CHARACTER_BY_JOB` (packages/app `content/settler-gfx.ts`).
 */
export const WOMAN_JOB = 5;

/**
 * Classify a settler's voice: a settler still carrying an `Age` (baby/child) is a `child`; an adult
 * `woman` (job {@link WOMAN_JOB}) is `female`; every other adult is `male`.
 */
export function vikingVoiceClass(jobType: number | null, young: boolean): VoiceClass {
  if (young) return 'child';
  if (jobType === WOMAN_JOB) return 'female';
  return 'male';
}

/**
 * The viking voice pools the ambient settler-chatter layer draws from, keyed by sex/age — `SoundFXStatic`
 * group names from `soundfx.cif` (the mod's `humans/sounds.cif` binds these same groups per tribe/sex).
 * Viking-only for now — the demo world is single-tribe; other tribes' pools (`Talk Franks Male`,
 * `Generic Latin Female`, …) exist in the bank for when the sim carries tribe.
 */
export const VIKING_VOICE_POOLS: Readonly<Record<VoiceClass, readonly string[]>> = {
  male: ['Generic Viking Male', 'Talk Viking Male', 'SocialTalk Male'],
  female: ['Generic Viking Female', 'Talk Viking Female', 'SocialTalk Female'],
  child: ['Generic Viking Children'],
};

/**
 * Build the default {@link SoundBindings}. `chopAtomicId`/`buildAtomicId`, when given, bind those
 * content-specific atomics to the woodcutter axe / construction hammer groups (the app knows its
 * content's atomic ids; the audio package cannot). The chop sounds on `atomicCompleted` (`byAtomic`); the
 * build hammer on the mid-swing `atomicSound` cue (`byAtomicSound`). Omit an id and that atomic produces
 * no sound.
 */
export function defaultBindings(opts?: {
  readonly chopAtomicId?: number;
  readonly buildAtomicId?: number;
}): SoundBindings {
  const byAtomic = new Map<number, EventSound>();
  if (opts?.chopAtomicId !== undefined) {
    byAtomic.set(opts.chopAtomicId, { kind: 'spatial', group: GROUP_WOODCUTTER_AXE });
  }
  const byAtomicSound = new Map<number, EventSound>();
  if (opts?.buildAtomicId !== undefined) {
    byAtomicSound.set(opts.buildAtomicId, { kind: 'spatial', group: GROUP_HAMMER_WOOD });
  }
  return {
    byEvent: {
      buildingPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      boatPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      buildingFinished: { kind: 'jingle', musicType: JINGLE_HOUSE_BUILT },
      settlerBorn: { kind: 'jingle', musicType: JINGLE_BIRTH },
      settlerDied: { kind: 'jingle', musicType: JINGLE_DEATH, localPlayerOnly: true },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
      combatSwing: { kind: 'spatial', group: GROUP_MELEE_SWING },
      combatHit: { kind: 'spatial', group: GROUP_SWORD_HIT },
      projectileLaunched: { kind: 'spatial', group: GROUP_BOW_SHOT },
      projectileHit: { kind: 'spatial', group: GROUP_ARROW_HIT },
    },
    byAtomic,
    byAtomicSound,
    byCombatWeapon: new Map<number, EventSound>([
      [WEAPON_MAIN_TYPE_FIST, { kind: 'spatial', group: GROUP_FIST_HIT }],
      [WEAPON_MAIN_TYPE_SPEAR, { kind: 'spatial', group: GROUP_SPEAR_HIT }],
      [WEAPON_MAIN_TYPE_SWORD, { kind: 'spatial', group: GROUP_SWORD_HIT }],
    ]),
  };
}
