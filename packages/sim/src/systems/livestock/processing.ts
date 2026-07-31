import type { Recipe } from '@open-northland/data';
import {
  CurrentAtomic,
  Health,
  Livestock,
  MoveGoal,
  ownerOf,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { livestockTribeOfGood } from '../readviews/index.js';
import { entityNode, manhattan } from '../spatial/nodes.js';

// The processing side of husbandry: a FEED recipe (grain+water -> the species' fed-animal good) runs
// only against a live penned animal, which pays for the cycle with part of its life. Consumed by the
// ProductionSystem's cycle gate/start (economy/production/cycles.ts). Source basis: the recipes and
// the animal-as-good model are the extracted content; the drain amount, life floor, and pen radius
// are named approximations (no readable constant exists for any of them).

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
 * How many cycles of `recipe` the penned livestock could pay for right now - `Infinity` for a non-feed
 * recipe (no animal requirement), else the count of eligible animals. An upper bound, not a strict
 * one-batch-per-animal pairing: each start re-drains and re-scans, so a full-pool animal can pay for
 * two same-tick batches before the life floor stops it. The livestock leg of `startableCycleCount`'s
 * gate.
 */
export function feedAnimalsAvailable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): number {
  const tribe = feedTribeOf(ctx, recipe);
  if (tribe === null) return Number.POSITIVE_INFINITY;
  return scanFeedAnimals(world, ctx, building, tribe).count;
}

/**
 * Pay a starting feed cycle's life cost, or report that nothing can pay it. A non-feed recipe charges
 * nothing (true). A feed recipe drains {@link LIVESTOCK_PROCESS_DRAIN_HP} from the canonical pick -
 * the healthiest eligible animal (ties to the lowest id; order-independent, so no sort) - and walks it
 * to the workplace door (the original's animal-enters-the-farm read; skipped mid-atomic so a swing
 * isn't yanked). False when no animal is eligible - the caller must not begin the batch.
 */
export function chargeLivestockForCycle(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipe: Recipe,
): boolean {
  const tribe = feedTribeOf(ctx, recipe);
  if (tribe === null) return true;
  const { best } = scanFeedAnimals(world, ctx, building, tribe);
  if (best === null) return false;
  world.write(best, Health, (h) => {
    h.hitpoints -= LIVESTOCK_PROCESS_DRAIN_HP;
  });
  if (ctx.terrain !== undefined && !world.has(best, CurrentAtomic)) {
    const door = interactionNodeId(world, ctx, ctx.terrain, building);
    if (door !== null) world.add(best, MoveGoal, { cell: door });
  }
  return true;
}

/**
 * One pass over the {@link Livestock} store (the herd, never the settler population): the
 * eligible-animal count and the canonical drain pick (highest HP, then lowest id - an explicit tuple
 * compare, so raw query order cannot change the winner). Eligible means: the species' live creature,
 * above the life floor after the drain, penned within {@link LIVESTOCK_PROCESS_RANGE_NODES} of the
 * door (skipped in a mapless sim - no distance to measure), and - at an owned workplace - claimed by
 * the same player (a neutral scenario fixture accepts any animal in range; an owned farm never milks
 * wild or enemy stock).
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
