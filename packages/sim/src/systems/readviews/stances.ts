import type { ContentSet } from '@open-northland/data';
import {
  computerModuleRuns,
  hasMissionBehaviour,
  isMachinePlayer,
  MISSION_BEHAVIOUR,
  Person,
  Settler,
  Stance,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isFighterJob } from './jobs.js';
import { monsterRulesOf } from './tribes/monsters.js';

/**
 * The ids are verbatim from `logicdefines.inc` `MILITARY_MODE_{NONE, ATTACK, DEFEND, IGNORE, FLEE}`. The
 * radii and leashes live with the combat engagement (`conflict/engagement.ts`).
 *
 *  - NONE: no assigned mode, treated as IGNORE so a stray value never becomes an aggressor.
 *  - ATTACK: look for an enemy around the unit, walk up to it and fight.
 *  - DEFEND: look for an enemy around the anchor, fight it until it strays too far from the anchor, then
 *    walk back.
 *  - IGNORE: never walk to a fight. A fighter strikes an enemy that stands inside its weapon's reach and
 *    lets it go once it strays too far from the anchor; a civilian never fights. An explicit attack order
 *    still works.
 *  - FLEE: accepted as a valid mode but given no behaviour of its own, so it acts as IGNORE. Original
 *    behavior: no one runs at the mere sight of an enemy; the runs come from blows alone.
 *
 * Whoever is not a fighter runs from a blow on itself or beside it under IGNORE and FLEE alike; only ATTACK
 * or DEFEND set on it keeps it standing (`conflict/flee.ts`).
 */
export const MILITARY_MODE = {
  NONE: 0,
  ATTACK: 1,
  DEFEND: 2,
  IGNORE: 3,
  FLEE: 4,
} as const;

export type MilitaryMode = (typeof MILITARY_MODE)[keyof typeof MILITARY_MODE];

/** The validity gate `setStance` uses to reject a bad mode as recoverable input. */
export function isMilitaryMode(mode: number): mode is MilitaryMode {
  return (
    mode === MILITARY_MODE.NONE ||
    mode === MILITARY_MODE.ATTACK ||
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    mode === MILITARY_MODE.FLEE
  );
}

/**
 * The stance stamped on an owned settler at spawn and on a profession change, until `setStance` overrides
 * it. Original behavior: every human starts in DEFEND, except a weresnake or werewolf fighter, which
 * starts in ATTACK unless its map gives it {@link MISSION_BEHAVIOUR.SPAWNS_DEFENDING}. Which monsters
 * start in ATTACK is content: a person whose tribe's monster rules say `startsInAttack`. Approximation:
 * everyone who is not a fighter starts in IGNORE, the mode under which this build's civilian keeps working
 * beside an enemy, runs only from a blow, and a scout or hunter keeps its own drives.
 */
export function defaultStance(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  if (!isFighterJob(content, jobType)) return MILITARY_MODE.IGNORE;
  const tribe = world.tryGet(e, Settler)?.tribe;
  const attacks =
    tribe !== undefined && world.has(e, Person) && monsterRulesOf(content, tribe)?.startsInAttack === true;
  if (!attacks) return MILITARY_MODE.DEFEND;
  return hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.SPAWNS_DEFENDING)
    ? MILITARY_MODE.DEFEND
    : MILITARY_MODE.ATTACK;
}

/** Whether `player` is a machine seat whose soldiers the computer player does not command: a map AI camp
 *  or a seat the map closed. */
export function seatLeftToMapAi(world: World, player: number): boolean {
  return isMachinePlayer(world, player) && !computerModuleRuns(world, player, 'military');
}

/** Whether `player`'s civilians strike back at an unarmed raider rather than run from its blow: a seat
 *  whose soldiers the computer player commands. A human seat and one left to map AI run, as the original's
 *  civilians do. Deviation of the computer player's own. */
export function seatStrikesBackUnarmed(world: World, player: number): boolean {
  return computerModuleRuns(world, player, 'military');
}

/**
 * The mode a combatant acts under, falling back to the default stance when the component is missing. `NONE`
 * normalizes to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes an aggressor, and
 * `FLEE` to it too, having no behaviour of its own.
 */
export function stanceMode(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStance(world, content, e, jobType) : s.mode;
  return mode === MILITARY_MODE.NONE || mode === MILITARY_MODE.FLEE ? MILITARY_MODE.IGNORE : mode;
}

/**
 * Whether a unit under `mode` keeps an anchor in its {@link Stance}: the DEFEND or IGNORE leash anchor, or
 * the place an ATTACK fighter walks back to once nothing is left to fight. Original behavior: one point,
 * the soldier's work centre, serves all three, and a move order or an attack order moves it.
 */
export function keepsAnchor(content: ContentSet, mode: MilitaryMode, jobType: number | null): boolean {
  return (
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    (mode === MILITARY_MODE.ATTACK && isFighterJob(content, jobType))
  );
}

/** Whether a unit under `mode` goes looking for a fight: ATTACK and DEFEND do. IGNORE at most strikes what
 *  comes into a fighter's reach. */
export function stanceFights(mode: MilitaryMode): boolean {
  return mode === MILITARY_MODE.ATTACK || mode === MILITARY_MODE.DEFEND;
}
