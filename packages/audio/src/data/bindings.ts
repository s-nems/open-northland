import type { EventSound, SoundBindings } from './types.js';

/**
 * The Cultures event→sound map: which sim event triggers which sound group. The original drives these
 * off animation / `LogicSoundType` / `MusicType` ids; this binds by the names + `MusicType`s decoded
 * from the decoded `soundfx.cif` mapping.
 */

// --- Jingle MusicType ids, straight from soundfx.cif's SoundFXJingle records ---
/** `MusicType` of the birth jingle (`jingles_birth.wav`). */
export const JINGLE_BIRTH = 23;
/** `MusicType` of the civil-defence jingle (`jingles_civildefense.wav`) - the alarm bells a player rings
 *  by putting a building into defence mode. */
export const JINGLE_CIVIL_DEFENSE = 24;
/** `MusicType` of the death jingle (`jingles_death.wav`). */
export const JINGLE_DEATH = 25;
/** `MusicType` of the house-built jingle (`jingles_housebuilt.wav`). */
export const JINGLE_HOUSE_BUILT = 26;

// --- Static sound-group names (SoundFXStatic `Name`s) for the positioned action SFX ---
/** Construction hammering - placed at a newly-sited building/boat. */
export const GROUP_HAMMER_WOOD = 'Hammer Wood';
/** Sawing - a workshop producing (bound to `goodProduced`). */
export const GROUP_CARPENTER_SAW = 'Carpenter Saw';

// --- Combat impact SFX (SoundFXStatic `Name`s, the weapon-impact `LogicSoundType` 67–96 set decoded from
//     `soundfx.cif`). ---
/** Melee swing swoosh, for the bodies whose attack clip authors no sound of its own. The melee weapons
 *  share one swing wav set in the bank (`Weapon Sword Short` / `Weapon Spear` / `Weapon Fist` all point at
 *  the same `swing0N.wav`), so one generic swing group covers sword/spear/fist. */
export const GROUP_MELEE_SWING = 'Weapon Sword Short';
/** Fist impact - a bare-handed civilian brawl connecting (LogicSoundType 93). */
export const GROUP_FIST_HIT = 'Weapon Fist Hit';
/** Spear thrust connecting (LogicSoundType 68). */
export const GROUP_SPEAR_HIT = 'Weapon Spear Hit';
/** Sword blow connecting - the short-sword impact, the generic melee-thunk fallback too (LogicSoundType 82). */
export const GROUP_SWORD_HIT = 'Weapon Sword Short Hit';
/** Arrow impact - the shot landing its blow (LogicSoundType 77). */
export const GROUP_ARROW_HIT = 'Weapon Bow Hit';

/**
 * The three melee weapon-classes (`weaponMainType`) with a distinct impact SFX in the
 * {@link defaultBindings} `byCombatWeapon` map. Saber/axe (4/5) and unclassified weapons have no entry
 * and fall through to the {@link GROUP_SWORD_HIT} generic melee thunk (`byEvent.combatHit`) - the mod
 * ships no dedicated saber/axe impact group. Ranged classes (bow 6 / catapult 7) never emit a
 * `combatHit` (their hit is the arrow/rock `projectileHit`).
 */
const WEAPON_MAIN_TYPE_FIST = 1;
const WEAPON_MAIN_TYPE_SPEAR = 2;
const WEAPON_MAIN_TYPE_SWORD = 3;

/** A settler's voice class - the axis the `?sounds` gallery groups the voice pools by. */
export type VoiceClass = 'male' | 'female' | 'child';

/**
 * The viking voice pools, keyed by sex/age - `SoundFXStatic` group names from `soundfx.cif` (the mod's
 * `humans/sounds.cif` binds these same groups per tribe/sex). In play, a voice comes from the talk clip's
 * authored `atomicSound` cue, which names its group by `logicSoundType` id (the SocialTalk pair 61/62);
 * this table remains the gallery's audition listing of all the pools.
 */
export const VIKING_VOICE_POOLS: Readonly<Record<VoiceClass, readonly string[]>> = {
  male: ['Generic Viking Male', 'Talk Viking Male', 'SocialTalk Male'],
  female: ['Generic Viking Female', 'Talk Viking Female', 'SocialTalk Female'],
  child: ['Generic Viking Children'],
};

/**
 * Build the default {@link SoundBindings} - the sounds this package picks, for the happenings that are not
 * a settler's own animation. Every action a settler performs sounds through its clip's authored
 * `logicSoundType` cue instead, so no atomic is bound here.
 */
export function defaultBindings(): SoundBindings {
  return {
    byEvent: {
      buildingPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      boatPlaced: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      // Life-event stingers ring only for the local player's own events and only from the visible
      // screen. The defence alarm stays map-wide: it acknowledges the player's own raise-alarm
      // command, wherever the garrison building sits.
      buildingFinished: {
        kind: 'jingle',
        musicType: JINGLE_HOUSE_BUILT,
        localPlayerOnly: true,
        screenGated: true,
      },
      settlerBorn: { kind: 'jingle', musicType: JINGLE_BIRTH, localPlayerOnly: true, screenGated: true },
      settlerDied: { kind: 'jingle', musicType: JINGLE_DEATH, localPlayerOnly: true, screenGated: true },
      defenceAlarmRaised: { kind: 'jingle', musicType: JINGLE_CIVIL_DEFENSE, localPlayerOnly: true },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
      // The sim withholds `combatSwing` from a clip that authors its own per-weapon swoosh
      // (`viking_soldier_attack_spear_iron` `event 16 34 67`), so this generic one never doubles it. No
      // release entry: every ranged clip in the data authors its bowstring, and `projectileLaunched`
      // fires whether it does or not.
      combatSwing: { kind: 'spatial', group: GROUP_MELEE_SWING },
      combatHit: { kind: 'spatial', group: GROUP_SWORD_HIT },
      projectileHit: { kind: 'spatial', group: GROUP_ARROW_HIT },
    },
    byCombatWeapon: new Map<number, EventSound>([
      [WEAPON_MAIN_TYPE_FIST, { kind: 'spatial', group: GROUP_FIST_HIT }],
      [WEAPON_MAIN_TYPE_SPEAR, { kind: 'spatial', group: GROUP_SPEAR_HIT }],
      [WEAPON_MAIN_TYPE_SWORD, { kind: 'spatial', group: GROUP_SWORD_HIT }],
    ]),
  };
}
