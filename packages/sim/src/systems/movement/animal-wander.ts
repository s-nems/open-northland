import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Frightened,
  Livestock,
  LivestockVisit,
  MoveGoal,
  Owner,
  Position,
  Resting,
  Settler,
  StayPoint,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { grazeLeashOf } from '../livestock/assignment.js';
import { stayPointRangeOf } from '../readviews/index.js';
import { canonicalById, entityNode, isTravelling, manhattan } from '../spatial/nodes.js';
import { nearHeld, SPACING_PROBES } from './spacing.js';

/** Mean ticks between grazing steps: each idle tick rolls 1-in-N. Approximated (the original's roam
 *  cadence is not readable), paced to read as grazing rather than a patrol. */
export const ANIMAL_WANDER_PERIOD_TICKS = 5 * TICKS_PER_SECOND;

/** Mean ticks between a claimed animal's grazing steps. Approximation: calmer than the wild cadence, at
 *  which penned stock beside the farm reads as restless. */
export const LIVESTOCK_WANDER_PERIOD_TICKS = 15 * TICKS_PER_SECOND;

/** Sidestep candidates for a stacked stander, nearest first and in fixed order so the pick is canonical.
 *  The displacement of 2 must stay at or below every recall leash (`maximumleaderdistance`, the claimed
 *  grazing leash, a territory radius) or a sidestep would ping-pong with the recall; content minima are 3. */
const UNSTACK_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [2, 0],
  [-2, 0],
  [0, 2],
  [0, -2],
];

/** This tick's field occupancy: the elected keeper per node, and the sidestep targets already claimed. */
interface Occupancy {
  readonly keeperByNode: Map<NodeId, Entity>;
  readonly taken: Set<NodeId>;
}

/** The keeper holding `node` or any node within the stander spacing of it, or undefined when free. */
function keeperNear(terrain: TerrainGraph, fields: Occupancy, node: NodeId): Entity | undefined {
  const at = terrain.coordsOf(node);
  for (const [dx, dy] of SPACING_PROBES) {
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const keeper = fields.keeperByNode.get(terrain.nodeAt(at.x + dx, at.y + dy));
    if (keeper !== undefined) return keeper;
  }
  return undefined;
}

/** Whether `node` sits within the stander spacing of a kept field or of a sidestep claimed this tick. */
function fieldContested(terrain: TerrainGraph, fields: Occupancy, node: NodeId): boolean {
  return keeperNear(terrain, fields, node) !== undefined || nearHeld(terrain, node, fields.taken);
}

/** How far one grazing step may aim from where the creature stands (node Manhattan), clamped down to the
 *  creature's territory radius so a short-ranged species still has picks its leash accepts. Approximation:
 *  no readable step size. */
export const ANIMAL_WANDER_STEP_NODES = 4;

/**
 * The grazing drive: an idle creature occasionally steps to a spot near itself, and two creatures standing
 * on one node un-stack, since only walkers get the separation system's soft nudge. The territory radius
 * leashes where a step may end rather than how far one step reaches, so short hops drift a creature around
 * its territory without leaving it, and one displaced past its leash may still step home. No leg starts
 * while a fight is live, and `combatSystem` skips acquisition for a travelling unit, so a graze leg is a
 * window in which a creature runs no combat.
 *
 * source-basis: the territory radius is the verbatim extracted `maximumdistancetostaypoint`, consumed as a
 * node-lattice Manhattan radius like `maximumleaderdistance`, so a territory is a node diamond, wider than
 * tall in world units. Approximation: the step cadence and length, and the birth node as the anchor. The
 * key `maximumdistancetobirthpoint` suggests the stay point itself relocates within a wider radius, but
 * nothing readable gives a trigger or a cadence, so herds stay pinned to their spawn area.
 *
 * `range` is read before the cadence roll so a range-0 species stays out of the rng stream entirely.
 */
export const animalWanderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to roam over
  const terrain = ctx.terrain;
  // Composed lazily: a map of standing wildlife never needs the overlay.
  let blocked: BlockOverlay | undefined;

  // One canonical list shared by the occupancy pre-pass and the drive loop; only MoveGoal writes happen
  // here, so membership cannot change between them.
  const animals = canonicalById(world.query(StayPoint, Settler, Position));
  if (animals.length === 0) return; // no wildlife on this map

  // The first stander in canonical order to reach a field becomes its keeper. A Resting animal is inside
  // a building, off the field.
  const fields: Occupancy = { keeperByNode: new Map(), taken: new Set() };
  for (const e of animals) {
    if (world.has(e, Resting) || isTravelling(world, e)) continue;
    const node = entityNode(world, terrain, e);
    if (keeperNear(terrain, fields, node) === undefined) fields.keeperByNode.set(node, e);
  }

  for (const e of animals) {
    if (world.has(e, CurrentAtomic)) continue;
    // A processing visit owns the creature: no graze leg competing with its walk to the door.
    if (world.has(e, Resting) || world.has(e, LivestockVisit)) continue;
    if (isTravelling(world, e)) continue;
    if (world.has(e, Engagement) || world.has(e, Anger) || world.has(e, AttackOrder)) continue;
    if (world.has(e, Frightened)) continue; // a scattering animal is the fright drive's, not grazing

    // Un-stack before any graze roll: an animal inside another keeper's field steps to the nearest free
    // spot with the leash ignored, since getting off a shared field beats staying strictly inside the
    // territory. The sidestep draws no rng; the `continue` drops this animal's cadence roll for the tick.
    const here = entityNode(world, terrain, e);
    if (fields.keeperByNode.get(here) !== e) {
      blocked ??= dynamicBlockOverlay(world, ctx, terrain);
      const spot = sidestepTarget(terrain, fields, blocked, here);
      if (spot !== null) world.add(e, MoveGoal, { cell: spot });
      continue;
    }

    // Claimed livestock grazes on the short shared leash at a calm pace; a wild creature keeps its
    // species' territory radius and the wild cadence.
    const claimed = world.has(e, Livestock) && world.has(e, Owner);
    const range = claimed
      ? grazeLeashOf(ctx.content, world.get(e, Settler).tribe)
      : stayPointRangeOf(ctx.content, world.get(e, Settler).tribe);
    if (range <= 0) continue; // no territory to range over: this creature holds its spot
    if (ctx.rng.int(claimed ? LIVESTOCK_WANDER_PERIOD_TICKS : ANIMAL_WANDER_PERIOD_TICKS) !== 0) continue;

    const at = terrain.coordsOf(here);
    // A Manhattan diamond around the creature: `dx` first, then `dy` over what the step budget leaves.
    // Uniform per column rather than per node.
    const step = Math.min(ANIMAL_WANDER_STEP_NODES, range);
    const dx = ctx.rng.int(2 * step + 1) - step;
    const span = step - Math.abs(dx);
    const dy = ctx.rng.int(2 * span + 1) - span;
    if (dx === 0 && dy === 0) continue; // the diamond's centre: a goal the creature already stands on
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue; // off-map pick: drop it, don't fold onto the rim
    const target = terrain.nodeAt(at.x + dx, at.y + dy);

    // The leash: stay inside the territory, or at least head back toward the anchor.
    const anchor = world.get(e, StayPoint).cell;
    const reach = manhattan(terrain, target, anchor);
    if (reach > range && reach >= manhattan(terrain, here, anchor)) continue;

    if (!terrain.isWalkable(target)) continue;
    // Across water: findPath would reject the goal outright and strand the creature for the planner's
    // retry window.
    if (terrain.componentOf(target) !== terrain.componentOf(here)) continue;
    // Never graze into a stack. The creature's own field rejects too, so a distance-1 pick is refused as
    // a half-cell shuffle rather than a graze step.
    if (fieldContested(terrain, fields, target)) continue;
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    if (blocked.has(target)) continue;

    world.add(e, MoveGoal, { cell: target });
  }
};

/** The first free {@link UNSTACK_OFFSETS} spot beside a shared field, or null when the creature is boxed
 *  in and retries next tick. */
function sidestepTarget(
  terrain: TerrainGraph,
  fields: Occupancy,
  blocked: BlockOverlay,
  from: NodeId,
): NodeId | null {
  const at = terrain.coordsOf(from);
  for (const [dx, dy] of UNSTACK_OFFSETS) {
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const node = terrain.nodeAt(at.x + dx, at.y + dy);
    if (!terrain.isWalkable(node)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(from)) continue;
    if (fieldContested(terrain, fields, node)) continue;
    if (blocked.has(node)) continue;
    fields.taken.add(node);
    return node;
  }
  return null;
}
