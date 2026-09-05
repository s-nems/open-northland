import { Stance } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import type { WeaponMix } from './census.js';
import { spokenFor } from './errand.js';

// Where the army gathers. The autonomous HAI exposes only `HAI_DisableMilitary`, so
// every size and radius here is an approximation.

/** How close to the barracks door (Manhattan half-cell nodes) counts as formed up; an idle fighter
 *  outside this ring is called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** How far (Manhattan half-cell nodes) from its objective a wave spreads out, and how near it has to stand
 *  before it is closing rather than marching. Wide enough to hold a full wave a few men to a spot, and well
 *  inside the sight radius its men acquire the house from. Approximation. */
export const ASSAULT_RING_RADIUS_NODES = 12;

/** The smallest group the seat will send: a wave is a band of men, never one. */
export const WAVE_MIN_SOLDIERS = 5;

/** The largest group the seat gathers before it marches - the top of the band a wave's size is drawn
 *  from. */
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
  /** Standing at the rally: the body the wave is measured against, and the body that marches. */
  readonly formed: readonly Entity[];
  /** Nearer the objective than home already, so calling them in would walk them back over the distance
   *  they just covered. In practice the survivors of a wave whose target fell. */
  readonly forward: readonly Entity[];
  /** Everyone else: called in, and counted with the wave after this one. */
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

/**
 * March `units` on `objective`: the ATTACK stance, and an attack-move onto each man's own spot in the ring
 * around it. An attack-move rather than a focus on the objective, because a focus resolves ahead of the
 * sight search (`conflict/engagement.ts`, `resolveTarget`) and walks the wave past everything between its
 * own door and the house. A man already standing in the ring is left to fight, not re-ordered onto a spot
 * he has reached.
 */
export function marchOrders(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  objective: NodeId,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const reachable = terrain.componentOf(objective);
  for (const e of units) {
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    const at = entityNode(world, terrain, e);
    if (manhattan(terrain, at, objective) <= ASSAULT_RING_RADIUS_NODES) continue;
    const { x, y } = terrain.coordsOf(ringSpot(terrain, objective, ASSAULT_SPOTS, e, reachable));
    commands.push({ kind: 'attackMoveUnit', entity: e, x, y });
  }
  return commands;
}

/**
 * Gather `units` at the seat's own door, each on his own spot in the hold ring, on the fighter default
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
    const { x, y } = terrain.coordsOf(ringSpot(terrain, home, HOLD_SPOTS, e, reachable));
    commands.push(...restance, { kind: 'attackMoveUnit', entity: e, x, y });
  }
  return commands;
}

/** The man's own standing place in the ring around `centre`, keyed off his entity id so it never moves
 *  under him: one shared goal would walk the whole band onto a single node. */
function ringSpot(
  terrain: TerrainGraph,
  centre: NodeId,
  spots: readonly RingOffset[],
  e: Entity,
  reachable: number,
): NodeId {
  const spot = spots[e % spots.length];
  if (spot === undefined) return centre;
  const node = terrain.nodeAtClamped(terrain.xOf(centre) + spot.dx, terrain.yOf(centre) + spot.dy);
  return terrain.componentOf(node) === reachable ? node : centre;
}

interface RingOffset {
  readonly dx: number;
  readonly dy: number;
}

/** Offsets filling a ring of `radius` outward, one cell (two nodes) apart, stopping a cell short of the
 *  rim: a spot on the rim itself drops its man out of the band the moment a neighbour jostles him a node.
 *  More men than spots simply share a spot. */
function ringSpots(radius: number): readonly RingOffset[] {
  const spots: RingOffset[] = [];
  for (let r = 0; r + 2 <= radius; r += 2) {
    for (let dy = -r; dy <= r; dy += 2) {
      const dx = r - Math.abs(dy);
      spots.push({ dx, dy });
      if (dx !== 0) spots.push({ dx: -dx, dy });
    }
  }
  return spots;
}

const HOLD_SPOTS = ringSpots(RALLY_HOLD_RADIUS_NODES);
const ASSAULT_SPOTS = ringSpots(ASSAULT_RING_RADIUS_NODES);

function formedUpAt(world: World, terrain: TerrainGraph, e: Entity, rally: NodeId): boolean {
  return manhattan(terrain, entityNode(world, terrain, e), rally) <= RALLY_HOLD_RADIUS_NODES;
}
