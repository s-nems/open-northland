import type { EventSound, SoundBindings } from './types.js';

/**
 * The faithful Cultures event→sound map — the "engine semantics" layer that says WHICH sim event
 * triggers WHICH sound group. The original drives these off animation / `LogicSoundType` / `MusicType`
 * ids; we bind by the names + `MusicType`s decoded from `soundfx.cif`, so this is the reversed mapping
 * expressed as data. It lives in the audio package (not the app) so every consumer gets the same
 * default; the only game-specific hole is the chop atomic id (a content value), which the caller fills.
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
//     decoded from `soundfx.cif`). A melee `combatHit` rings its weapon's impact; a bow's `projectileLaunched`
//     twangs and its `projectileHit` thunks. Faithful group NAMES; which SPECIFIC group each event picks is
//     the reversed engine mapping (see the header) expressed as data. ---
/** Melee swing swoosh — the whoosh on EVERY swing (hit or miss). The swing wavs are SHARED across the
 *  melee weapons in the bank (`Weapon Sword Short` / `Weapon Spear` / `Weapon Fist` all point at the same
 *  `swing0N.wav` set), so one generic swing group faithfully covers sword/spear/fist. */
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
 * The three melee weapon-classes (`weaponMainType`) that select a DISTINCT impact SFX in the
 * {@link defaultBindings} `byCombatWeapon` map below — so a sword blow and a spear thrust sound different.
 * Saber/axe (4/5) and an unclassified weapon carry no entry and fall through to the {@link GROUP_SWORD_HIT}
 * generic melee thunk (`byEvent.combatHit`) — the mod ships no dedicated saber/axe impact group. Ranged
 * classes (bow 6 / catapult 7) never emit a `combatHit` (their hit is the arrow/rock `projectileHit`).
 */
const WEAPON_MAIN_TYPE_FIST = 1;
const WEAPON_MAIN_TYPE_SPEAR = 2;
const WEAPON_MAIN_TYPE_SWORD = 3;

/**
 * A settler's voice class — the axis the ambient chatter picks its pool by, so a settler SOUNDS like it
 * LOOKS. An all-male crowd murmurs only male voices; a woman speaks female clips; a child pipes up with a
 * child one. Without this the chatter played every pool uniformly — women and children coming out of a
 * crowd of men (the crowd-voice mismatch the user heard).
 */
export type VoiceClass = 'male' | 'female' | 'child';

/**
 * The mod's viking `woman` job (`jobtypes.ini` id 5) — the ONE adult job with a female body/voice; every
 * other adult trade + the soldiers share the male body. Mirrors the render roster's
 * `ADULT_CHARACTER_BY_JOB` (packages/app `content/settler-gfx.ts`), so look and sound classify the same
 * settler the same way. The one canonical jobtypes id this layer needs, in the same status as the atomic
 * / MusicType ids already baked into this file.
 */
export const WOMAN_JOB = 5;

/**
 * Classify a settler's voice from the SAME facts the render layer picks its BODY from: a settler that
 * still carries an `Age` (baby/child) is a `child`; an adult `woman` (job {@link WOMAN_JOB}) is `female`;
 * every other adult is `male`. Pure — the caller reads `jobType` + Age-presence off the snapshot. The
 * reversed `jobtypes.ini` sex split expressed as code, the voice twin of the render roster's job→body join.
 */
export function vikingVoiceClass(jobType: number | null, young: boolean): VoiceClass {
  if (young) return 'child';
  if (jobType === WOMAN_JOB) return 'female';
  return 'male';
}

/**
 * The viking voice pools the ambient settler-chatter layer draws from, **keyed by sex/age** so the murmur
 * matches who is on screen — `SoundFXStatic` group names straight from `soundfx.cif` (the mod's
 * `humans/sounds.cif` binds these same groups per tribe/sex). Each class pools that sex's generic human
 * noises (clear-throats, coughs, laughs), its small-talk lines and its social chatter; together ~270
 * clips. The driver classifies a settler ({@link vikingVoiceClass}), then picks a group in that pool, then
 * a clip. Viking-only for now — the demo world is single-tribe; other tribes' pools (`Talk Franks Male`,
 * `Generic Latin Female`, …) exist in the bank for when the sim carries tribe.
 */
export const VIKING_VOICE_POOLS: Readonly<Record<VoiceClass, readonly string[]>> = {
  male: ['Generic Viking Male', 'Talk Viking Male', 'SocialTalk Male'],
  female: ['Generic Viking Female', 'Talk Viking Female', 'SocialTalk Female'],
  child: ['Generic Viking Children'],
};

/**
 * Build the default {@link SoundBindings}. `chopAtomicId`/`buildAtomicId`, when given, bind those
 * content-specific atomics to the woodcutter axe / construction hammer groups (the app knows its content's
 * atomic ids; the audio package cannot). The chop sounds on `atomicCompleted` (`byAtomic`); the build
 * hammer sounds on the MID-swing `atomicSound` cue (`byAtomicSound`) so EACH builder swing's knock lands
 * on the visual strike, not the swing's end (the per-swing twin of the one-shot `buildingPlaced` hammer
 * below). Omit an id and that atomic simply produces no sound.
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
      // The death jingle is a notification to the player — it rings only when the LOCAL player's own
      // unit falls, never for an enemy or a wild animal (the director gates it on the event's owner).
      settlerDied: { kind: 'jingle', musicType: JINGLE_DEATH, localPlayerOnly: true },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
      // Combat: a melee swing swoosh (every swing), the blow connecting (weapon-specific below), a bow
      // loosing, an arrow landing.
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
