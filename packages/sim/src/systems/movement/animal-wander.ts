import { FarmAnimal, MoveGoal, StayPoint } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import type { System } from '../context.js';
import { buildingDoorwayNodes, dynamicBlockOverlay } from '../footprint/index.js';
import { manhattan } from '../spatial/metric.js';
import { type GrazingFields, grazingFields } from './grazing-fields.js';
import { nearHeld } from './spacing.js';
import { settlerTraversal } from './traversal.js';

/** Mean ticks between a claimed animal's grazing steps: each idle tick rolls 1-in-N. Approximation: the
 *  farm herd's own cadence is not pinned, and this pace keeps penned stock beside the farm calm. */
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

/** Whether `node` sits within the stander spacing of a kept field or of a sidestep claimed this pass. */
function fieldContested(
  terrain: TerrainGraph,
  fields: GrazingFields,
  taken: ReadonlySet<NodeId> | undefined,
  node: NodeId,
): boolean {
  return fields.keeperNear(node) !== undefined || (taken !== undefined && nearHeld(terrain, node, taken));
}

/** How far one claimed animal's grazing step may aim from where it stands (node Manhattan), clamped down
 *  to its leash. Approximation: no readable step size. */
const LIVESTOCK_WANDER_STEP_NODES = 4;

/**
 * The standing drive: two animals standing on one node un-stack, since only walkers get the separation
 * system's soft nudge, and an idle claimed animal occasionally steps to a spot near itself on its farm's or
 * yard's leash. The leash bounds where a step may end rather than how far one reaches, so one displaced past
 * it may still step home. Wild animals graze by their own stay decisions (`systems/wildlife`).
 *
 * `range` is read before the cadence roll so a range-0 animal stays out of the rng stream entirely.
 */
export const animalWanderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to roam over
  const terrain = ctx.terrain;
  // Composed lazily: a map of standing wildlife never needs the overlay or the doorways.
  let blocked: BlockOverlay | undefined;
  let doorways: ReadonlySet<NodeId> | undefined;
  // This pass's sidestep claims, made only when standers stack.
  let taken: Set<NodeId> | undefined;

  // The wanderers are standing animals no other drive holds (not resting in a building, travelling,
  // mid-atomic, fighting, provoked, ordered, frightened, summoned to a farm door or recruited to a cart)
  // that are stacked or leashed livestock. Only MoveGoal writes happen here, and the index replays them
  // at the next pass.
  const fields = grazingFields(world, ctx.content, terrain);
  const wanderers = fields.wanderers;
  for (let i = 0; i < wanderers.length; i++) {
    const e = wanderers[i];
    if (e === undefined) continue;
    // Un-stack before any graze roll: an animal inside another keeper's field steps to the nearest free
    // spot with the leash ignored, since getting off a shared field beats staying strictly inside the
    // territory. The sidestep draws no rng; the `continue` drops this animal's cadence roll for the tick.
    const here = fields.nodeOf(e);
    if (fields.keeperAt(here) !== e) {
      blocked ??= dynamicBlockOverlay(world, ctx, terrain);
      doorways ??= buildingDoorwayNodes(world, ctx, terrain);
      taken ??= new Set();
      const spot = sidestepTarget(
        terrain,
        fields,
        taken,
        blocked,
        doorways,
        here,
        settlerTraversal(world, e),
      );
      if (spot !== null) world.add(e, MoveGoal, { cell: spot });
      continue;
    }

    // Claimed livestock grazes at a calm pace on its farm's or its base yard's leash.
    if (!fields.claimed(e)) continue;
    const range = fields.rangeOf(e);
    if (range <= 0) continue; // no leash to range over: this animal holds its spot
    if (ctx.rng.int(LIVESTOCK_WANDER_PERIOD_TICKS) !== 0) continue;

    const at = terrain.coordsOf(here);
    // A Manhattan diamond around the creature: `dx` first, then `dy` over what the step budget leaves.
    // Uniform per column rather than per node.
    const step = Math.min(LIVESTOCK_WANDER_STEP_NODES, range);
    const dx = ctx.rng.int(2 * step + 1) - step;
    const span = step - Math.abs(dx);
    const dy = ctx.rng.int(2 * span + 1) - span;
    if (dx === 0 && dy === 0) continue; // the diamond's centre: a goal the creature already stands on
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue; // off-map pick: drop it, don't fold onto the rim
    const target = terrain.nodeAt(at.x + dx, at.y + dy);

    // The leash: stay inside the territory, or at least head back toward the anchor.
    const anchor = world.get(e, StayPoint).cell;
    // A farm's herd is leashed to the door itself, which must stay clear for the player to click.
    if (target === anchor && world.has(e, FarmAnimal)) continue;
    const reach = manhattan(terrain, target, anchor);
    if (reach > range && reach >= manhattan(terrain, here, anchor)) continue;

    if (!terrain.traversable(target, settlerTraversal(world, e))) continue;
    // Across water: findPath would reject the goal outright and strand the creature for the planner's
    // retry window.
    if (terrain.componentOf(target) !== terrain.componentOf(here)) continue;
    // Never graze into a stack. The creature's own field rejects too, so a distance-1 pick is refused as
    // a half-cell shuffle rather than a graze step.
    if (fieldContested(terrain, fields, taken, target)) continue;
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    doorways ??= buildingDoorwayNodes(world, ctx, terrain);
    // A doorway is ground to cross, never a stand.
    if (blocked.has(target) || doorways.has(target)) continue;

    world.add(e, MoveGoal, { cell: target });
  }
};

/** The first free {@link UNSTACK_OFFSETS} spot beside a shared field, off every doorway, or null when
 *  the creature is boxed in and retries next tick. */
function sidestepTarget(
  terrain: TerrainGraph,
  fields: GrazingFields,
  taken: Set<NodeId>,
  blocked: BlockOverlay,
  doorways: ReadonlySet<NodeId>,
  from: NodeId,
  traversal: Traversal,
): NodeId | null {
  const at = terrain.coordsOf(from);
  for (const [dx, dy] of UNSTACK_OFFSETS) {
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const node = terrain.nodeAt(at.x + dx, at.y + dy);
    if (!terrain.traversable(node, traversal)) continue;
    if (terrain.componentOf(node) !== terrain.componentOf(from)) continue;
    if (fieldContested(terrain, fields, taken, node)) continue;
    if (blocked.has(node) || doorways.has(node)) continue;
    taken.add(node);
    return node;
  }
  return null;
}
