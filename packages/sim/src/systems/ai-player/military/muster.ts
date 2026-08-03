import { CurrentAtomic, EquipOrder, Stance, TrainingOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE, type MilitaryMode } from '../../readviews/index.js';
import { anotherSystemOwns } from '../../settlers/planner/replan.js';
import { entityNode, isTravelling, manhattan } from '../../spatial/nodes.js';
import type { WeaponMix } from './census.js';

// Where the army gathers and when it leaves. Every constant here is a named approximation: the original
// exposes one `HAI_DisableMilitary` toggle and no readable army plan, so the sizes and radii are genre
// convention.

/** How close to a gathering point (Manhattan half-cell nodes) counts as formed up; an idle fighter
 *  outside this ring is called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** The smallest group the seat will send (user rule: a wave is a band of men, never one). */
export const WAVE_MIN_SOLDIERS = 5;

/** The group that marches on any draw - the top of the wave band (user rule: somewhere between
 *  {@link WAVE_MIN_SOLDIERS} and this many). `P(march) = (strength + 1) / band` per decision, where
 *  `strength` is the group's size over the minimum, so both the size and the moment of a wave vary per
 *  game while a full band always leaves. */
export const WAVE_FULL_SOLDIERS = 50;

/** A wave never marches as a pure shooting line: at least this many of it fight in reach, so the archers
 *  have somebody standing in front of them. */
export const WAVE_MELEE_CORE = 1;

/** The longest `maximumrange` any base weapon row carries (`house bow`; the catapult's 24 and the long
 *  bow's 23 come next). Half-cell nodes, the metric the reach checks already use. */
const LONGEST_REACH_NODES = 29;

/** How far short of the objective a wave forms up before it charges (user rule): far enough to put the
 *  whole hold ring, not just its centre, PAST that reach (`dist <= maxRange` is in reach). No building
 *  shoots yet (docs/tickets/features/tower-defence-mode.md), so today it only keeps the muster out of
 *  the town. */
export const STAGING_STANDOFF_NODES = LONGEST_REACH_NODES + RALLY_HOLD_RADIUS_NODES + 1;

/** The melee floor to hold `army` to - {@link WAVE_MELEE_CORE}, waived when the whole army fights at
 *  range, since holding out for a front rank the seat cannot raise would bench it for good. */
export function meleeCoreFor(army: WeaponMix): number {
  return army.melee > 0 ? WAVE_MELEE_CORE : 0;
}

/** An army sorted around one charge point. */
export interface Muster {
  /** Standing on the point. */
  readonly formed: readonly Entity[];
  /** Closer to the point than to home, so committed forward - never recalled by a lost roll, which is
   *  what keeps an arrival just outside the hold ring from being walked home and straight out again. */
  readonly closing: readonly Entity[];
  /** Still behind, waiting on the departure roll. */
  readonly waiting: readonly Entity[];
}

export function musterAround(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  charge: NodeId,
  home: NodeId,
): Muster {
  const formed: Entity[] = [];
  const closing: Entity[] = [];
  const waiting: Entity[] = [];
  for (const e of units) {
    const at = entityNode(world, terrain, e);
    const toCharge = manhattan(terrain, at, charge);
    if (toCharge <= RALLY_HOLD_RADIUS_NODES) formed.push(e);
    else if (toCharge < manhattan(terrain, at, home)) closing.push(e);
    else waiting.push(e);
  }
  return { formed, closing, waiting };
}

/** Whether the gathered `mix` marches this decision - a strong enough, mixed enough group that wins its
 *  roll. */
export function waveReady(ctx: SystemContext, mix: WeaponMix, meleeCore: number): boolean {
  if (mix.melee < meleeCore) return false;
  const strength = mix.total - WAVE_MIN_SOLDIERS;
  return strength >= 0 && ctx.rng.int(WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1) <= strength;
}

/**
 * Where a wave forms up before it charges `objective`: the point {@link STAGING_STANDOFF_NODES} back along
 * the straight line to `home`, on ground connected to it. Null when the objective stands closer to the
 * barracks than the standoff - the fight is at the door, and there is nothing left to stage behind.
 */
export function stagingNode(terrain: TerrainGraph, home: NodeId, objective: NodeId): NodeId | null {
  const span = manhattan(terrain, home, objective);
  if (span <= STAGING_STANDOFF_NODES) return null;
  const component = terrain.componentOf(home);
  const ox = terrain.xOf(objective);
  const oy = terrain.yOf(objective);
  const dx = terrain.xOf(home) - ox;
  const dy = terrain.yOf(home) - oy;
  // Keep stepping back toward home while the line lands on water or another island (label -1 / another
  // component): a standoff nobody can walk to would bench the wave.
  // Bounded probe rather than one proportional to the map: past it the wave forms up at the barracks.
  const stop = Math.min(span, 2 * STAGING_STANDOFF_NODES);
  for (let back = STAGING_STANDOFF_NODES; back < stop; back++) {
    const node = terrain.nodeAtClamped(
      ox + Math.trunc((dx * back) / span),
      oy + Math.trunc((dy * back) / span),
    );
    if (terrain.componentOf(node) === component) return node;
  }
  return null;
}

/** March `units` on `target`: the ATTACK stance (so they engage what they meet on the road and keep
 *  fighting once the objective falls) and the focus that carries them to it regardless of sight. */
export function marchOrders(world: World, units: readonly Entity[], target: Entity): Command[] {
  const commands: Command[] = [];
  for (const e of units) {
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackUnit', entity: e, target });
  }
  return commands;
}

/**
 * Gather `units` at `rally`, each on his own spot ({@link holdSpot}), in the stance they wait in.
 *
 * `hold` is what keeps a band a band: an idle ATTACK fighter auto-acquires anything hostile in sight
 * (`conflict/engagement.ts`), so a group waiting in the enemy's town would each walk off at a different
 * house, and an engaged man leaves the census - the muster could never fill. At home the army waits on
 * ATTACK instead, so it meets whatever comes to the door.
 *
 * Skipped for a fighter another drive owns, one mid-errand, and one on ground the point cannot be walked
 * to: `moveUnit` would cancel the errand, and an unreachable point would be re-ordered every decision.
 */
export function gatherAt(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  rally: NodeId,
  hold: MilitaryMode,
): Command[] {
  const commands: Command[] = [];
  const reachable = terrain.componentOf(rally);
  for (const e of units) {
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    const restance: Command[] = waitsIn(world, terrain, e, rally, hold)
      ? []
      : [{ kind: 'setStance', entity: e, mode: hold }];
    if (formedUpAt(world, terrain, e, rally)) {
      commands.push(...restance); // in place: the anchor the stance captures IS the rally
      continue;
    }
    // A man this drive will not move keeps the stance he has. Flipping it alone would anchor a DEFEND
    // post wherever the road happened to leave him, and drop a walker to ATTACK mid-march - where he
    // auto-acquires, engages, and leaves the census for good.
    if (anotherSystemOwns(world, e) || isBusy(world, e)) continue;
    // Stance BEFORE the walk: `moveUnit` re-anchors a DEFEND unit onto its goal (`orders/movement.ts`),
    // which is how each man ends up holding his own spot. Commands apply in the order enqueued.
    const { x, y } = terrain.coordsOf(holdSpot(terrain, rally, e, reachable));
    commands.push(...restance, { kind: 'moveUnit', entity: e, x, y });
  }
  return commands;
}

/** The man's OWN standing place in the hold ring, keyed off his entity id so it never moves under him.
 *  A DEFEND unit walks back onto its anchor when nothing is in radius (`conflict/chase.ts`) and the idle
 *  spacing rung sits below the stance, so one shared goal would pile the whole wave on a single node. */
function holdSpot(terrain: TerrainGraph, rally: NodeId, e: Entity, reachable: number): NodeId {
  const spot = HOLD_SPOTS[e % HOLD_SPOTS.length];
  if (spot === undefined) return rally;
  const node = terrain.nodeAtClamped(terrain.xOf(rally) + spot.dx, terrain.yOf(rally) + spot.dy);
  return terrain.componentOf(node) === reachable ? node : rally;
}

/** Offsets filling the hold ring outward, one cell (two nodes) apart, stopping a cell SHORT of the rim:
 *  a spot on the rim itself drops its man out of the band the moment a neighbour jostles him a node, and
 *  a man outside the ring is not formed up. More men than spots simply share a spot. */
const HOLD_SPOTS: readonly { dx: number; dy: number }[] = (() => {
  const spots: { dx: number; dy: number }[] = [];
  for (let r = 0; r + 2 <= RALLY_HOLD_RADIUS_NODES; r += 2) {
    for (let dy = -r; dy <= r; dy += 2) {
      const dx = r - Math.abs(dy);
      spots.push({ dx, dy });
      if (dx !== 0) spots.push({ dx: -dx, dy });
    }
  }
  return spots;
})();

/** Whether `e` already waits the way {@link gatherAt} wants: the right mode, and - once he stands on the
 *  rally - a DEFEND anchor on it rather than the one he set out from. */
function waitsIn(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId, hold: MilitaryMode): boolean {
  const stance = world.tryGet(e, Stance);
  if (stance?.mode !== hold) return false;
  if (hold !== MILITARY_MODE.DEFEND || !formedUpAt(world, terrain, e, rally)) return true;
  const anchor = stance.anchorCell;
  return anchor !== null && manhattan(terrain, anchor, rally) <= RALLY_HOLD_RADIUS_NODES;
}

function formedUpAt(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId): boolean {
  return manhattan(terrain, entityNode(world, terrain, e), rally) <= RALLY_HOLD_RADIUS_NODES;
}

/** Errands a recall would silently throw away: `moveUnit` strips the drill and equip orders and cancels
 *  a running action, and a fighter already walking is on his way somewhere for a reason. */
function isBusy(world: World, e: Entity): boolean {
  return (
    world.has(e, TrainingOrder) ||
    world.has(e, EquipOrder) ||
    world.has(e, CurrentAtomic) ||
    isTravelling(world, e)
  );
}
