import { MoveGoal, PlayerOrder, Stance } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { ContentContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { isTravelling } from '../../movement/nav-state.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import type { WeaponMix } from './census.js';
import { spokenFor } from './errand.js';

// Where the army gathers. The autonomous HAI exposes only `HAI_DisableMilitary`, so
// every size and radius here is an approximation.

/** How close to the barracks door (Manhattan half-cell nodes) counts as formed up for a band small enough
 *  to stand inside it; a larger band widens the ring ({@link rallyAt}). An idle fighter outside the ring is
 *  called in. */
export const RALLY_HOLD_RADIUS_NODES = 6;

/** How far past its outermost standing place the hold ring reaches: one cell, so a man the idle de-stack
 *  steps off his place to the next free node still counts as formed up and is not called in again. */
const RALLY_HOLD_SLACK_NODES = 2;

/** Nodes the rally's search may visit per man it places. Standing places sit one per visual cell, a
 *  quarter of the nodes, so this leaves room for ground the barracks and its neighbours block. */
const RALLY_SEARCH_NODES_PER_MAN = 16;

/** How far (Manhattan half-cell nodes) from its objective a wave spreads out, and how near it has to stand
 *  before it is closing rather than marching. Wide enough to hold a full wave a few men to a spot, and well
 *  inside the sight radius its men acquire the house from. Approximation. */
export const ASSAULT_RING_RADIUS_NODES = 12;

/** The smallest group the seat will send: a wave is a band of men, never one. */
export const WAVE_MIN_SOLDIERS = 5;

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
  rally: Rally,
  objective: NodeId,
): Muster {
  const home = rally.door;
  const formed: Entity[] = [];
  const forward: Entity[] = [];
  const homing: Entity[] = [];
  const reachable = terrain.componentOf(objective);
  for (const e of units) {
    const at = entityNode(world, terrain, e);
    const toHome = manhattan(terrain, at, home);
    if (terrain.componentOf(at) !== reachable) homing.push(e);
    else if (toHome <= rally.holdRadius) formed.push(e);
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

/** One decision's rally at a barracks door: how near counts as formed up, and where a man called in
 *  stands. */
export interface Rally {
  readonly door: NodeId;
  /** Manhattan half-cell nodes from the door. */
  readonly holdRadius: number;
  /** The standing places no man of the band stands on or walks to, nearest walk from the door first. */
  readonly free: readonly NodeId[];
}

/**
 * The rally for `band` at `door`: one standing place per man, on the cell-centre nodes nearest the door by
 * walk over open, unblocked ground (one visual cell apart, the door node itself left clear for the
 * barracks' own traffic), and a hold ring reaching {@link RALLY_HOLD_SLACK_NODES} past the farthest place.
 * Sizing the ring from the band keeps every man the rally places inside it; a fixed ring filled past its
 * capacity pushes its last men out of it, and the next decision calls them in again. Approximation: the
 * original's rally shape is unobserved.
 */
export function rallyAt(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  door: NodeId,
  band: readonly Entity[],
): Rally {
  const size = band.length;
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const spots: NodeId[] = [];
  let holdRadius = RALLY_HOLD_RADIUS_NODES;
  // A breadth-first walk one ring at a time over one queue, the ring `[from, to)`, marking nodes in the
  // terrain's reused visit stamps.
  const scratch = rallyScratchOf(terrain);
  const { queue, neighbours } = scratch;
  const pass = nextRallyPass(scratch);
  scratch.seen[door] = pass;
  queue[0] = door;
  let from = 0;
  let to = 1;
  let budget = size * RALLY_SEARCH_NODES_PER_MAN;
  while (spots.length < size && to > from && budget > 0) {
    let queued = to;
    for (let i = from; i < to; i++) {
      const count = terrain.walkableNeighboursInto(queue[i] as NodeId, neighbours);
      for (let k = 0; k < count; k++) {
        const n = neighbours[k] as NodeId;
        if (scratch.seen[n] === pass || blocked.has(n)) continue;
        scratch.seen[n] = pass;
        budget--;
        queue[queued++] = n;
        if (spots.length >= size || !isCellCentre(terrain, n)) continue;
        spots.push(n);
        holdRadius = Math.max(holdRadius, manhattan(terrain, n, door) + RALLY_HOLD_SLACK_NODES);
      }
    }
    from = to;
    to = queued;
  }
  const taken = takenPlaces(world, terrain, band);
  return { door, holdRadius, free: spots.filter((spot) => !taken.has(spot)) };
}

/** Whether `node` is a visual cell's centre, `(2cx + (cy & 1), 2cy)` on the half-cell lattice. */
function isCellCentre(terrain: TerrainGraph, node: NodeId): boolean {
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  return (y & 1) === 0 && ((x - ((y >> 1) & 1)) & 1) === 0;
}

/** The rally walk's reusable storage per terrain: visit stamps valid while equal to the pass, the queue,
 *  and one node's neighbours. */
interface RallyScratch {
  readonly seen: Int32Array;
  pass: number;
  readonly queue: NodeId[];
  readonly neighbours: NodeId[];
}

const rallyScratches = new WeakMap<TerrainGraph, RallyScratch>();

function rallyScratchOf(terrain: TerrainGraph): RallyScratch {
  let scratch = rallyScratches.get(terrain);
  if (scratch === undefined) {
    scratch = { seen: new Int32Array(terrain.nodeCount), pass: 0, queue: [], neighbours: [] };
    rallyScratches.set(terrain, scratch);
  }
  return scratch;
}

/** Int32 stamp ceiling; on the wrap the stamps are cleared so no stale slot matches a reused pass. */
const MAX_RALLY_PASS = 2 ** 31 - 1;

function nextRallyPass(scratch: RallyScratch): number {
  if (scratch.pass >= MAX_RALLY_PASS) {
    scratch.seen.fill(0);
    scratch.pass = 0;
  }
  scratch.pass += 1;
  return scratch.pass;
}

/**
 * Gather `units` at the seat's own door, each man called in onto a free standing place of the rally, on the
 * fighter default ATTACK. This door is the army's only rally: waiting short of the objective instead puts
 * the band inside its fire.
 *
 * The walk is an attack-move because a plain move order benches the engage rung for its whole length
 * (`conflict/engage-combatant.ts`, `suppressedByMoveOrder`), leaving every man called in across contested
 * ground a free target. Skipped for a man already spoken for, and for ground the door cannot be walked to,
 * which would be re-ordered every decision. A man the rally has no free place for waits where he is.
 */
export function gatherAt(
  world: World,
  terrain: TerrainGraph,
  units: readonly Entity[],
  rally: Rally,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const reachable = terrain.componentOf(rally.door);
  let placed = 0;
  for (const e of units) {
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    const restance: PlayerCommand[] =
      world.tryGet(e, Stance)?.mode === MILITARY_MODE.ATTACK
        ? []
        : [{ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK }];
    if (formedUpAt(world, terrain, e, rally)) {
      commands.push(...restance);
      continue;
    }
    if (spokenFor(world, e)) continue;
    const spot = rally.free[placed++];
    if (spot === undefined) continue;
    const { x, y } = terrain.coordsOf(spot);
    commands.push(...restance, { kind: 'attackMoveUnit', entity: e, x, y });
  }
  return commands;
}

/** The nodes the band holds already: where its men are headed, and where the rest stand. An ordered walk
 *  holds its goal while a fight or a load set down interrupts it, since the man walks on once it ends. */
function takenPlaces(world: World, terrain: TerrainGraph, band: readonly Entity[]): Set<NodeId> {
  const taken = new Set<NodeId>();
  for (const e of band) {
    const order = world.tryGet(e, PlayerOrder);
    const headedFor =
      order?.attackMove?.goal ??
      order?.pendingGoal ??
      (isTravelling(world, e) ? world.tryGet(e, MoveGoal)?.cell : undefined);
    taken.add(headedFor ?? entityNode(world, terrain, e));
  }
  return taken;
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

const ASSAULT_SPOTS = ringSpots(ASSAULT_RING_RADIUS_NODES);

export function formedUpAt(world: World, terrain: TerrainGraph, e: Entity, rally: Rally): boolean {
  return manhattan(terrain, entityNode(world, terrain, e), rally.door) <= rally.holdRadius;
}
