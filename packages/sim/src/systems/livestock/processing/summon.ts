import type { Recipe } from '@open-northland/data';
import {
  Building,
  CurrentAtomic,
  Frightened,
  Health,
  Livestock,
  LivestockVisit,
  MoveGoal,
  ownerOf,
  Person,
  Position,
  Production,
  Settler,
  Stockpile,
} from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { interactionNodeId } from '../../footprint/interaction.js';
import { recipeOutputsEnabled } from '../../progression/index.js';
import { isLivestockWorkplaceType, livestockTribeFedBy } from '../../readviews/index.js';
import { manhattan } from '../../spatial/metric.js';
import { canonicalById, entityNode, NodeBuckets } from '../../spatial/nodes.js';
import {
  operatorCountOf,
  operatorSlotCapacity,
  presentOperators,
  recipesByProductOf,
} from '../../stores/index.js';
import { canPayVisitLife } from './life-cost.js';
import { hasVisitor, unadmittedVisitorCount, unadmittedVisitorsOf } from './roster.js';

/** Node-Manhattan pen radius around the workplace door within which an animal counts as penned; covers
 *  the cow's 20-node stay-point leash, the widest livestock territory, with slack. Named approximation. */
export const LIVESTOCK_PROCESS_RANGE_NODES = 32;

/**
 * Book animals onto workplaces - one visitor per species across the whole visit, and only when the batch
 * could begin the moment it arrives, so no animal stands at the door reading as blocked. A stocked output
 * token means the seat's next batch is the conversion rather than another feed, which paces feeding to
 * the farm's real throughput, and a booked animal owns its operator seat until the batch starts.
 */
export function summonToWorkplaces(world: World, ctx: SystemContext): void {
  // Shared lazily across farms: built only when a farm passes every cheap gate (most ticks none does).
  let operatorsByNode: NodeBuckets | undefined;
  for (const building of canonicalById(world.query(Building, Stockpile))) {
    const b = world.get(building, Building);
    if (b.built < ONE || !isLivestockWorkplaceType(ctx.content, b.buildingType)) continue;
    const stock = world.get(building, Stockpile).amounts;
    const recipes = recipesByProductOf(world, ctx, building);
    if (recipes === undefined) continue;
    // Declared seats first: an upper bound on the on-station count, so a fully busy farm answers no
    // summon without paying for the settler node index the exact count needs.
    if (spareSeats(world, building, operatorSlotCapacity(world, ctx, building)) <= 0) continue;
    let seatsLeft: number | null = null;
    for (const recipe of recipes.values()) {
      const tribe = livestockTribeFedBy(ctx.content, recipe);
      if (tribe === null) continue;
      if (!inputsOnHand(stock, recipe)) continue;
      const token = recipe.outputs[0]?.goodType;
      if (token !== undefined && (stock.get(token) ?? 0) > 0) continue; // backlog first
      if (token !== undefined && !tokenConsumable(world, ctx, b.tribe, token, recipes)) continue;
      if (hasVisitor(world, building, tribe)) continue;
      if (!recipeOutputsEnabled(world, ctx, b.tribe, recipe)) continue;
      // Pen scan before the seat read: the scan walks the small Livestock store, while the seat count
      // needs the settler node index, which an empty pen never builds.
      const best = feedAnimalPick(world, ctx, building, tribe);
      if (best === null) continue;
      if (seatsLeft === null) {
        operatorsByNode ??= new NodeBuckets(world, canonicalById(world.query(Person, Position)));
        seatsLeft = spareSeats(
          world,
          building,
          operatorCountOf(presentOperators(world, ctx, building, operatorsByNode)),
        );
      }
      if (seatsLeft <= 0) continue;
      world.add(best, LivestockVisit, { at: building });
      walkToDoor(world, ctx, building, best);
      seatsLeft -= 1;
    }
  }
}

/** The booked-but-outside visitors whose feed could still start on arrival - the seats the production
 *  holdback must keep open. A visitor whose inputs were consumed mid-walk holds no seat. */
export function heldSeatCount(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): number {
  const stock = world.get(building, Stockpile).amounts;
  let held = 0;
  for (const e of unadmittedVisitorsOf(world, building)) {
    if (world.has(e, Frightened)) continue; // scattered, so not arriving this batch: see ./roster.ts
    const recipe = feedRecipeOfTribe(ctx, recipes, world.get(e, Settler).tribe);
    if (recipe === undefined || !inputsOnHand(stock, recipe)) continue;
    held += 1;
  }
  return held;
}

function inputsOnHand(stock: ReadonlyMap<number, number>, recipe: Recipe): boolean {
  return recipe.inputs.every((i) => (stock.get(i.goodType) ?? 0) >= i.amount);
}

function feedRecipeOfTribe(
  ctx: SystemContext,
  recipes: ReadonlyMap<number, Recipe>,
  tribe: number,
): Recipe | undefined {
  for (const recipe of recipes.values()) {
    if (livestockTribeFedBy(ctx.content, recipe) === tribe) return recipe;
  }
  return undefined;
}

/** Whether any recipe of this workplace both consumes `token` and has its outputs tech-unlocked. A feed
 *  whose whole chain is locked is not worth an animal's life. A summon-only gate: a chain whose enabler
 *  dies mid-walk still runs its one arrived batch, and the stranded token then blocks further summons. */
function tokenConsumable(
  world: World,
  ctx: SystemContext,
  tribe: number,
  token: number,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  for (const recipe of recipes.values()) {
    if (!recipe.inputs.some((i) => i.goodType === token)) continue;
    if (recipeOutputsEnabled(world, ctx, tribe, recipe)) return true;
  }
  return false;
}

/** Seats a new visit could still claim out of `seats` on offer, minus the batches already grinding and
 *  the visitors already booked. Passing the type's declared seats bounds the answer from above. */
function spareSeats(world: World, building: Entity, seats: number): number {
  const running = world.tryGet(building, Production)?.cycles.length ?? 0;
  return seats - running - unadmittedVisitorCount(world, building);
}

/**
 * The summon pick from one pass over the {@link Livestock} store: highest HP, then lowest id, an explicit
 * tuple compare so raw query order cannot change the winner. A mapless sim skips the pen check, having no
 * door to measure from, and an unowned workplace accepts any animal in range, which is what lets a
 * neutral scenario fixture work while an owned farm never milks wild stock.
 */
function feedAnimalPick(world: World, ctx: SystemContext, building: Entity, tribe: number): Entity | null {
  const terrain = ctx.terrain;
  const door = terrain === undefined ? null : interactionNodeId(world, ctx, terrain, building);
  const buildingOwner = ownerOf(world, building);
  let best: Entity | null = null;
  let bestHp = -1;
  for (const e of world.query(Livestock, Settler, Health, Position)) {
    if (world.get(e, Settler).tribe !== tribe) continue;
    if (world.has(e, LivestockVisit)) continue;
    if (buildingOwner !== undefined && ownerOf(world, e) !== buildingOwner) continue;
    const h = world.get(e, Health);
    if (!canPayVisitLife(h)) continue;
    if (terrain !== undefined && door !== null) {
      const node = entityNode(world, terrain, e);
      if (manhattan(terrain, node, door) > LIVESTOCK_PROCESS_RANGE_NODES) continue;
      // Across water from the door it could never arrive: booking it would wedge the species slot and
      // hold an operator seat open forever, since the escort re-aims a refused walk indefinitely.
      if (terrain.componentOf(node) !== terrain.componentOf(door)) continue;
    }
    if (h.hitpoints > bestHp || (h.hitpoints === bestHp && (best === null || e < best))) {
      best = e;
      bestHp = h.hitpoints;
    }
  }
  return best;
}

/** Aim a freshly summoned animal at the workplace door, skipped mid-atomic so a running action is not
 *  yanked; the visit system re-aims it every tick after. */
function walkToDoor(world: World, ctx: SystemContext, building: Entity, e: Entity): void {
  if (ctx.terrain === undefined || world.has(e, CurrentAtomic)) return;
  const door = interactionNodeId(world, ctx, ctx.terrain, building);
  if (door !== null) world.add(e, MoveGoal, { cell: door });
}
