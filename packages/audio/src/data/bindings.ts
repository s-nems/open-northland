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
 * The viking voice pools the ambient settler-chatter layer draws from — `SoundFXStatic` group names
 * straight from `soundfx.cif` (the mod's `humans/sounds.cif` binds these same groups per tribe/sex).
 * Together they hold ~240 clips (clear-throats, coughs, laughs, gasps, small talk) across male / female
 * / child voices, so an on-screen crowd chatters with real variety. The driver picks a group then a
 * clip uniformly. Viking-only for now — the demo world is single-tribe; other tribes' pools
 * (`Talk Franks Male`, `Generic Latin Female`, …) exist in the bank for when the sim carries tribe/sex.
 */
export const VIKING_VOICE_GROUPS: readonly string[] = [
  'Generic Viking Male',
  'Generic Viking Female',
  'Generic Viking Children',
  'Talk Viking Male',
  'Talk Viking Female',
  'SocialTalk Male',
  'SocialTalk Female',
];

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
