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

// The processing side of husbandry, staged as a VISIT the player can watch: the workplace SUMMONS one
// penned animal per species (it walks to the door and waits there), the feed batch begins only once it
// has ARRIVED (the animal steps in with the starting operator - until then the feed recipe is not
// startable, so an idle breeder waits outside too), and the completing batch lets it out with part of
// its life paid. Consumed by the ProductionSystem's cycle gate/start/deposit
// (economy/production/cycles.ts). Source basis: the recipes and the animal-as-good model are the
// extracted content; the visit staging is a named approximation, as is each constant it needs - no
// readable constant exists for any of them.

export { LIVESTOCK_MIN_LIFE_DIVISOR, LIVESTOCK_PROCESS_DRAIN_HP } from './processing/life-cost.js';
export { heldSeatCount, LIVESTOCK_PROCESS_RANGE_NODES } from './processing/summon.js';

/**
 * How many batches of `recipe` could begin right now - `Infinity` for a non-feed recipe (no animal
 * requirement), else the count of summoned animals arrived at the door. The livestock leg of
 * `startableCycleCount`'s gate: a feed batch never starts against an animal still walking, so the
 * enter-together read holds.
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
 * Step the starting feed batch's animal inside, or report that none has arrived. A non-feed recipe
 * admits nothing (true). A feed recipe steps its canonical arrived visitor in through the indoors
 * seam - it enters together with the operator whose seat opened on the same arrival - and the batch's
 * completion releases it ({@link releaseLivestockVisit}). False when no visitor stands at the door -
 * the caller must not begin the batch.
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
  // Full nav clear, not just the goal: an animal can count as arrived while its final path leg is
  // still live (entityNode rounds to the door node), and an admitted body must hold no walk.
  clearNavState(world, pick);
  stepIn(world, pick, building);
  return true;
}

/**
 * Let the completed feed batch's visitor out: its canonical admitted animal steps out, pays the visit's
 * {@link visitLifeCost}, and walks straight back to its grazing spot rather than standing in the doorway
 * until the next herding sweep. A batch whose visitor vanished mid-cycle (died inside) releases nobody
 * and charges nothing - an accepted free batch on a rare edge.
 */
export function releaseLivestockVisit(world: World, building: Entity, tribe: number): void {
  const visitor = canonicalAdmittedVisitor(world, building, tribe);
  if (visitor === null) return;
  if (world.has(visitor, Health)) {
    world.write(visitor, Health, (h) => {
      h.hitpoints -= visitLifeCost(h);
    });
  }
  world.remove(visitor, LivestockVisit);
  stepOut(world, visitor);
  const stay = world.tryGet(visitor, StayPoint);
  if (stay !== undefined) world.add(visitor, MoveGoal, { cell: stay.cell });
}

/**
 * LivestockVisitSystem - the summon-and-escort half of the visit: books animals onto workplaces
 * ({@link summonToWorkplaces} - the one-visitor-per-species rule lives there), then escorts every
 * booked animal still outside (re-aimed at the door - self-healing against a refused route) or drops
 * it where it stands when its workplace is gone. Runs after regen, so a topped-up animal qualifies
 * the same tick, and before production, which admits arrived visitors into starting batches. Scale:
 * one pass over buildings with a cheap type check, plus the booked-visitor store.
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
