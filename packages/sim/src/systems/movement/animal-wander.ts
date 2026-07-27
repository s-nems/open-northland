import {
  Anger,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  MoveGoal,
  Position,
  Settler,
  StayPoint,
} from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import type { System } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { stayPointRangeOf } from '../readviews/index.js';
import { canonicalById, entityNode, isTravelling, manhattan } from '../spatial/nodes.js';

/** Mean ticks between grazing steps: each idle tick rolls 1-in-N. Approximated (the original's roam
 *  cadence is not readable), paced to read as grazing rather than a patrol. */
export const ANIMAL_WANDER_PERIOD_TICKS = 5 * TICKS_PER_SECOND;

/** How far one grazing step may aim from where the creature stands (node Manhattan). Clamped down to the
 *  creature's own territory radius, so a species whose range is 2 or 3 nodes still has picks its leash
 *  accepts. Approximated (no readable step size). */
export const ANIMAL_WANDER_STEP_NODES = 4;

/**
 * AnimalWanderSystem: the grazing drive. An idle creature occasionally steps to a spot near itself
 * instead of standing frozen where it spawned.
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

  for (const e of canonicalById(world.query(StayPoint, Settler, Position))) {
    if (world.has(e, CurrentAtomic)) continue;
    if (isTravelling(world, e)) continue;
    if (world.has(e, Engagement) || world.has(e, Anger) || world.has(e, AttackOrder)) continue;

    const range = stayPointRangeOf(ctx.content, world.get(e, Settler).tribe);
    if (range <= 0) continue; // no territory to range over: this creature holds its spot
    if (ctx.rng.int(ANIMAL_WANDER_PERIOD_TICKS) !== 0) continue;

    const here = entityNode(world, terrain, e);
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
    blocked ??= dynamicBlockOverlay(world, ctx, terrain);
    if (blocked.has(target)) continue;

    world.add(e, MoveGoal, { cell: target });
  }
};
