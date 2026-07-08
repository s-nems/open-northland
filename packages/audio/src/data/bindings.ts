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
const WOMAN_JOB = 5;

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
 * Build the default {@link SoundBindings}. `chopAtomicId`, when given, binds `atomicCompleted` for
 * that content-specific atomic to the woodcutter axe group (the app knows its content's chop atomic id;
 * the audio package cannot). Omit it and `atomicCompleted` simply produces no sound.
 */
export function defaultBindings(opts?: { readonly chopAtomicId?: number }): SoundBindings {
  const byAtomic = new Map<number, EventSound>();
  if (opts?.chopAtomicId !== undefined) {
    byAtomic.set(opts.chopAtomicId, { kind: 'spatial', group: GROUP_WOODCUTTER_AXE });
  }
  return {
    byEvent: {
      buildingPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      boatPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      buildingFinished: { kind: 'jingle', musicType: JINGLE_HOUSE_BUILT },
      settlerBorn: { kind: 'jingle', musicType: JINGLE_BIRTH },
      settlerDied: { kind: 'jingle', musicType: JINGLE_DEATH },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
    },
    byAtomic,
  };
}
