import { Crop, StrandedField } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
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
 * Flood cap of one route probe, in visited nodes: far above a healthy field's stance-to-door flood and any
 * wall-ringed pocket, far under a map region, so it bounds the sweep's worst tick against a flood across
 * half a map. A sealed region bigger than this reads as `giveup`, which keeps the field, so the cap can
 * defer reclaiming a monstrous pocket but never destroys a workable one.
 */
export const STRANDED_FIELD_PROBE_MAX_VISITED = 2048;

type ProbeResult = 'reached' | 'exhausted' | 'giveup';

/**
 * Bounded breadth-first reachability over walkable, unblocked ground. Callers flood from the field side, so
 * a sealed pocket exhausts at pocket size. Edges are symmetric within the walkable set, so `exhausted` is an
 * exact "no route", and a `to` under an overlay block is never entered: a farm whose door is sealed cannot
 * be worked.
 */
function probeRoute(
  terrain: TerrainGraph,
  overlay: BlockOverlay,
  from: NodeId,
  to: NodeId,
  maxVisited: number,
): ProbeResult {
  if (from === to) return 'reached';
  const steps = new StepBuffer();
  const seen = new Set<NodeId>([from]);
  const frontier: NodeId[] = [from];
  for (let i = 0; i < frontier.length; i++) {
    const cur = frontier[i];
    if (cur === undefined) break; // i < length, so only for the type
    terrain.stepsInto(cur, overlay, steps);
    for (let s = 0; s < steps.length; s++) {
      const next = steps.at(s).node;
      if (next === to) return 'reached';
      if (seen.has(next)) continue;
      if (seen.size >= maxVisited) return 'giveup';
      seen.add(next);
      frontier.push(next);
    }
  }
  return 'exhausted';
}

/** Whether some stance of the field is open ground a route from the farm's door reaches. The overlay
 *  carries buildings and resources only - settlers standing about are invisible here, so a farmer
 *  mid-swing or a bystander on the work cell can never read as stranded. */
function fieldWorkable(
  world: World,
  terrain: TerrainGraph,
  field: Entity,
  door: NodeId,
  overlay: BlockOverlay,
): boolean {
  for (const stance of resourceStanceCells(world, terrain, field)) {
    if (!terrain.isWalkable(stance) || overlay.has(stance)) continue;
    // A static split needs no flood: the overlay only ever removes edges, never joins components.
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
    if (fieldWorkable(world, terrain, e, door, overlay)) {
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
