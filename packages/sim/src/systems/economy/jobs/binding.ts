import type { Recipe } from '@open-northland/data';
import {
  Building,
  GraduateWait,
  JobAssignment,
  ProductionCounters,
  Settler,
  writeProductionGoods,
} from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isWorkplaceOperator } from '../../stores/operators.js';
import { removeWorkFlag, syncWorkFlagToJob } from '../work-flag.js';

/**
 * Bind `e` to `workplace` and retire what the previous employment owned: a collector bound to a building
 * banks into its stock instead of a flag yard, and production counters set at another post would
 * mis-steer this one, which offers a different product and store set. A craft operator starts on the
 * workplace's first product, or on the `preferred` goods it makes ({@link startOnProducts}).
 */
export function bindEmployment(
  world: World,
  ctx: SystemContext,
  e: Entity,
  workplace: Entity,
  preferred: readonly number[] = [],
): void {
  world.add(e, JobAssignment, { workplace });
  world.remove(e, GraduateWait); // a posted graduate stops waiting by its school
  removeWorkFlag(world, e);
  world.remove(e, ProductionCounters);
  startOnProducts(world, ctx, e, workplace, preferred);
}

/**
 * Original behavior: a fresh hire makes its workplace's first product, unlimited, and every other one is
 * stopped at `0`. The explicit stops keep a product the operator earns later stopped until the player
 * picks it; an upgrade stops the products it adds the same way. Authored: the `preferred` goods the
 * workplace makes, when there are any, take the first product's place.
 */
function startOnProducts(
  world: World,
  ctx: SystemContext,
  e: Entity,
  workplace: Entity,
  preferred: readonly number[],
): void {
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null) return;
  const products = operatorProducts(world, ctx, workplace, jobType);
  if (products === undefined || products.size < 2) return;
  const chosen = preferred.filter((good) => products.has(good));
  const [first] = products.keys();
  if (chosen.length === 0 && first !== undefined) chosen.push(first);
  if (chosen.length > 0) writeProductionGoods(world, e, products.keys(), new Set(chosen));
}

/** The per-product recipes a `jobType` operator crafts at `workplace`; undefined when it operates none. */
function operatorProducts(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  jobType: number,
): ReadonlyMap<number, Recipe> | undefined {
  const buildingType = world.tryGet(workplace, Building)?.buildingType;
  if (buildingType === undefined || !isWorkplaceOperator(world, ctx, workplace, jobType)) return undefined;
  return contentIndex(ctx.content).recipeByProductByBuilding.get(buildingType);
}

/** Whether a `jobType` operator at `workplace` crafts any of `goods`. */
export function craftsAnyAt(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  jobType: number,
  goods: readonly number[],
): boolean {
  const products = operatorProducts(world, ctx, workplace, jobType);
  return products !== undefined && goods.some((good) => products.has(good));
}

/**
 * Unbind `e` from its workplace and give back what the post had taken over: a gathering trade gets a flag
 * yard at its feet again, and the counters die with the employment they were set under. The exact inverse
 * of {@link bindEmployment}, so the player's release order and a razed workplace leave a settler in one
 * state.
 *
 * The counters go with this binding, so a later post never inherits them.
 */
export function releaseEmployment(world: World, ctx: SystemContext, e: Entity): void {
  world.remove(e, JobAssignment);
  const jobType = world.tryGet(e, Settler)?.jobType;
  if (jobType != null) syncWorkFlagToJob(world, ctx, e, jobType);
  world.remove(e, ProductionCounters);
}
