import type { VehicleType } from '@open-northland/data';
import type { AiOrderOrigin } from '../../components/ai/order.js';
import { dropVehicleOrderQueue, Vehicle, vehicleCommander } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { MAX_CLEARANCE_CLASS } from '../../nav/clearance.js';
import {
  type HalfCellNode,
  hexagonRing,
  hexDistanceBetween,
  hexRingHx,
  hexRingHy,
  hexRingLength,
} from '../../nav/halfcell.js';
import {
  NO_COMPONENT,
  NO_READMITTED,
  type NodeId,
  StepGate,
  type TerrainGraph,
} from '../../nav/terrain/index.js';
import type { ContentContext, SystemContext } from '../context.js';
import { vehicleAnchor } from '../footprint/index.js';
import { vehicleClearance } from '../footprint/vehicle-clearance.js';
import { recordAiOrder } from '../orders/ai-lifecycle.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { pinnedTraderAshore, turnToVehicle } from './crew.js';
import {
  crewInside,
  dropHeldGoal,
  endDrive,
  moorVehicle,
  refuseMove,
  startVehicleDrive,
  vehicleGroundBlocks,
  vehicleRouteTo,
  vehicleWalkBlocks,
} from './movement.js';
import { type SeaRegions, seaRegions } from './sea-regions.js';

// The dock order of docs/formats/VEHICLES.md "Ships and docking": a commanded ship boards its crew,
// scans the hexagon ring of its door distance around the clicked shore point for a node of its own
// water body it may lie at, sails there under the `docks` task with the click stored as its mooring
// point, and moors on arrival (`movement.ts`). No port building is involved.

/**
 * The nodes a ship may dock at for `point`, in the original's ring order: the map points at exactly
 * the door distance from the point that lie in a part of the sea the ship can sail into, however far
 * (deviation: the original holds the dock to the goto's walk range), and are open under its walk-block,
 * which is the free-size class test plus the other vehicles' cells. The ship's own node qualifies as an
 * in-place mooring.
 */
function dockCandidates(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  type: VehicleType,
  anchor: HalfCellNode,
  point: HalfCellNode,
): NodeId[] {
  const vector = type.passengerVector;
  if (vector === undefined) return [];
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  const reach = regions.regionsFrom(terrain.nodeAt(anchor.hx, anchor.hy));
  const blocked = vehicleWalkBlocks(world, ctx, terrain, vehicle, type);
  const out: NodeId[] = [];
  for (const { point: ring } of hexagonRing(point, vector.distance)) {
    if (!terrain.inBounds(ring.hx, ring.hy)) continue;
    const node = terrain.nodeAt(ring.hx, ring.hy);
    if (reach.includes(regions.regionOf(node)) && !blocked.has(node)) out.push(node);
  }
  return out;
}

/** The first dock node around `point`, `dock` tried first when it is one, that `sails` finds a route to;
 *  the ship's own node needs none. */
function firstDockNode(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  anchor: HalfCellNode,
  point: HalfCellNode,
  dock: HalfCellNode | null,
  sails: (node: NodeId) => boolean,
): NodeId | null {
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  if (type === undefined) return null;
  const here = terrain.nodeAt(anchor.hx, anchor.hy);
  // After one candidate finds no route, the water the ship can reach is flooded once and only the
  // candidates in it are searched, instead of a sea-wide search per ring node out of reach. Other ships
  // are no wall, as a route passes through them where it cannot go around.
  let reached: Uint8Array | undefined;
  const ring = dockCandidates(world, ctx, terrain, vehicle, type, anchor, point);
  const named = dock !== null && terrain.inBounds(dock.hx, dock.hy) ? terrain.nodeAt(dock.hx, dock.hy) : null;
  const candidates =
    named !== null && ring.includes(named) ? [named, ...ring.filter((n) => n !== named)] : ring;
  for (const node of candidates) {
    if (reached !== undefined && reached[node] !== REACHED) continue;
    if (node === here || sails(node)) return node;
    reached ??= reachableWater(terrain, vehicleGroundBlocks(world, ctx, terrain, vehicle, type), here);
  }
  return null;
}

/**
 * The nodes the dock order for `point` would sail `vehicle` through, the first next, judged now as
 * {@link startDock} judges it, or null when it finds no dock node it can reach: for a planner checking a
 * course before it gives the order. Empty for a ship already lying on a dock node. Costs a route search per
 * dock node tried.
 */
export function dockRoute(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  point: HalfCellNode,
): HalfCellNode[] | null {
  const anchor = vehicleAnchor(world, vehicle);
  if (anchor === null || !terrain.inBounds(anchor.hx, anchor.hy)) return null;
  let route: HalfCellNode[] | null = null;
  const node = firstDockNode(world, ctx, terrain, vehicle, anchor, point, null, (candidate) => {
    route = vehicleRouteTo(world, ctx, terrain, vehicle, candidate);
    return route !== null;
  });
  return node === null ? null : (route ?? []);
}

/**
 * Which of `points` `vehicle` can dock at through water `closed` never refuses: for each point, whether one
 * of its dock nodes ({@link dockCandidates}) joins the ship over the nodes it may sail, `closed` ones left
 * out (the ship's own node counts). For a planner weighing courses before it orders one. Costs a search
 * from the dock nodes towards the ship ({@link joinedWater}), the whole sea only when one is cut off in it.
 */
export function docksReachedThrough(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  points: readonly HalfCellNode[],
  closed: (node: NodeId) => boolean,
): boolean[] {
  const anchor = vehicleAnchor(world, vehicle);
  const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
  if (anchor === null || type === undefined || !terrain.inBounds(anchor.hx, anchor.hy))
    return points.map(() => false);
  const docks = points.map((point) => dockCandidates(world, ctx, terrain, vehicle, type, anchor, point));
  const here = terrain.nodeAt(anchor.hx, anchor.hy);
  const blocked = vehicleGroundBlocks(world, ctx, terrain, vehicle, type);
  const joined = joinedWater(terrain, blocked, here, closed, docks.flat());
  return docks.map((nodes) => nodes.some((node) => joined[node] === JOINED));
}

const JOINED = 1;
/** A node of water a search exhausted without meeting the ship's. */
const CUT_OFF = 2;
/** A node the search under way has found, not yet known to join the ship's water. */
const PENDING = 3;

/**
 * Which of `sought` a ship on `start` can sail to under `blocked` and `closed`, marked {@link JOINED}: what
 * {@link reachableWater} answers for them, the start counted as there. Each is searched from itself
 * towards the ship, the found node nearest the ship settled first, over edges that read the same both
 * ways, so one in open water settles a strip of sea and one sealed off settles its pocket; every node a
 * search found shares its verdict, which the next search stops at.
 */
function joinedWater(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  start: NodeId,
  closed: (node: NodeId) => boolean,
  sought: readonly NodeId[],
): Uint8Array {
  const marks = new Uint8Array(terrain.nodeCount);
  marks[start] = JOINED;
  const gate = new StepGate();
  terrain.resetGate(gate, 'water', blocked, NO_READMITTED);
  const lane = gate.lane;
  const width = terrain.width;
  const startX = terrain.xOf(start);
  const startY = terrain.yOf(start);
  const found = floodQueueOf(terrain);
  const heap = new NearestFirst();
  for (const from of sought) {
    if (marks[from] !== 0 || gate.closes(from) || closed(from)) continue;
    let count = 0;
    let verdict = 0;
    marks[from] = PENDING;
    found[count++] = from;
    heap.clear();
    heap.push(from, hexDistanceBetween(terrain.xOf(from), terrain.yOf(from), startX, startY));
    while (verdict === 0 && heap.size > 0) {
      const current = heap.pop();
      const open = lane[current] ?? 0;
      const offsets = terrain.stepOffsets(Math.floor(current / width));
      for (let edge = 0; edge < offsets.length; edge++) {
        if ((open & (1 << edge)) === 0) continue;
        const node = (current + (offsets[edge] ?? 0)) as NodeId;
        const mark = marks[node] ?? 0;
        if (mark === PENDING) continue;
        // The start is joined even when it closed under the ship; any other marked node is open water.
        if (mark !== 0) {
          verdict = mark;
          break;
        }
        if (gate.closes(node) || closed(node)) continue;
        marks[node] = PENDING;
        found[count++] = node;
        heap.push(node, hexDistanceBetween(terrain.xOf(node), terrain.yOf(node), startX, startY));
      }
    }
    if (verdict === 0) verdict = CUT_OFF;
    for (let i = 0; i < count; i++) marks[found[i] ?? 0] = verdict;
  }
  return marks;
}

/** A binary heap of nodes by their distance key, the nearest popped first; ties in any order, as
 *  {@link joinedWater}'s answer does not depend on the order it settles in. */
class NearestFirst {
  private readonly nodes: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  clear(): void {
    this.nodes.length = 0;
    this.keys.length = 0;
  }

  push(node: number, key: number): void {
    const { nodes, keys } = this;
    let at = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const parentKey = keys[parent] ?? 0;
      if (parentKey <= key) break;
      nodes[at] = nodes[parent] ?? 0;
      keys[at] = parentKey;
      at = parent;
    }
    nodes[at] = node;
    keys[at] = key;
  }

  /** The nearest node; the heap must not be empty. */
  pop(): number {
    const { nodes, keys } = this;
    const top = nodes[0] ?? 0;
    const node = nodes.pop() ?? 0;
    const key = keys.pop() ?? 0;
    const length = nodes.length;
    if (length === 0) return top;
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= length) break;
      if (child + 1 < length && (keys[child + 1] ?? 0) < (keys[child] ?? 0)) child++;
      const childKey = keys[child] ?? 0;
      if (childKey >= key) break;
      nodes[at] = nodes[child] ?? 0;
      keys[at] = childKey;
      at = child;
    }
    nodes[at] = node;
    keys[at] = key;
    return top;
  }
}

/**
 * Sail `vehicle`, its crew inside, to the first dock node around `point` it finds a route to, `dock`
 * tried first when it is one, and remember the point as the shore it moors at. False, with the `vehicleNoPath` note, when no ring
 * node takes it. Approximation: the original leaves a ship already standing on a ring node as it is;
 * here it moors in place, which is what the order asked for.
 */
export function startDock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  vehicle: Entity,
  point: HalfCellNode,
  dock: HalfCellNode | null = null,
): boolean {
  const anchor = vehicleAnchor(world, vehicle);
  if (anchor === null) return false;
  const here = terrain.nodeAt(anchor.hx, anchor.hy);
  const node = firstDockNode(world, ctx, terrain, vehicle, anchor, point, dock, (candidate) =>
    startVehicleDrive(world, ctx, terrain, vehicle, candidate),
  );
  if (node !== null) {
    if (node === here) endDrive(world, vehicle); // a goto under way ends here, moored
    dropHeldGoal(world, vehicle);
    const live = world.mut(vehicle, Vehicle);
    live.task = 'docks';
    live.mooring = { hx: point.hx, hy: point.hy };
    if (node === here) moorVehicle(world, ctx, vehicle);
    return true;
  }
  refuseMove(world, ctx, vehicle, 'noPath');
  dropHeldGoal(world, vehicle);
  const live = world.mut(vehicle, Vehicle);
  if (live.task === 'docks') live.task = 'none';
  return false;
}

const REACHED = 1;

/** The nodes a ship on `start` can sail to under `blocked`, marked {@link REACHED}; the start counts,
 *  as the pathfinder lets a vehicle leave a node that closed under it. */
function reachableWater(terrain: TerrainGraph, blocked: BlockOverlay, start: NodeId): Uint8Array {
  const reached = new Uint8Array(terrain.nodeCount);
  reached[start] = REACHED;
  // The pathfinder's own edges, walked off the step lane: a flood settles a whole sea.
  const gate = new StepGate();
  terrain.resetGate(gate, 'water', blocked, NO_READMITTED);
  const lane = gate.lane;
  const width = terrain.width;
  // Each node is marked, and so queued, once.
  const queue = floodQueueOf(terrain);
  let tail = 0;
  queue[tail++] = start;
  for (let head = 0; head < tail; head++) {
    const current = queue[head] ?? 0;
    const open = lane[current] ?? 0;
    const offsets = terrain.stepOffsets(Math.floor(current / width));
    for (let edge = 0; edge < offsets.length; edge++) {
      if ((open & (1 << edge)) === 0) continue;
      const node = (current + (offsets[edge] ?? 0)) as NodeId;
      if (reached[node] === REACHED || gate.closes(node)) continue;
      reached[node] = REACHED;
      queue[tail++] = node;
    }
  }
  return reached;
}

/** A flood's or search's list of the nodes it found, per terrain, read only within the one that fills it. */
const floodQueues = new WeakMap<TerrainGraph, Int32Array>();

function floodQueueOf(terrain: TerrainGraph): Int32Array {
  let queue = floodQueues.get(terrain);
  if (queue === undefined) {
    queue = new Int32Array(terrain.nodeCount);
    floodQueues.set(terrain, queue);
  }
  return queue;
}

/**
 * The dock order (`g`) - see the command doc. Refused with `vehicleNoCommander` while nobody commands
 * the ship; a pinned trader who can reach its ship commands it from ashore, its route judged at once as
 * a goto's is so it does not board for nothing. A crew still outside is boarded first: the point is held
 * under the `docks` task and the sail starts once everyone is inside (the original retries the order
 * behind the crew's boarding). Returns whether a dock drive or a held point now stands.
 */
export function dockVehicle(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'dockVehicle' }>,
  origin?: AiOrderOrigin,
): boolean {
  const terrain = ctx.terrain;
  if (terrain === undefined) return false;
  const e = command.vehicle;
  const state = world.tryGet(e, Vehicle);
  const anchor = vehicleAnchor(world, e);
  if (state === undefined || anchor === null || state.carrier !== null) return false;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  if (type === undefined || !isShipVehicle(type)) return false;
  dropVehicleOrderQueue(world, e);
  const trader = pinnedTraderAshore(world, ctx, e);
  if (vehicleCommander(state) === null && trader === null) {
    refuseMove(world, ctx, e, 'noCommander');
    return false;
  }
  const point = { hx: command.x, hy: command.y };
  const dock = command.dock === undefined ? null : { hx: command.dock.x, hy: command.dock.y };
  if (
    trader !== null &&
    firstDockNode(
      world,
      ctx,
      terrain,
      e,
      anchor,
      point,
      dock,
      (node) => vehicleRouteTo(world, ctx, terrain, e, node) !== null,
    ) === null
  ) {
    refuseMove(world, ctx, e, 'noPath');
    return false;
  }
  if (trader !== null || !crewInside(state)) {
    const live = world.mut(e, Vehicle);
    live.heldGoal = point;
    live.heldDock = dock;
    live.task = 'docks';
    if (trader !== null) turnToVehicle(world, trader);
    recordAiOrder(world, e, origin);
    return true;
  }
  const accepted = startDock(world, ctx, terrain, e, point, dock);
  if (accepted) recordAiOrder(world, e, origin);
  return accepted;
}

/**
 * Where a ship may be told to dock, read the way the dock pick's overlay and click gate need it: one
 * pure answer per node over the rule {@link startDock} applies, without issuing the order.
 */
export interface MooringProbe {
  /** Whether the dock order on half-cell node `(x, y)` would find a dock node: a shore node at exactly
   *  the door distance from a water node the ship can reach. */
  canMoor(x: number, y: number): boolean;
  /** Whether `(x, y)` is a dock node: a water node the ship can reach and park on (its free-size class
   *  holds its disc) with a mooring spot at the door distance, which a dock order may name. */
  canDock(x: number, y: number): boolean;
  /** The land component (`TerrainGraph.componentOf`) of mooring spot `(x, y)`: spots alike lie on one
   *  island. `NO_COMPONENT` for a node that is no spot. */
  landOf(x: number, y: number): number;
  /** Changes whenever the answers may have; overlay frames memoize on it. */
  readonly key: string;
}

/** Where a ship's dock order would moor, as the node set behind {@link MooringProbe}. */
export interface MooringSpots {
  readonly key: string;
  readonly spots: ReadonlySet<NodeId>;
  /** The parkable dock nodes the spots are found from. */
  readonly docks: ReadonlySet<NodeId>;
}

interface MooringMemo extends MooringSpots {
  readonly terrain: TerrainGraph;
  readonly probe: MooringProbe;
}

/** A few entries per world, by key, so a selected fleet spread over different waters does not evict
 *  one ship's answer with another's. It feeds the overlay, the berth preview, the click gate and a
 *  trader's voyage; the spots are a function of the key alone, so it changes no result and is not hashed. */
const mooringMemo = new WeakMap<World, Map<string, MooringMemo>>();
/** The memo entries a world keeps, the least recently built dropped first. */
const MOORING_MEMO_ENTRIES = 4;

/**
 * The {@link MooringProbe} of `vehicle`, or null for a vehicle that takes no dock order: not a ship, or
 * riding a carrier. Every land node at the door distance from the parts of the sea the ship can sail
 * into is a mooring spot, gathered once per sea labelling ({@link seaRegions}), so a ship under way
 * or another vehicle moving keeps the answer. Approximations: the original's dock command takes any
 * point, so a click at sea also moors when a ring node takes it; the probe accepts walkable land only,
 * the shore the crew can step onto; and other vehicles do not dim a shore, whether one lies on its
 * ring or across the only way there, where the order then finds no route.
 */
export function mooringProbe(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringProbe | null {
  return mooringMemoOf(world, ctx, terrain, vehicle)?.probe ?? null;
}

/** The spot set behind {@link mooringProbe}, from the same memo. */
export function mooringSpotsOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringSpots | null {
  return mooringMemoOf(world, ctx, terrain, vehicle);
}

function mooringMemoOf(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  vehicle: Entity,
): MooringMemo | null {
  const state = world.tryGet(vehicle, Vehicle);
  const anchor = vehicleAnchor(world, vehicle);
  if (state === undefined || anchor === null || state.carrier !== null) return null;
  const type = contentIndex(ctx.content).vehicles.get(state.vehicleType);
  const vector = type?.passengerVector;
  if (type === undefined || vector === undefined || !isShipVehicle(type)) return null;
  if (!terrain.inBounds(anchor.hx, anchor.hy)) return null;
  const regions = seaRegions(world, ctx, terrain, type.logicSize);
  const reach = regions.regionsFrom(terrain.nodeAt(anchor.hx, anchor.hy));
  const key = `${regions.key}:${reach.join(',')}:${vector.distance}`;
  let held = mooringMemo.get(world);
  if (held === undefined) {
    held = new Map();
    mooringMemo.set(world, held);
  }
  const cached = held.get(key);
  if (cached !== undefined && cached.terrain === terrain) return cached;
  const { spots, docks } = mooringSpots(world, ctx, terrain, regions, reach, vector.distance, type.logicSize);
  const probe: MooringProbe = {
    key,
    canMoor: (x, y) => terrain.inBounds(x, y) && spots.has(terrain.nodeAt(x, y)),
    canDock: (x, y) => terrain.inBounds(x, y) && docks.has(terrain.nodeAt(x, y)),
    landOf: (x, y) => {
      if (!terrain.inBounds(x, y)) return NO_COMPONENT;
      const node = terrain.nodeAt(x, y);
      return spots.has(node) ? terrain.componentOf(node) : NO_COMPONENT;
    },
  };
  const memo: MooringMemo = { key, spots, docks, terrain, probe };
  held.delete(key);
  held.set(key, memo);
  for (const stale of held.keys()) {
    if (held.size <= MOORING_MEMO_ENTRIES) break;
    held.delete(stale);
  }
  return memo;
}

/**
 * The walkable land nodes at exactly `doorDistance` from a node of the `reach` regions, and those of
 * the nodes with such land on their ring that a ship of `logicSize` may park on, each set in the order the
 * nodes and their {@link hexagonRing} walks first meet it. A node whose free-size class is at least the
 * door distance has no other continent within it (the class is the radius of its own open component
 * around it), so only the coastal band is scanned.
 */
function mooringSpots(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  regions: SeaRegions,
  reach: readonly number[],
  doorDistance: number,
  logicSize: number,
): Pick<MooringSpots, 'spots' | 'docks'> {
  const clearance = vehicleClearance(world, ctx, terrain);
  const inland = doorDistance <= MAX_CLEARANCE_CLASS ? doorDistance : Number.POSITIVE_INFINITY;
  const { nodeCount, width, height } = terrain;
  const evenRing = ringOffsets(doorDistance, EVEN_ROW, width);
  const oddRing = ringOffsets(doorDistance, ODD_ROW, width);
  const spotted = new Uint8Array(nodeCount);
  const spots = new Set<NodeId>();
  const docks = new Set<NodeId>();
  for (let n = 0; n < nodeCount; n++) {
    const node = n as NodeId;
    const nodeClass = clearance.classOf(node);
    if (nodeClass >= inland || !reach.includes(regions.regionOf(node))) continue;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    const ring = (y & 1) === EVEN_ROW ? evenRing : oddRing;
    const inside = x >= ring.reach && y >= ring.reach && x < width - ring.reach && y < height - ring.reach;
    let shore = false;
    for (let i = 0; i < ring.ids.length; i++) {
      let spot: NodeId;
      if (inside) spot = (n + (ring.ids[i] ?? 0)) as NodeId;
      else {
        const sx = x + (ring.dx[i] ?? 0);
        const sy = y + (ring.dy[i] ?? 0);
        if (!terrain.inBounds(sx, sy)) continue;
        spot = terrain.nodeAt(sx, sy);
      }
      if (!terrain.isWalkable(spot)) continue;
      shore = true;
      if (spotted[spot] === 1) continue;
      spotted[spot] = 1;
      spots.add(spot);
    }
    if (shore && nodeClass >= logicSize) docks.add(node);
  }
  return { spots, docks };
}

const EVEN_ROW = 0;
const ODD_ROW = 1;

/** A {@link hexagonRing} walk of `radius` around a centre on a row of `parity`, in its order: each
 *  point's offset in columns and rows, and as a node id step on a map of the given width. */
interface RingOffsets {
  readonly dx: Int32Array;
  readonly dy: Int32Array;
  readonly ids: Int32Array;
  /** The largest column or row offset, so a centre this far inside the map has its whole ring on it. */
  readonly reach: number;
}

function ringOffsets(radius: number, parity: number, width: number): RingOffsets {
  const length = hexRingLength(radius);
  const dx = new Int32Array(length);
  const dy = new Int32Array(length);
  const ids = new Int32Array(length);
  let reach = 0;
  for (let i = 0; i < length; i++) {
    const column = hexRingHx(0, parity, radius, i);
    const row = hexRingHy(parity, radius, i) - parity;
    dx[i] = column;
    dy[i] = row;
    ids[i] = row * width + column;
    reach = Math.max(reach, Math.abs(column), Math.abs(row));
  }
  return { dx, dy, ids, reach };
}
