import { Crop, StrandedField } from '../../components/index.js';
import type { Fixed } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { latticeDistanceTo, type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, System } from '../context.js';
import {
  dynamicBlockOverlay,
  interactionNode,
  resourceStanceCells,
  unstampResourceFootprint,
} from '../footprint/index.js';

// Destroy a field no farmer can ever reach again so its `maxFields` slot returns to the plot. These are the
// cases the under-wall pass cannot see: a field sealed inside a pocket of buildings, a plot split from its
// farm by impassable terrain, and ground grown over its work cells. A liveness rule of this engine, not
// decoded original behavior: the span, cadence and probe bound are authored recovery pacing.

/** How often one field is re-examined. Sweeps are staggered by entity id so the per-tick cost is
 *  `crops / period` route probes, never a same-tick spike across a whole plot. */
export const STRANDED_FIELD_CHECK_PERIOD_TICKS = 5 * TICKS_PER_SECOND;

/**
 * How long a field must stay cut off before it is destroyed. Comfortably above the planner's failed-goal
 * memo (`UNREACHABLE_GOAL_MEMO_TICKS`, 30 s) and long enough for ordinary transients to clear, while a
 * walled-in plot still recovers its slot within a game minute.
 */
export const STRANDED_FIELD_RECLAIM_TICKS = 60 * TICKS_PER_SECOND;

/**
 * Discovery cap of one route probe, in nodes: far above a healthy field's stance-to-door search and any
 * wall-ringed pocket, far under a map region, so it bounds the sweep's worst tick against a flood across
 * half a map. A sealed region bigger than this reads as `giveup`, which keeps the field, so the cap can
 * defer reclaiming a monstrous pocket but never destroys a workable one.
 */
export const STRANDED_FIELD_PROBE_MAX_VISITED = 2048;

type ProbeResult = 'reached' | 'exhausted' | 'giveup';

/**
 * One terrain's probe buffers, reused by every probe since each runs to completion before the next: the
 * discovered marks and the open heap of discovered nodes keyed by lattice distance to the door.
 */
class ProbeScratch {
  readonly steps = new StepBuffer();
  /** {@link epoch} on each node the running probe has discovered. */
  private readonly seen: Uint32Array;
  private epoch = 0;
  private readonly heapNodes: NodeId[] = [];
  private readonly heapKeys: Fixed[] = [];
  size = 0;

  constructor(nodeCount: number) {
    this.seen = new Uint32Array(nodeCount);
  }

  begin(): void {
    if (this.epoch === MAX_EPOCH) {
      this.seen.fill(0);
      this.epoch = 0;
    }
    this.epoch++;
    this.size = 0;
  }

  /** Mark `node` discovered; false when it already was. */
  discover(node: NodeId): boolean {
    if (this.seen[node] === this.epoch) return false;
    this.seen[node] = this.epoch;
    return true;
  }

  push(node: NodeId, toDoor: Fixed): void {
    const { heapNodes, heapKeys } = this;
    let at = this.size++;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      const parentNode = heapNodes[parent] as NodeId;
      const parentKey = heapKeys[parent] as Fixed;
      if (!nearerDoor(toDoor, node, parentKey, parentNode)) break;
      heapNodes[at] = parentNode;
      heapKeys[at] = parentKey;
      at = parent;
    }
    heapNodes[at] = node;
    heapKeys[at] = toDoor;
  }

  /** Remove and return the open node nearest the door. Call only while {@link size} is positive. */
  pop(): NodeId {
    const { heapNodes, heapKeys } = this;
    const top = heapNodes[0] as NodeId;
    const size = --this.size;
    if (size === 0) return top;
    const node = heapNodes[size] as NodeId;
    const key = heapKeys[size] as Fixed;
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= size) break;
      if (
        child + 1 < size &&
        nearerDoor(
          heapKeys[child + 1] as Fixed,
          heapNodes[child + 1] as NodeId,
          heapKeys[child] as Fixed,
          heapNodes[child] as NodeId,
        )
      ) {
        child++;
      }
      if (!nearerDoor(heapKeys[child] as Fixed, heapNodes[child] as NodeId, key, node)) break;
      heapNodes[at] = heapNodes[child] as NodeId;
      heapKeys[at] = heapKeys[child] as Fixed;
      at = child;
    }
    heapNodes[at] = node;
    heapKeys[at] = key;
    return top;
  }
}

/** The last epoch before the discovered marks are cleared and counting restarts. */
const MAX_EPOCH = 0xffffffff;

const probeScratch = new WeakMap<TerrainGraph, ProbeScratch>();

/** The probe's expansion order: nearest the door first, ties by node id. A strict total order over
 *  distinct nodes, so the pop sequence does not depend on the heap's layout. */
function nearerDoor(aToDoor: Fixed, a: NodeId, bToDoor: Fixed, b: NodeId): boolean {
  return aToDoor !== bToDoor ? aToDoor < bToDoor : a < b;
}

/**
 * Bounded reachability over walkable, unblocked ground, expanding the discovered node nearest `to` first,
 * so a healthy field walks a near-straight line to its door instead of flooding the disc between them.
 * The order changes no `exhausted` verdict, the only one that strands: the cap counts discovered nodes, so
 * a region without `to` is `exhausted` exactly when it fits under the cap, whatever order discovers it. Callers start on the field side, so a
 * sealed pocket exhausts at pocket size. Edges are symmetric within the walkable set, so `exhausted` is
 * an exact "no route", and a `to` under an overlay block is never entered: a farm whose door is sealed
 * cannot be worked.
 */
function probeRoute(
  terrain: TerrainGraph,
  overlay: BlockOverlay,
  from: NodeId,
  to: NodeId,
  maxVisited: number,
): ProbeResult {
  if (from === to) return 'reached';
  const doorX = terrain.xOf(to);
  const doorY = terrain.yOf(to);
  let scratch = probeScratch.get(terrain);
  if (scratch === undefined) {
    scratch = new ProbeScratch(terrain.nodeCount);
    probeScratch.set(terrain, scratch);
  }
  const { steps } = scratch;
  scratch.begin();
  scratch.discover(from);
  let discovered = 1;
  scratch.push(from, latticeDistanceTo(terrain, doorX, doorY, from));
  while (scratch.size > 0) {
    terrain.stepsInto(scratch.pop(), overlay, steps);
    for (let s = 0; s < steps.length; s++) {
      const next = steps.nodeAt(s);
      if (next === to) return 'reached';
      if (!scratch.discover(next)) continue;
      if (discovered >= maxVisited) return 'giveup';
      discovered++;
      scratch.push(next, latticeDistanceTo(terrain, doorX, doorY, next));
    }
  }
  return 'exhausted';
}

/** Whether some stance of the field is open ground a route from the farm's door reaches. The overlay
 *  carries buildings and resources only - settlers standing about are invisible here, so a farmer
 *  mid-swing or a bystander on the work cell can never read as stranded. */
function fieldWorkable(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  field: Entity,
  door: NodeId,
  overlay: BlockOverlay,
): boolean {
  for (const stance of resourceStanceCells(world, ctx, terrain, field)) {
    if (!terrain.isWalkable(stance) || overlay.has(stance)) continue;
    // A static split needs no probe: the overlay only ever removes edges, never joins components.
    if (terrain.componentOf(stance) !== terrain.componentOf(door)) continue;
    const probe = probeRoute(terrain, overlay, stance, door, STRANDED_FIELD_PROBE_MAX_VISITED);
    if (probe !== 'exhausted') return true; // reached - or too big to prove sealed, so keep it
  }
  return false;
}

/**
 * The reclaim sweep. Fields whose farm is gone are left alone - a wild field holds no plot slot, and
 * the harvest scans may still claim it once ripe.
 */
export const fieldReclaimSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  let overlay: BlockOverlay | undefined;
  const doomed: Entity[] = [];
  for (const e of world.query(Crop)) {
    if ((e + ctx.tick) % STRANDED_FIELD_CHECK_PERIOD_TICKS !== 0) continue; // not this field's tick
    const farm = world.get(e, Crop).farm;
    if (farm === null) continue;
    const at = interactionNode(world, ctx, farm);
    if (at === null) {
      world.remove(e, StrandedField); // farm demolished - the field is wild, not stranded
      continue;
    }
    const door = terrain.nodeAtClamped(at.x, at.y);
    overlay ??= dynamicBlockOverlay(world, ctx, terrain);
    if (fieldWorkable(world, ctx, terrain, e, door, overlay)) {
      world.remove(e, StrandedField);
      continue;
    }
    const stranded = world.tryGet(e, StrandedField);
    if (stranded === undefined) world.add(e, StrandedField, { since: ctx.tick });
    else if (ctx.tick - stranded.since >= STRANDED_FIELD_RECLAIM_TICKS) doomed.push(e);
  }
  // Destroys deferred out of the query walk; list order is the store's deterministic insertion order.
  for (const e of doomed) {
    unstampResourceFootprint(world, e);
    world.destroy(e);
  }
};
