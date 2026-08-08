import type { Recipe } from '@open-northland/data';
import {
  Building,
  CurrentAtomic,
  Health,
  Livestock,
  LivestockVisit,
  MoveGoal,
  Position,
  StayPoint,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { livestockTribeFedBy } from '../readviews/index.js';
import { isInside, stepIn, stepOut } from '../settlers/indoors.js';
import { clearNavState, entityNode, isTravelling } from '../spatial/nodes.js';
import { visitLifeCost } from './processing/life-cost.js';
import {
  arrivedVisitorCount,
  canonicalAdmittedVisitor,
  canonicalArrivedVisitor,
} from './processing/roster.js';
import { summonToWorkplaces } from './processing/summon.js';

// The processing side of husbandry, staged as a visit the player can watch: the workplace summons one
// penned animal per species, the feed batch begins only once it has arrived and steps in with the
// starting operator, and the completing batch lets it out with part of its life paid. Source basis: the
// recipes and the animal-as-good model are extracted content; the visit staging and every constant it
// needs are named approximations.

export { LIVESTOCK_MIN_LIFE_DIVISOR, LIVESTOCK_PROCESS_DRAIN_HP } from './processing/life-cost.js';
export { heldSeatCount, LIVESTOCK_PROCESS_RANGE_NODES } from './processing/summon.js';

/**
 * How many batches of `recipe` could begin right now: `Infinity` for a non-feed recipe, else the count of
 * summoned animals arrived at the door, so a feed batch never starts against an animal still walking.
 */
export function feedAnimalsAvailable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  const tribe = livestockTribeFedBy(ctx.content, recipe);
  if (tribe === null) return Number.POSITIVE_INFINITY;
  return arrivedVisitorCount(world, ctx, building, tribe);
}

/**
 * Step the starting feed batch's animal inside, or report false when no visitor stands at the door and
 * the caller must not begin the batch. A non-feed recipe admits nothing and reports true.
 */
export function admitLivestockForCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): boolean {
  const tribe = livestockTribeFedBy(ctx.content, recipe);
  if (tribe === null) return true;
  const pick = canonicalArrivedVisitor(world, ctx, building, tribe);
  if (pick === null) return false;
  // Full nav clear, not just the goal: an animal counts as arrived while its final path leg is still
  // live, and an admitted body must hold no walk.
  clearNavState(world, pick);
  stepIn(world, pick, building);
  return true;
}

/**
 * Let the completed feed batch's visitor out: it pays the visit's {@link visitLifeCost} and walks back to
 * its grazing spot rather than standing in the doorway. A visitor that died inside releases nobody and
 * charges nothing.
 */
export function releaseLivestockVisit(world: World, building: Entity, tribe: number): void {
  const visitor = canonicalAdmittedVisitor(world, building, tribe);
  if (visitor === null) return;
  if (world.has(visitor, Health)) {
    const h = world.mut(visitor, Health);
    h.hitpoints -= visitLifeCost(h);
  }
  world.remove(visitor, LivestockVisit);
  stepOut(world, visitor);
  const stay = world.tryGet(visitor, StayPoint);
  if (stay !== undefined) world.add(visitor, MoveGoal, { cell: stay.cell });
}

/**
 * The summon-and-escort half of the visit: book animals onto workplaces, then re-aim every booked animal
 * still outside at the door, or drop it where it stands when its workplace is gone. Runs after regen, so
 * a topped-up animal qualifies the same tick, and before production, which admits arrived visitors.
 */
export const livestockVisitSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  summonToWorkplaces(world, ctx);
  for (const e of [...world.query(Livestock, LivestockVisit, Position)]) {
    const building = world.get(e, LivestockVisit).at;
    const b = world.tryGet(building, Building);
    if (b === undefined || b.built < ONE) {
      world.remove(e, LivestockVisit);
      stepOut(world, e);
      continue;
    }
    if (isInside(world, e, building)) continue; // admitted - the batch owns it until release
    if (terrain === undefined) continue; // mapless sim: no door to reach
    const door = interactionNodeId(world, ctx, terrain, building);
    if (door === null) continue;
    if (entityNode(world, terrain, e) === door) continue; // arrived - waits for its batch to begin
    if (!isTravelling(world, e) && !world.has(e, CurrentAtomic)) {
      world.add(e, MoveGoal, { cell: door });
    }
  }
};
