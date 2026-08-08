import { Stance } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { entityNode, manhattan } from '../../spatial/nodes.js';
import type { WeaponMix } from './census.js';
import { spokenFor } from './errand.js';

// Where the army gathers and when it leaves. The autonomous HAI exposes only `HAI_DisableMilitary`, so
// every size and radius here is an approximation.

/** How close to the barracks door (Manhattan half-cell nodes) counts as formed up; an idle fighter
 *  outside this ring is called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** The smallest group the seat will send: a wave is a band of men, never one. */
export const WAVE_MIN_SOLDIERS = 5;

/** The group that marches on any draw - the top of the band a wave grows to. `P(march) = (strength + 1) /
 *  band` per decision, where `strength` is the group's size over {@link WAVE_MIN_SOLDIERS}, so the size and
 *  the moment of a wave both vary per game while a full band always leaves. */
export const WAVE_FULL_SOLDIERS = 50;

/** A wave never marches as a pure shooting line: at least this many of it fight in reach, so the archers
 *  have somebody standing in front of them. */
const WAVE_MELEE_CORE = 1;

/** The melee floor to hold `army` to - {@link WAVE_MELEE_CORE}, waived when the whole army fights at
 *  range, since holding out for a front rank the seat cannot raise would bench it for good. */
export function meleeCoreFor(army: WeaponMix): number {
  return army.melee > 0 ? WAVE_MELEE_CORE : 0;
}

/** The seat's free fighters, split by what this decision can do with them. A man who cannot walk to the
 *  objective at all falls in with {@link Muster.homing}, where the recall tests reachability again. */
export interface Muster {
  /** Standing at the rally: the body the launch is rolled over, and the body that leaves on a win. */
  readonly formed: readonly Entity[];
  /** Nearer the objective than home already, so calling them in would walk them back over the distance
   *  they just covered. In practice the survivors of a wave whose target fell. */
  readonly forward: readonly Entity[];
  /** Everyone else: called in, and rolled over with the wave after this one. */
  readonly homing: readonly Entity[];
}

export function musterAround(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  home: NodeId,
  objective: NodeId,
): Muster {
  const formed: Entity[] = [];
  const forward: Entity[] = [];
  const homing: Entity[] = [];
  const reachable = terrain.componentOf(objective);
  for (const e of units) {
    const at = entityNode(world, terrain, e);
    const toHome = manhattan(terrain, at, home);
    if (terrain.componentOf(at) !== reachable) homing.push(e);
    else if (toHome <= RALLY_HOLD_RADIUS_NODES) formed.push(e);
    else if (manhattan(terrain, at, objective) < toHome) forward.push(e);
    else homing.push(e);
  }
  return { formed, forward, homing };
}

/** Whether `mix` is a body the seat would send at all: big enough to be a wave and mixed enough to have a
 *  front rank. */
export function waveWorthy(mix: WeaponMix, meleeCore: number): boolean {
  return mix.total >= WAVE_MIN_SOLDIERS && mix.melee >= meleeCore;
}

/** Whether the gathered `mix` marches this decision: a band that also wins its roll. */
export function waveReady(ctx: SystemContext, mix: WeaponMix, meleeCore: number): boolean {
  if (!waveWorthy(mix, meleeCore)) return false;
  return ctx.rng.int(WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1) <= mix.total - WAVE_MIN_SOLDIERS;
}

/** March `units` on `target`: the ATTACK stance (so they engage what they meet on the road and keep
 *  fighting once the objective falls) and the focus that carries them to it regardless of sight. */
export function marchOrders(world: World, units: readonly Entity[], target: Entity): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of units) {
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackUnit', entity: e, target });
  }
  return commands;
}

/**
 * Gather `units` at the seat's own door, each on his own spot ({@link holdSpot}), on the fighter default
 * ATTACK. This door is the army's only rally: waiting short of the objective instead puts the band inside
 * its fire.
 *
 * The walk is an attack-move because a plain move order benches the engage rung for its whole length
 * (`conflict/engage-combatant.ts`, `suppressedByMoveOrder`), leaving every man called in across contested
 * ground a free target. Skipped for a man already spoken for, and for ground the door cannot be walked to,
 * which would be re-ordered every decision.
 */
export function gatherAt(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  home: NodeId,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const reachable = terrain.componentOf(home);
  for (const e of units) {
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    const restance: PlayerCommand[] =
      world.tryGet(e, Stance)?.mode === MILITARY_MODE.ATTACK
        ? []
        : [{ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK }];
    if (formedUpAt(world, terrain, e, home)) {
      commands.push(...restance);
      continue;
    }
    if (spokenFor(world, e)) continue;
    const { x, y } = terrain.coordsOf(holdSpot(terrain, home, e, reachable));
    commands.push(...restance, { kind: 'attackMoveUnit', entity: e, x, y });
  }
  return commands;
}

/** The man's own standing place in the hold ring, keyed off his entity id so it never moves under him:
 *  one shared goal would walk the whole wave onto a single node. */
function holdSpot(terrain: TerrainGraph, rally: NodeId, e: Entity, reachable: number): NodeId {
  const spot = HOLD_SPOTS[e % HOLD_SPOTS.length];
  if (spot === undefined) return rally;
  const node = terrain.nodeAtClamped(terrain.xOf(rally) + spot.dx, terrain.yOf(rally) + spot.dy);
  return terrain.componentOf(node) === reachable ? node : rally;
}

/** Offsets filling the hold ring outward, one cell (two nodes) apart, stopping a cell short of the rim:
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

function formedUpAt(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId): boolean {
  return manhattan(terrain, entityNode(world, terrain, e), rally) <= RALLY_HOLD_RADIUS_NODES;
}
