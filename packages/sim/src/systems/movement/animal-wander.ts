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

/** Mean ticks between a CLAIMED animal's grazing steps - calmer than the wild cadence (user feedback:
 *  penned stock beside the farm read as restless at the wild pace). */
export const LIVESTOCK_WANDER_PERIOD_TICKS = 15 * TICKS_PER_SECOND;

/** Sidestep candidates for a stacked stander, nearest first: the diagonal then axial node-Manhattan-2
 *  spots (the nearest that read as separated sprites). Fixed order, so the pick is canonical. The
 *  displacement (2) must stay at or below every recall leash - herding's `maximumleaderdistance`, the
 *  claimed grazing leash (3), a territory radius - or a sidestep would ping-pong with the recall;
 *  current content minima are 3. */
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

/** This tick's field occupancy: the elected keeper per node - the animal that holds that field
 *  ({@link keeperNear}) - and the sidestep targets already claimed this tick. */
interface Occupancy {
  readonly keeperByNode: Map<NodeId, Entity>;
  readonly taken: Set<NodeId>;
}

/** The keeper holding `node` or any node closer than the stander spacing to it
 *  ({@link SPACING_PROBES}), or undefined when the field is free. */
function keeperNear(terrain: TerrainGraph, fields: Occupancy, node: NodeId): Entity | undefined {
  const at = terrain.coordsOf(node);
  for (const [dx, dy] of SPACING_PROBES) {
    if (!terrain.inBounds(at.x + dx, at.y + dy)) continue;
    const keeper = fields.keeperByNode.get(terrain.nodeAt(at.x + dx, at.y + dy));
    if (keeper !== undefined) return keeper;
  }
  return undefined;
}

/** Whether `node` sits closer than the stander spacing to a kept field or to a sidestep target
 *  already claimed this tick - the rejection every standing-goal pick (graze or sidestep) applies. */
function fieldContested(terrain: TerrainGraph, fields: Occupancy, node: NodeId): boolean {
  return keeperNear(terrain, fields, node) !== undefined || nearHeld(terrain, node, fields.taken);
}

/** How far one grazing step may aim from where the creature stands (node Manhattan). Clamped down to the
 *  creature's own territory radius, so a species whose range is 2 or 3 nodes still has picks its leash
 *  accepts. Approximated (no readable step size). */
export const ANIMAL_WANDER_STEP_NODES = 4;

/**
 * AnimalWanderSystem: the grazing drive. An idle creature occasionally steps to a spot near itself
 * instead of standing frozen where it spawned. It also keeps standers apart: walkers pass through each
 * other (the separation system's soft tier un-merges them), but two animals STANDING on one node would
 * sit merged forever, so the non-keeper sidesteps and no graze goal ever aims at an occupied node.
 *
 * The territory radius is a LEASH on where a step may end, not a bound on the step's length, so many
 * short hops drift a creature around its territory but never out of it. A creature displaced past its
 * own leash (by a spawn push or a fight) may still step homeward, so the leash never freezes it.
 *
 * Combat gate: `combatSystem` skips target acquisition for a travelling unit that is not yet engaged
 * (`conflict/combat.ts`), so every graze leg is a window in which a creature runs no combat. Refusing to
 * start one while {@link Engagement}, {@link Anger} or an {@link AttackOrder} is live keeps a fight from
 * being walked away from. Residual: an unprovoked predator that has already begun a step stays
 * ambush-blind for its length, and a step the router then refuses parks the creature `Stranded`
 * (`settlers/planner/replan.ts`) for its retry window, the longer blind spell of the two.
 *
 * source-basis: the territory radius is the verbatim extracted `maximumdistancetostaypoint`, consumed as
 * a node-lattice Manhattan radius like `maximumleaderdistance` (`readviews/tribes/animals.ts`), so a
 * territory is a node diamond, wider than tall in world units. Approximated: the step cadence and
 * length, and that the anchor is the creature's birth node. The key name `maximumdistancetobirthpoint`
 * suggests the stay point itself relocates within that wider radius, but nothing readable gives a
 * trigger or a cadence, so our herds stay pinned to their spawn area where the original's likely drift.
 *
 * Determinism: the seeded rng is the only randomness, drawn in canonical entity-id order. `range` is
 * read BEFORE the roll deliberately, so a range-0 species stays out of the stream entirely.
 */
export const animalWanderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to roam over
  const terrain = ctx.terrain;
  // Composed once per tick from its shared caches, and only when a roll actually needs it (a map of
  // standing wildlife pays nothing).
  let blocked: BlockOverlay | undefined;

  // One canonical pass list shared by the occupancy pre-pass and the drive loop (membership cannot
  // change between them - only MoveGoal writes happen here).
  const animals = canonicalById(world.query(StayPoint, Settler, Position));
  if (animals.length === 0) return; // no wildlife on this map: not even the occupancy sets are worth minting

  // The tick's standing occupancy: the first stander in canonical order to reach a field becomes its
  // keeper; anyone standing within the spacing of a kept field sidesteps below. A walker is not a
  // stander, and a Resting animal is inside a building, off the field.
  const fields: Occupancy = { keeperByNode: new Map(), taken: new Set() };
  for (const e of animals) {
    if (world.has(e, Resting) || isTravelling(world, e)) continue;
    const node = entityNode(world, terrain, e);
    if (keeperNear(terrain, fields, node) === undefined) fields.keeperByNode.set(node, e);
  }

  for (const e of animals) {
    if (world.has(e, CurrentAtomic)) continue;
    // A processing visit owns the creature: no grazing inside (Resting), and no graze leg competing
    // with the visit system's walk to the door (LivestockVisit).
    if (world.has(e, Resting) || world.has(e, LivestockVisit)) continue;
    if (isTravelling(world, e)) continue;
    if (world.has(e, Engagement) || world.has(e, Anger) || world.has(e, AttackOrder)) continue;
    if (world.has(e, Frightened)) continue; // a scattering animal is the fright drive's, not grazing

    // Un-stack before any graze roll: an animal standing inside another keeper's field steps to the
    // nearest free spot (the keeper convention of collision/separation), leash ignored - getting off a
    // shared field beats staying strictly inside the territory (user feedback: standing animals merged
    // into one sprite). The sidestep itself consumes no rng draw (the `continue` does drop this
    // animal's cadence roll for the tick - a deterministic function of world state either way).
    const here = entityNode(world, terrain, e);
    if (fields.keeperByNode.get(here) !== e) {
      blocked ??= dynamicBlockOverlay(world, ctx, terrain);
      const spot = sidestepTarget(terrain, fields, blocked, here);
      if (spot !== null) world.add(e, MoveGoal, { cell: spot });
      continue; // this tick is the sidestep (or a blocked retry), never also a graze roll
    }

    // Claimed livestock grazes on the short shared leash ({@link grazeLeashOf}) at a calm pace; wild
    // creatures keep their species' territory radius and the wild cadence. Both reads happen BEFORE
    // the roll (see the rng note).
    const claimed = world.has(e, Livestock) && world.has(e, Owner);
    const range = claimed
      ? grazeLeashOf(ctx.content, world.get(e, Settler).tribe)
      : stayPointRangeOf(ctx.content, world.get(e, Settler).tribe);
    if (range <= 0) continue; // no territory to range over: this creature holds its spot
    if (ctx.rng.int(claimed ? LIVESTOCK_WANDER_PERIOD_TICKS : ANIMAL_WANDER_PERIOD_TICKS) !== 0) continue;

    const at = terrain.coordsOf(here);
    // A Manhattan diamond around the creature: `dx` first, then `dy` over what the step budget leaves.
    // Uniform per column rather than per node: a wander, not a sampled distribution.
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
    // Across water from the creature: findPath would reject the goal outright, stranding it for the
    // planner's retry window and filling its unreachable-goal memo (the targets/food.ts pattern).
    if (terrain.componentOf(target) !== terrain.componentOf(here)) continue;
    // Inside a stander's field, or a sidestep claimed it this tick: don't graze into a stack. The
    // creature's OWN field rejects too - a distance-1 pick is a half-cell shuffle, not a graze step.
    if (fieldContested(terrain, fields, target)) continue;
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    if (blocked.has(target)) continue;

    world.add(e, MoveGoal, { cell: target });
  }
};

/** The first free {@link UNSTACK_OFFSETS} spot beside a shared field - walkable, same component, not
 *  blocked, and clear of every kept field and every sidestep already claimed this tick
 *  ({@link fieldContested}) - or null when the creature is fully boxed in (it retries next tick). */
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
