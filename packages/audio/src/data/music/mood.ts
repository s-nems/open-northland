import {
  type DiplomacyState,
  type Entity,
  entityById,
  type SimEvent,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entityOwner } from '../snapshot.js';
import type { MusicVariants, ThemeMood } from './catalog.js';
import type { MusicIntensity } from './pools.js';

/**
 * Whether the map's music should be calm or tense, and which of its own stems fits the standing.
 * Original behavior: a blow between the local player and another player, either way round, switches
 * to attack music and holds it {@link ATTACK_HOLD_TICKS}, each new blow extending the hold. Here a
 * lone blow does not cut the score in: the music turns tense only once a run of blows latches a battle,
 * and the original's hold then keeps an already tense score from calming. The latch and the wealthy
 * head-count are authored, standing in for the original's happiness score, which the snapshot does
 * not expose. The segment names and the variant sets they switch between are not approximations.
 */

/** How long a blow holds a battle's music tense, each new blow restarting it. Original behavior: the
 *  attack override holds 120 ticks at 12 per second, about 10 s. */
export const ATTACK_HOLD_TICKS = 10 * TICKS_PER_SECOND;

/** Ticks for the threat of past blows to halve. Approximation, tune by ear. */
export const THREAT_HALF_LIFE_TICKS = 5 * TICKS_PER_SECOND;

/** Threat, counted in recent blows between the local player and another player, that turns a skirmish
 *  into a battle and the music tense. A lone blow does nothing audible. Approximation. */
export const TENSE_ENTER_THREAT = 3;

/** Threat a battle must decay below, with the attack hold run out, before the music may calm again.
 *  Far under the entry line, so the music turns tense fast and calms slowly: a 30-blow fight stays
 *  tense about 30 s after its last blow. Approximation. */
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
  /** The tick the attack hold runs out at; it only sustains a battle already latched. */
  readonly attackUntilTick: number;
  /** Recent blows between the local player and another, decayed to {@link threatTick}. */
  readonly threat: number;
  readonly threatTick: number;
  /** Latched at {@link TENSE_ENTER_THREAT}, held until the threat falls under {@link TENSE_EXIT_THREAT}
   *  and the attack hold runs out. */
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
 * How many of this frame's blows landed between the local player and another player, either way round.
 * A beast's bite, a hunter's shot at game and a stray shot on a side not at war have no player at one
 * end, or none at war, and do not count.
 */
function playerBlows({ events, snapshot, localPlayer }: MusicMoodInput): number {
  if (localPlayer === undefined) return 0;
  const ownerOfTarget = (target: Entity): number | undefined => {
    const found = entityById(snapshot, target);
    return found === undefined ? undefined : entityOwner(found.components);
  };
  let blows = 0;
  for (const event of events) {
    switch (event.kind) {
      case 'combatHit':
        if (involves(localPlayer, event.attackerPlayer, ownerOfTarget(event.target))) blows++;
        break;
      case 'projectileHit':
        if (
          event.collateral !== true &&
          involves(localPlayer, event.shooterPlayer, ownerOfTarget(event.target))
        ) {
          blows++;
        }
        break;
      default:
        break;
    }
  }
  return blows;
}

/** Whether a blow from `attacker`'s side on `victim`'s is one between `local` and another player. */
function involves(local: number, attacker: number | undefined, victim: number | undefined): boolean {
  if (attacker === undefined || victim === undefined || attacker === victim) return false;
  return attacker === local || victim === local;
}

/** Advance every latch: a blow restarts the attack hold and adds to the decaying threat, the threat
 *  latches a battle at its entry line, the battle holds while the threat stays over its exit line or
 *  the attack hold runs, and the head-count moves in and out of wealthy at its two lines. */
export function nextMusicMood(previous: MusicMoodState, input: MusicMoodInput): MusicMoodState {
  const { tick } = input.snapshot;
  const blows = playerBlows(input);
  const elapsed = Math.max(0, tick - previous.threatTick);
  const threat = previous.threat * 0.5 ** (elapsed / THREAT_HALF_LIFE_TICKS) + blows;
  const attackUntilTick = blows > 0 ? tick + ATTACK_HOLD_TICKS : previous.attackUntilTick;
  const { population } = input.standing;
  return {
    attackUntilTick,
    threat,
    threatTick: tick,
    battle: previous.battle
      ? threat >= TENSE_EXIT_THREAT || tick < attackUntilTick
      : threat >= TENSE_ENTER_THREAT,
    wealthy: previous.wealthy ? population > WEALTHY_POPULATION_DROP : population >= WEALTHY_POPULATION,
  };
}

/** Tense while a battle is latched. */
export function musicIntensity(mood: MusicMoodState): MusicIntensity {
  return mood.battle ? 'tense' : 'calm';
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
