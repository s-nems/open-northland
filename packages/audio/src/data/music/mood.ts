import {
  type DiplomacyState,
  entityById,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entityOwner } from '../snapshot.js';
import { MUSIC_VARIANTS, type MusicVariants, type ThemeMood } from './catalog.js';
import type { MusicManifest, MusicTrack } from './manifest.js';

/**
 * Which mood variant of a map's music should be playing. The original's rule is unconfirmed, so every
 * threshold below is an approximation; the segment names
 * and the variant sets they switch between are not.
 */

/** How long the tense variant holds after the last blow. Approximation. Sim ticks, so a faster game
 *  speed shortens the hold in wall-clock terms; it stays well clear of the player's handover fade. */
export const CONFLICT_HOLD_TICKS = 20 * TICKS_PER_SECOND;

/** Settlers the local player must own before a mission plays its Wealthy variant. Approximation: the
 *  head-count is the figure the HUD already shows, the threshold is a choice. */
export const WEALTHY_POPULATION = 60;

/** Where a wealthy settlement stops being one. The gap below {@link WEALTHY_POPULATION} is what keeps a
 *  birth and a death either side of the line from crossfading the track back and forth. */
export const WEALTHY_POPULATION_DROP = 50;

/** Stance to theme mood: the segment suffixes and the stance values name the same three states. */
const THEME_MOOD_BY_STANCE: Readonly<Record<DiplomacyState, ThemeMood>> = {
  friend: 'friendly',
  neutral: 'neutral',
  enemy: 'hostile',
};

/** The local settlement's standing, as the mood variants read it. */
export interface MusicStanding {
  /** Living settlers the local player owns - a mission's prosperity signal. */
  readonly population: number;
  /** The harshest stance standing between the local player and a player it has met - a theme's mood. */
  readonly stance: DiplomacyState;
}

/** What the mood carries between frames, both parts held so a figure crossing a line cannot flap. */
export interface MusicMoodState {
  /** The tick the tense variant may stop at. */
  readonly conflictUntilTick: number;
  readonly wealthy: boolean;
}

/** Before any fight and before any settling: every tick is past the hold. */
export const CALM_MOOD: MusicMoodState = { conflictUntilTick: 0, wealthy: false };

/** One frame's reading of the local settlement, from which the next mood follows. */
export interface MusicMoodInput {
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly standing: MusicStanding;
  /** Omit and no event can be read as aimed at us, so the mood never turns tense. */
  readonly localPlayer?: number;
}

/**
 * Whether this frame's events show the local player being fought: its own defence alarm, or a blow
 * landing on one of its bodies or buildings. A fight it carries to someone else does not count.
 */
function underAttack({ events, snapshot, localPlayer }: MusicMoodInput): boolean {
  if (localPlayer === undefined) return false;
  for (const event of events) {
    switch (event.kind) {
      case 'defenceAlarmRaised':
        if (event.player === localPlayer) return true;
        break;
      case 'combatHit':
      case 'projectileHit': {
        const target = entityById(snapshot, event.target);
        if (target !== undefined && entityOwner(target.components) === localPlayer) return true;
        break;
      }
      default:
        break;
    }
  }
  return false;
}

/** Advance both latches: a blow re-arms the hold, and the head-count moves in and out of wealthy at
 *  its two thresholds. */
export function nextMusicMood(previous: MusicMoodState, input: MusicMoodInput): MusicMoodState {
  const { population } = input.standing;
  return {
    conflictUntilTick: underAttack(input)
      ? input.snapshot.tick + CONFLICT_HOLD_TICKS
      : previous.conflictUntilTick,
    wealthy: previous.wealthy ? population > WEALTHY_POPULATION_DROP : population >= WEALTHY_POPULATION,
  };
}

function stemFor(variants: MusicVariants, stance: DiplomacyState, mood: MusicMoodState, tense: boolean) {
  switch (variants.family) {
    case 'attack':
      return variants.stem;
    case 'theme':
      return variants.stems[tense ? 'hostile' : THEME_MOOD_BY_STANCE[stance]];
    case 'mission':
      if (tense) return variants.stems.danger;
      return mood.wealthy ? variants.stems.wealthy : variants.stems.standard;
  }
}

/** The track a map's `musictype` should play now, or null when the code or the stem has none rendered. */
export function musicTrackFor(
  musicType: number | undefined,
  stance: DiplomacyState,
  mood: MusicMoodState,
  tick: number,
  manifest: MusicManifest | null,
): MusicTrack | null {
  if (musicType === undefined || manifest === null) return null;
  const variants = MUSIC_VARIANTS[musicType];
  if (variants === undefined) return null;
  return manifest.tracks[stemFor(variants, stance, mood, tick < mood.conflictUntilTick)] ?? null;
}
