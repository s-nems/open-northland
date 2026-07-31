import type { Recipe } from '@open-northland/data';
import {
  Building,
  CurrentAtomic,
  Health,
  Livestock,
  LivestockVisit,
  MoveGoal,
  ownerOf,
  Position,
  Resting,
  Settler,
  StayPoint,
  Stockpile,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { isLivestockWorkplaceType, livestockTribeOfGood } from '../readviews/index.js';
import { isInside, stepIn, stepOut } from '../settlers/indoors.js';
import { clearNavState, entityNode, isTravelling, manhattan } from '../spatial/nodes.js';
import { recipesByProductOf } from '../stores/index.js';

// The processing side of husbandry, staged as a VISIT the player can watch: the workplace SUMMONS one
// penned animal per species (it walks to the door and waits there), the feed batch begins only once it
// has ARRIVED (the animal steps in with the starting operator - until then the feed recipe is not
// startable, so an idle breeder waits outside too), and the completing batch lets it out with part of
// its life paid. Consumed by the ProductionSystem's cycle gate/start/deposit
// (economy/production/cycles.ts). Source basis: the recipes and the animal-as-good model are the
// extracted content; the visit staging, drain amount, life floor, and pen radius are named
// approximations (no readable constant exists for any of them).

/** HP one processing visit drains - a quarter of the sheep/cow 1000-HP pool, so an animal sustains two
 *  visits before the life floor makes it graze and regenerate. */
export const LIVESTOCK_PROCESS_DRAIN_HP = 250;

/** The life floor: a visit may never leave the animal below half its pool (`floor(max/2)`), so
 *  processing is non-lethal (observed original behaviour; the exact floor is approximated). */
export const LIVESTOCK_MIN_LIFE_DIVISOR = 2;

/** Node-Manhattan pen radius around the workplace door within which an animal counts as penned -
 *  covers the cow's 20-node stay-point leash (the widest livestock territory) with slack. */
export const LIVESTOCK_PROCESS_RANGE_NODES = 32;

/** The livestock species `recipe` feeds, or null for an ordinary (non-feed) recipe. */
function feedTribeOf(ctx: SystemContext, recipe: Recipe): number | null {
  const product = recipe.outputs[0]?.goodType;
  return product === undefined ? null : livestockTribeOfGood(ctx.content, product);
}

/**
 * How many batches of `recipe` could begin right now - `Infinity` for a non-feed recipe (no animal
 * requirement), else the count of summoned animals ARRIVED at the door ({@link arrivedVisitors}).
 * The livestock leg of `startableCycleCount`'s gate: a feed batch never starts against an animal
 * still walking, so the enter-together read holds.
 */
export function feedAnimalsAvailable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  const tribe = feedTribeOf(ctx, recipe);
  if (tribe === null) return Number.POSITIVE_INFINITY;
  return arrivedVisitors(world, ctx, building, tribe).length;
}

/**
 * Step the starting feed batch's animal inside, or report that none has arrived. A non-feed recipe
 * admits nothing (true). A feed recipe steps the canonical arrived visitor (lowest id) in through the
 * indoors seam - it enters together with the operator whose seat opened on the same arrival - and the
 * batch's completion releases it ({@link releaseLivestockVisit}). False when no visitor stands at the
 * door - the caller must not begin the batch.
 */
export function admitLivestockForCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): boolean {
  const tribe = feedTribeOf(ctx, recipe);
  if (tribe === null) return true;
  let pick: Entity | null = null;
  for (const e of arrivedVisitors(world, ctx, building, tribe)) {
    if (pick === null || e < pick) pick = e;
  }
  if (pick === null) return false;
  // Full nav clear, not just the goal: an animal can count as arrived while its final path leg is
  // still live (entityNode rounds to the door node), and an admitted body must hold no walk.
  clearNavState(world, pick);
  stepIn(world, pick, building);
  return true;
}

/**
 * Let the completed feed batch's visitor out: the canonical (lowest-id) {@link LivestockVisit} holder
 * INSIDE this workplace ({@link Resting}) steps out, pays the visit's life cost, clamped so the drain
 * never takes it below the life floor (its HP may have moved since admission: regen, or a fight), and
 * walks straight back to its grazing spot rather than standing in the doorway until the next herding
 * sweep. A batch whose visitor vanished mid-cycle (died inside) releases nobody and charges nothing -
 * an accepted free batch on a rare edge.
 */
export function releaseLivestockVisit(world: World, building: Entity, tribe: number): void {
  let visitor: Entity | null = null;
  for (const e of world.query(LivestockVisit, Settler)) {
    if (world.get(e, LivestockVisit).at !== building) continue;
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (!world.has(e, Resting)) continue;
    if (visitor === null || e < visitor) visitor = e;
  }
  if (visitor === null) return;
  const paying = visitor;
  if (world.has(paying, Health)) {
    world.write(paying, Health, (h) => {
      const floor = Math.floor(h.max / LIVESTOCK_MIN_LIFE_DIVISOR);
      h.hitpoints -= Math.min(LIVESTOCK_PROCESS_DRAIN_HP, Math.max(0, h.hitpoints - floor));
    });
  }
  world.remove(paying, LivestockVisit);
  stepOut(world, paying);
  const stay = world.tryGet(paying, StayPoint);
  if (stay !== undefined) world.add(paying, MoveGoal, { cell: stay.cell });
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

/** One visitor per species and workplace, across the WHOLE visit (summoned or already admitted): book
 *  the canonical pen pick for each input-stocked feed recipe with no live visitor. The next animal is
 *  called only after the current batch releases its one - during a batch the doorway stays empty
 *  instead of queueing the successor there for the batch's whole length (user feedback: animals stood
 *  in the door for no visible reason). */
function summonToWorkplaces(world: World, ctx: SystemContext): void {
  for (const building of world.query(Building, Stockpile)) {
    const b = world.get(building, Building);
    if (b.built < ONE || !isLivestockWorkplaceType(ctx.content, b.buildingType)) continue;
    const stock = world.get(building, Stockpile).amounts;
    const recipes = recipesByProductOf(world, ctx, building);
    if (recipes === undefined) continue;
    for (const recipe of recipes.values()) {
      const tribe = feedTribeOf(ctx, recipe);
      if (tribe === null) continue;
      if (!recipe.inputs.every((i) => (stock.get(i.goodType) ?? 0) >= i.amount)) continue;
      if (hasVisitor(world, building, tribe)) continue;
      const { best } = scanFeedAnimals(world, ctx, building, tribe);
      if (best === null) continue;
      world.add(best, LivestockVisit, { at: building });
      walkToDoor(world, ctx, building, best);
    }
  }
}

/** Whether any visitor of this species - walking, waiting at the door, or admitted inside - already
 *  belongs to the workplace. */
function hasVisitor(world: World, building: Entity, tribe: number): boolean {
  for (const e of world.query(LivestockVisit, Settler)) {
    if (world.get(e, LivestockVisit).at !== building) continue;
    if (world.get(e, Settler).tribe === tribe) return true;
  }
  return false;
}

/** The workplace's summoned visitors of `tribe` standing ON the door (not yet admitted) - the animals
 *  a feed batch may begin against. In a mapless sim every waiting visitor counts as arrived. */
function arrivedVisitors(world: World, ctx: SystemContext, building: Entity, tribe: number): Entity[] {
  const terrain = ctx.terrain;
  const door = terrain === undefined ? null : interactionNodeId(world, ctx, terrain, building);
  const arrived: Entity[] = [];
  for (const e of world.query(LivestockVisit, Settler)) {
    if (world.get(e, LivestockVisit).at !== building) continue;
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, Resting)) continue;
    if (terrain !== undefined && door !== null && entityNode(world, terrain, e) !== door) continue;
    arrived.push(e);
  }
  return arrived;
}

/** Aim a freshly summoned animal at the workplace door (skipped mid-atomic so a swing isn't yanked;
 *  {@link livestockVisitSystem} re-aims it every tick after). */
function walkToDoor(world: World, ctx: SystemContext, building: Entity, e: Entity): void {
  if (ctx.terrain === undefined || world.has(e, CurrentAtomic)) return;
  const door = interactionNodeId(world, ctx, ctx.terrain, building);
  if (door !== null) world.add(e, MoveGoal, { cell: door });
}

/**
 * One pass over the {@link Livestock} store (the herd, never the settler population): the
 * eligible-animal count and the canonical summon pick (highest HP, then lowest id - an explicit tuple
 * compare, so raw query order cannot change the winner). Eligible means: the species' live creature,
 * not already summoned ({@link LivestockVisit}), above the life floor after the coming drain, penned
 * within {@link LIVESTOCK_PROCESS_RANGE_NODES} of the door (skipped in a mapless sim - no distance to
 * measure), and - at an owned workplace - claimed by the same player (a neutral scenario fixture
 * accepts any animal in range; an owned farm never milks wild or enemy stock).
 */
function scanFeedAnimals(
  world: World,
  ctx: SystemContext,
  building: Entity,
  tribe: number,
): { best: Entity | null; count: number } {
  const terrain = ctx.terrain;
  const door = terrain === undefined ? null : interactionNodeId(world, ctx, terrain, building);
  const buildingOwner = ownerOf(world, building);
  let best: Entity | null = null;
  let bestHp = -1;
  let count = 0;
  for (const e of world.query(Livestock, Settler, Health, Position)) {
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, LivestockVisit)) continue;
    if (buildingOwner !== undefined && ownerOf(world, e) !== buildingOwner) continue;
    const h = world.get(e, Health);
    if (h.hitpoints - LIVESTOCK_PROCESS_DRAIN_HP < Math.floor(h.max / LIVESTOCK_MIN_LIFE_DIVISOR)) continue;
    if (terrain !== undefined && door !== null) {
      if (manhattan(terrain, entityNode(world, terrain, e), door) > LIVESTOCK_PROCESS_RANGE_NODES) continue;
    }
    count += 1;
    if (h.hitpoints > bestHp || (h.hitpoints === bestHp && (best === null || e < best))) {
      best = e;
      bestHp = h.hitpoints;
    }
  }
  return { best, count };
}
