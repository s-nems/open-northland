import { Carrying, Equipment, MISSION_BEHAVIOUR, MissionBehaviour, Settler } from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { NEED_DRIVE_THRESHOLD } from '../lifecycle/needs/scale.js';

/**
 * How many ticks a human's step from one lattice node to the next takes, the original's per-step move
 * cost. Source basis (macOS `the original` symbols, `an original routine` and the
 * `an original routine` accumulator it feeds): a step starts when the walker leaves a node,
 * reads that node's `lmpr` roughness, and completes after exactly `cost` ticks, where
 *
 *   cost = 2 * roughness + 2 + (shoes ? 0 : 2) + (carrying a good ? 1 : 0) + (stamina <= 2000 ? 2 : 0)
 *   cost = cost * 2 when the script's slow bit is set, then cost - 2 when its fast bit is set
 *   cost = max(3, cost)
 *
 * The stamina gate is the need table's drive level: a settler still rested above it walks two ticks a
 * step faster than one due for sleep. The shoes term is boolean until the pair is spent. Terms the
 * engine adds for a speed amulet (-2), a baby (x2) or child (+2), a hero's exemption from gear, the
 * `(armor weight + weapon weight) >> 1` encumbrance of everyone else, and two tribe/job constants are
 * not modelled here; the sim's amulet, age and gear rules stay as they are.
 *
 * Deviation, bounded: the original also turns before a step that changes heading, one hex direction a
 * tick, and only a turn of two or more directions holds the accumulator (a k-direction turn adds k-1
 * ticks). Whether the straight N/S headings sit in that ring is a per-moveable flag whose writer is not
 * located (`an original routine` +0x50, zeroed at init), and this lattice's pathfinder does not reproduce the
 * original's corners, so no turn tick is charged: a route pays exactly its steps.
 */
export function walkStepTicks(roughness: number, m: WalkStepModifiers): number {
  let cost =
    ROUGHNESS_TICKS_PER_LEVEL * roughness +
    BASE_STEP_TICKS +
    (m.shoes ? 0 : BAREFOOT_STEP_TICKS) +
    (m.carrying ? CARRYING_STEP_TICKS : 0) +
    (m.tired ? TIRED_STEP_TICKS : 0);
  if (m.walksSlowly) cost *= SCRIPT_SLOW_FACTOR;
  if (m.walksFast) cost -= SCRIPT_FAST_TICKS;
  return cost < MIN_STEP_TICKS ? MIN_STEP_TICKS : cost;
}

/** The per-step state {@link walkStepTicks} paces by, read once when the step starts. */
export interface WalkStepModifiers {
  /** A live (unspent) pair of boots in the boots slot. */
  readonly shoes: boolean;
  /** Hauling a good. */
  readonly carrying: boolean;
  /** Fatigue at or past the drive level, the stamina the original tests against 2000. */
  readonly tired: boolean;
  readonly walksSlowly: boolean;
  readonly walksFast: boolean;
}

const ROUGHNESS_TICKS_PER_LEVEL = 2;
const BASE_STEP_TICKS = 2;
const BAREFOOT_STEP_TICKS = 2;
const CARRYING_STEP_TICKS = 1;
const TIRED_STEP_TICKS = 2;
const SCRIPT_SLOW_FACTOR = 2;
const SCRIPT_FAST_TICKS = 2;
/** The engine's floor on any step cost. */
export const MIN_STEP_TICKS = 3;

/** The highest roughness the owned corpus writes (`lmpr` snow). */
const ROUGHNESS_MAX_ON_MAPS = 5;

/** The longest step an ordinary human takes: barefoot, laden, due for sleep, script-slowed, off snow. */
export const MAX_STEP_TICKS = walkStepTicks(ROUGHNESS_MAX_ON_MAPS, {
  shoes: false,
  carrying: true,
  tired: true,
  walksSlowly: true,
  walksFast: false,
});

/** The modifiers of an ordinary walker with nothing on: the one every test map's default step reads. */
export const UNMODIFIED_STEP: WalkStepModifiers = {
  shoes: false,
  carrying: false,
  tired: false,
  walksSlowly: false,
  walksFast: false,
};

/** Whether `e` wears a live pair of boots: a boots slot holding a good not yet worn to ONE. The original's
 *  `HasEquippedShoes` reads the same two facts, a shoe type set and a condition above zero. */
export function hasLiveBoots(world: World, e: Entity): boolean {
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  return boots !== null && boots.degreeOfUse < ONE;
}

/** Whether `e` hauls a good, the original's carried-good-type field being non-zero. */
export function isCarryingGood(world: World, e: Entity): boolean {
  return world.has(e, Carrying);
}

/** Read `e`'s step modifiers for the step about to start. */
export function walkStepModifiersOf(world: World, e: Entity): WalkStepModifiers {
  const flags = world.tryGet(e, MissionBehaviour)?.flags ?? 0;
  const fatigue = world.tryGet(e, Settler)?.fatigue;
  return {
    shoes: hasLiveBoots(world, e),
    carrying: isCarryingGood(world, e),
    tired: fatigue !== undefined && fatigue >= NEED_DRIVE_THRESHOLD,
    walksSlowly: (flags & MISSION_BEHAVIOUR.WALKS_SLOWLY) !== 0,
    walksFast: (flags & MISSION_BEHAVIOUR.WALKS_FAST) !== 0,
  };
}
