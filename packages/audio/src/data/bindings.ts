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
 * per-type hold table. The duck's fade lives with the engine's playback constants.
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

/** The original's jingle duck: the music audiopath fades to -2000 hundredths of a dB while a jingle rings. */
export const JINGLE_DUCK_FULL_DB = -20;
/** How deep something done (a building, a discovery, a chest, a birth, a wedding) dips the music: the
 *  score keeps its line under a routine fanfare. Authored, tune by ear. */
export const JINGLE_DUCK_COMPLETION_DB = -12;
/** How deep a death dips the music: the lament lies over the score rather than stopping it. Authored,
 *  tune by ear. */
export const JINGLE_DUCK_DEATH_DB = -8;

/** The depth each jingle `MusicType` dips the music to while it rings. The match verdicts and the
 *  player's own alarm keep the original's full duck; the rest are lighter, an authored choice. */
export const JINGLE_DUCK_DB: ReadonlyMap<number, number> = new Map([
  [JINGLE_MARRIAGE, JINGLE_DUCK_COMPLETION_DB],
  [JINGLE_BIRTH, JINGLE_DUCK_COMPLETION_DB],
  [JINGLE_CIVIL_DEFENSE, JINGLE_DUCK_FULL_DB],
  [JINGLE_DEATH, JINGLE_DUCK_DEATH_DB],
  [JINGLE_HOUSE_BUILT, JINGLE_DUCK_COMPLETION_DB],
  [JINGLE_WON, JINGLE_DUCK_FULL_DB],
  [JINGLE_LOST, JINGLE_DUCK_FULL_DB],
  [JINGLE_TECHNOLOGY, JINGLE_DUCK_COMPLETION_DB],
  [JINGLE_OPEN_CHEST, JINGLE_DUCK_COMPLETION_DB],
]);

/** Seconds between two rings of a listed jingle type while the local player fights: a death in the
 *  battle the player watches would otherwise lament over the tense music at every fall. In a fight it
 *  rings without a duck. Authored, tune by ear. */
export const JINGLE_COMBAT_INTERVAL_S: ReadonlyMap<number, number> = new Map([[JINGLE_DEATH, 15]]);

/** A jingle's music duck: how long it holds and how deep it dips. */
export interface JingleDuck {
  readonly duckMusicMs: number;
  readonly jingleDuckDb: number;
}

/** The duck a jingle of `musicType` rings with at `share` of its gain: its type's hold at its type's depth
 *  times the share, so a ring at half gain dips the music half as deep. Undefined for a type without a
 *  hold. */
export function jingleDuck(musicType: number, share = 1): JingleDuck | undefined {
  const duckMusicMs = JINGLE_DUCK_HOLD_MS.get(musicType);
  if (duckMusicMs === undefined) return undefined;
  return { duckMusicMs, jingleDuckDb: (JINGLE_DUCK_DB.get(musicType) ?? JINGLE_DUCK_FULL_DB) * share };
}

// --- Static sound-group names (SoundFXStatic `Name`s) for the positioned action SFX ---
/** Construction hammering; house builders cue it from their animation, while boat placement binds it here. */
export const GROUP_HAMMER_WOOD = 'Hammer Wood';
/** The two lid sounds the original picks by chest landscape kind before ringing the common jingle. */
export const GROUP_OPEN_WOODEN_CHEST = 'Open Wooden Chest';
export const GROUP_OPEN_MAGICAL_CHEST = 'Open Magical Chest';
/** Sawing - a workshop producing (bound to `goodProduced`). */
export const GROUP_CARPENTER_SAW = 'Carpenter Saw';
/** A house coming down (LogicSoundType 42), razed in combat or torn down by its owner. */
export const GROUP_HOUSE_CRASH = 'House Crash';
/** A tree's creak and crash as it falls (LogicSoundType 10). No clip cues it in the data, so the felling
 *  event sounds it. */
export const GROUP_TREE_FALLING = 'Woodcutter TreeFalling';

/** The horn the attack alert sounds (LogicSoundType 60), short and the loudest brief clip in the bank.
 *  Its data otherwise cues it only from a few map scripts. */
export const GROUP_ALERT_HORN = 'Magic Horn';
/** The yawns a weary settler's notice speaks with, by voice class. */
export const GROUP_YAWN_MAN = 'Yawn Man';
export const GROUP_YAWN_WOMAN = 'Yawn Woman';
/** The sighs a hungry settler's notice speaks with. The bank keeps them only inside the murmur pools,
 *  so they are named by file, and play at the volume those pools author for them. */
export const SIGH_MAN_FILES: readonly string[] = [
  'generic/human_sigh m 01.wav',
  'generic/human_sigh m 02.wav',
];
export const SIGH_WOMAN_FILES: readonly string[] = [
  'generic/human_sigh f 01.wav',
  'generic/human_sigh f 02.wav',
];
/** The gasps a settler about to starve speaks with: short and sharp where a sigh is long, so the last
 *  warning before a death does not read as one more hungry settler. They live in the murmur pools
 *  beside the sighs and play at the volume those pools author for them. */
export const GASP_MAN_FILES: readonly string[] = [
  'generic/human_gasp m 01.wav',
  'generic/human_gasp m 02.wav',
];
export const GASP_WOMAN_FILES: readonly string[] = [
  'generic/human_gasp f 01.wav',
  'generic/human_gasp f 02.wav',
];
/** The share of its gain a finished building's jingle rings at from off screen: about 6 dB under the
 *  on-screen ring, a reminder rather than a fanfare. Authored. */
export const OFF_SCREEN_JINGLE_GAIN = 1 / 2;

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
      vehicleCreated: { kind: 'spatial', group: GROUP_HAMMER_WOOD },
      // Life-event stingers ring only for the local player's own events and only from the visible
      // screen; a finished building rings quieter from off screen too (authored: the original keeps
      // it to the screen). The defence alarm stays map-wide: it acknowledges the player's own
      // raise-alarm command, wherever the garrison building sits.
      buildingFinished: {
        kind: 'jingle',
        musicType: JINGLE_HOUSE_BUILT,
        localPlayerOnly: true,
        screenGated: true,
        offScreenGain: OFF_SCREEN_JINGLE_GAIN,
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
      // A discovery is the seat's own, wherever the settler who made it stands.
      technologyDiscovered: { kind: 'jingle', musicType: JINGLE_TECHNOLOGY, localPlayerOnly: true },
      // The match verdicts are map-wide too: the player's own seat is what decided them.
      playerWon: { kind: 'jingle', musicType: JINGLE_WON, localPlayerOnly: true },
      playerDefeated: { kind: 'jingle', musicType: JINGLE_LOST, localPlayerOnly: true },
      goodProduced: { kind: 'spatial', group: GROUP_CARPENTER_SAW },
      resourceFelled: { kind: 'spatial', group: GROUP_TREE_FALLING },
      // The director withholds this below HOUSE_CRASH_MIN_BUILT: a site under half built comes down silently.
      buildingDestroyed: { kind: 'spatial', group: GROUP_HOUSE_CRASH, layer: 'impact' },
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
    attackAlert: GROUP_ALERT_HORN,
    // A child's notice stays silent: the bank has no child yawn, sigh or gasp.
    noticeVoices: {
      weary: { male: { group: GROUP_YAWN_MAN }, female: { group: GROUP_YAWN_WOMAN } },
      hungry: { male: { files: SIGH_MAN_FILES }, female: { files: SIGH_WOMAN_FILES } },
      dying: { male: { files: GASP_MAN_FILES }, female: { files: GASP_WOMAN_FILES } },
    },
  };
}
