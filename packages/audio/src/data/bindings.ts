import type { SoundBindings } from './types.js';

/**
 * The Cultures event→sound map: which sim event triggers which sound group. The original drives these
 * off animation / `LogicSoundType` / `MusicType` ids; this binds by the names + `MusicType`s decoded
 * from the decoded `soundfx.cif` mapping.
 */

// --- Jingle MusicType ids, straight from soundfx.cif's SoundFXJingle records ---
/** `MusicType` of the marriage jingle (`jingles_marriage.wav`). */
export const JINGLE_MARRIAGE = 22;
/** `MusicType` of the birth jingle (`jingles_birth.wav`). */
export const JINGLE_BIRTH = 23;
/** `MusicType` of the civil-defence jingle (`jingles_civildefense.wav`) - the alarm bells a player rings
 *  by putting a building into defence mode. */
export const JINGLE_CIVIL_DEFENSE = 24;
/** `MusicType` of the death jingle (`jingles_death.wav`). */
export const JINGLE_DEATH = 25;
/** `MusicType` of the house-built jingle (`jingles_housebuilt.wav`). */
export const JINGLE_HOUSE_BUILT = 26;
/** `MusicType` of the mission-won jingle (`jingles_won.wav`). */
export const JINGLE_WON = 27;
/** `MusicType` of the mission-lost jingle (`jingles_lost.wav`). */
export const JINGLE_LOST = 28;
/** `MusicType` of the technology jingle (`jingles_technology.wav`). */
export const JINGLE_TECHNOLOGY = 29;
/** `MusicType` of the open-chest jingle (`jingles_openchest.wav`). */
export const JINGLE_OPEN_CHEST = 30;

/**
 * Milliseconds the map music stays ducked while each jingle `MusicType` rings, from the original's
 * per-type hold table. The duck depth and fade live with the engine's playback constants.
 */
export const JINGLE_DUCK_HOLD_MS: ReadonlyMap<number, number> = new Map([
  [JINGLE_MARRIAGE, 2800],
  [JINGLE_BIRTH, 3700],
  [JINGLE_CIVIL_DEFENSE, 5000],
  [JINGLE_DEATH, 3200],
  [JINGLE_HOUSE_BUILT, 3300],
  [JINGLE_WON, 8200],
  [JINGLE_LOST, 8000],
  [JINGLE_TECHNOLOGY, 2800],
  [JINGLE_OPEN_CHEST, 3000],
]);

// --- Static sound-group names (SoundFXStatic `Name`s) for the positioned action SFX ---
/** Construction hammering; house builders cue it from their animation, while boat placement binds it here. */
export const GROUP_HAMMER_WOOD = 'Hammer Wood';
/** The two lid sounds the chest callback selects by landscape kind before ringing the common jingle. */
export const GROUP_OPEN_WOODEN_CHEST = 'Open Wooden Chest';
export const GROUP_OPEN_MAGICAL_CHEST = 'Open Magical Chest';
/** Sawing - a workshop producing (bound to `goodProduced`). */
export const GROUP_CARPENTER_SAW = 'Carpenter Saw';
/** A house coming down (LogicSoundType 42), razed in combat or torn down by its owner. */
export const GROUP_HOUSE_CRASH = 'House Crash';

/** Melee swing swoosh. The melee weapons share one swing wav set in the bank (`Weapon Sword Short` /
 *  `Weapon Spear` / `Weapon Fist` all point at the same `swing0N.wav`), so one group covers them all. A
 *  blow's impact needs no binding: the weapon's `soundtype_Hit` table names it on the hit event. */
export const GROUP_MELEE_SWING = 'Weapon Sword Short';

/**
 * Build the default {@link SoundBindings} - the sounds this package picks, for the happenings that are not
 * a settler's own animation. Every action a settler performs sounds through its clip's authored
 * `logicSoundType` cue instead, so no atomic is bound here.
 */
export function defaultBindings(): SoundBindings {
  return {
    byEvent: {
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
      settlersMarried: {
        kind: 'jingle',
        musicType: JINGLE_MARRIAGE,
        localPlayerOnly: true,
        screenGated: true,
      },
      settlerDied: { kind: 'jingle', musicType: JINGLE_DEATH, localPlayerOnly: true, screenGated: true },
      defenceAlarmRaised: { kind: 'jingle', musicType: JINGLE_CIVIL_DEFENSE, localPlayerOnly: true },
      chestOpened: { kind: 'jingle', musicType: JINGLE_OPEN_CHEST, localPlayerOnly: true },
      // The match verdicts are map-wide too: the player's own seat is what decided them.
      playerWon: { kind: 'jingle', musicType: JINGLE_WON, localPlayerOnly: true },
      playerDefeated: { kind: 'jingle', musicType: JINGLE_LOST, localPlayerOnly: true },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
      // The director withholds this below HOUSE_CRASH_MIN_BUILT: a site under half built comes down silently.
      buildingDestroyed: { kind: 'spatial', group: GROUP_HOUSE_CRASH },
      combatSwing: { kind: 'spatial', group: GROUP_MELEE_SWING },
      // No release entry: `projectileLaunched` fires whether or not the clip sounds, so binding it would
      // double the bowstring the 19 cued ranged clips author. The three that author none (the hero bows)
      // loose silently, since the ranged path resolves before the `combatSwing` fallback.
      // A map script's briefing and earthquake ring the engine's hardwired wavs, centred at full gain.
      missionCutscene: { kind: 'cue', cue: 'briefing' },
      missionEarthquake: { kind: 'cue', cue: 'earthquake' },
    },
    byChestKind: {
      wooden: { kind: 'spatial', group: GROUP_OPEN_WOODEN_CHEST },
      magical: { kind: 'spatial', group: GROUP_OPEN_MAGICAL_CHEST },
    },
  };
}
