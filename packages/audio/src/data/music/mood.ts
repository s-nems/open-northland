import {
  type DiplomacyState,
  entityById,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entityOwner } from '../snapshot.js';
import type { MusicVariants, ThemeMood } from './catalog.js';
import type { MusicIntensity } from './pools.js';

/**
 * Whether the map's music should be calm or tense, and which of its own stems fits the standing. The
 * attack hold follows the original; the threat latch and the wealthy head-count stand in for the
 * original's happiness score, which the snapshot does not expose. The segment names and the variant
 * sets they switch between are not approximations.
 */

/** How long a blow on the local player holds the tense music, each new blow restarting it. Original
 *  behavior: the attack override holds 120 ticks at 12 per second, about 10 s. */
export const ATTACK_HOLD_TICKS = 10 * TICKS_PER_SECOND;

/** Ticks for the threat of past blows to halve. Approximation, tune by ear. */
export const THREAT_HALF_LIFE_TICKS = 5 * TICKS_PER_SECOND;

/** Threat, counted in recent blows on the local player, that turns a skirmish into a battle. A lone
 *  blow only starts the attack hold; this many close together latch the music tense. Approximation. */
export const TENSE_ENTER_THREAT = 3;

/** Threat a battle must decay below before the music may calm again. Far under the entry line, so
 *  the music turns tense fast and calms slowly: a 30-blow fight stays tense about 30 s after its last
 *  blow. Approximation. */
export const TENSE_EXIT_THREAT = 0.5;

/** Settlers the local player must own before a mission plays its Wealthy variant. Approximation: the
 *  head-count is the figure the HUD already shows, the threshold is a choice. */
export const WEALTHY_POPULATION = 60;

/** Where a wealthy settlement stops being one. The gap below {@link WEALTHY_POPULATION} is what keeps a
 *  birth and a death either side of the line from flipping the variant back and forth. */
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

/** What the mood carries between frames, every latch held so a figure crossing a line cannot flap. */
export interface MusicMoodState {
  /** The tick the attack hold runs out at. */
  readonly attackUntilTick: number;
  /** Recent blows on the local player, decayed to {@link threatTick}. */
  readonly threat: number;
  readonly threatTick: number;
  /** Latched between {@link TENSE_ENTER_THREAT} and {@link TENSE_EXIT_THREAT}. */
  readonly battle: boolean;
  readonly wealthy: boolean;
}

/** Before any fight and before any settling. */
export const CALM_MOOD: MusicMoodState = {
  attackUntilTick: 0,
  threat: 0,
  threatTick: 0,
  battle: false,
  wealthy: false,
};

/** One frame's reading of the local settlement, from which the next mood follows. */
export interface MusicMoodInput {
  readonly events: readonly SimEvent[];
  readonly snapshot: WorldSnapshot;
  readonly standing: MusicStanding;
  /** Omit and no event can be read as aimed at us, so the mood never turns tense. */
  readonly localPlayer?: number;
}

/**
 * How many of this frame's events show the local player being fought: its own defence alarm, or a
 * blow landing on one of its bodies or buildings. A fight it carries to someone else does not count.
 */
function blowsOnUs({ events, snapshot, localPlayer }: MusicMoodInput): number {
  if (localPlayer === undefined) return 0;
  let blows = 0;
  for (const event of events) {
    switch (event.kind) {
      case 'defenceAlarmRaised':
        if (event.player === localPlayer) blows++;
        break;
      case 'combatHit':
      case 'projectileHit': {
        const target = entityById(snapshot, event.target);
        if (target !== undefined && entityOwner(target.components) === localPlayer) blows++;
        break;
      }
      default:
        break;
    }
  }
  return blows;
}

/** Advance every latch: a blow restarts the attack hold and adds to the decaying threat, the threat
 *  moves in and out of battle at its two lines, and the head-count in and out of wealthy at its two. */
export function nextMusicMood(previous: MusicMoodState, input: MusicMoodInput): MusicMoodState {
  const { tick } = input.snapshot;
  const blows = blowsOnUs(input);
  const elapsed = Math.max(0, tick - previous.threatTick);
  const threat = previous.threat * 0.5 ** (elapsed / THREAT_HALF_LIFE_TICKS) + blows;
  const { population } = input.standing;
  return {
    attackUntilTick: blows > 0 ? tick + ATTACK_HOLD_TICKS : previous.attackUntilTick,
    threat,
    threatTick: tick,
    battle: previous.battle ? threat >= TENSE_EXIT_THREAT : threat >= TENSE_ENTER_THREAT,
    wealthy: previous.wealthy ? population > WEALTHY_POPULATION_DROP : population >= WEALTHY_POPULATION,
  };
}

/** Tense while the attack hold runs or a battle is latched. */
export function musicIntensity(mood: MusicMoodState, tick: number): MusicIntensity {
  return mood.battle || tick < mood.attackUntilTick ? 'tense' : 'calm';
}

/** The stem a map code authored for a calm stretch in this standing. */
export function ownCalmStem(variants: MusicVariants, stance: DiplomacyState, wealthy: boolean): string {
  switch (variants.family) {
    case 'attack':
      return variants.stem;
    case 'theme':
      return variants.stems[THEME_MOOD_BY_STANCE[stance]];
    case 'mission':
      return wealthy ? variants.stems.wealthy : variants.stems.standard;
  }
}

/** The stem a map code authored for a fight, or null when its tense slot only repeats a calm stem. */
export function ownTenseStem(variants: MusicVariants): string | null {
  switch (variants.family) {
    case 'attack':
      return variants.stem;
    case 'theme':
      return variants.stems.hostile;
    case 'mission':
      return variants.stems.danger === variants.stems.standard ? null : variants.stems.danger;
  }
}
