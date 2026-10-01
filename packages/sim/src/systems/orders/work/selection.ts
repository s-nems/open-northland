import {
  Building,
  CurrentAtomic,
  HarvestFocus,
  JobAssignment,
  PRODUCTION_UNLIMITED,
  ProductionCounters,
  removeCurrentAtomic,
  Settler,
  writeProductionCount,
  writeProductionGoods,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { holdToGatherGood, jobGatherGoods, jobGathersGood } from '../../economy/gather-goods.js';
import { bindFreshFlag, jobUsesWorkFlag, liveWorkFlag, relocateWorkFlag } from '../../economy/work-flag.js';
import { nearestWorkFlagPlacement } from '../../footprint/index.js';
import { clearNavState } from '../../movement/nav-state.js';
import { jobChangesProduction } from '../../readviews/jobs.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { workplaceStocksGood, workplaceStoredGoods } from '../../stores/index.js';
import { isOrderableSettler } from '../guards.js';

/**
 * How far {@link setWorkFlag} snaps a click that landed on a blocked node, in half-cell nodes. Past this
 * the click counts as "not workable ground" rather than silently relocating the gatherer's yard.
 * Approximation: the original's click tolerance is unknown, and 3 tiles sits well inside the default
 * work-flag radius.
 */
const WORK_FLAG_SNAP_MAX_RADIUS = 6;

/**
 * Place or move one unposted gatherer/fisher flag to node (x,y) - see the command doc. An existing flag is
 * relocated and only the marker moves, because a flag stores nothing and the goods already dropped stay
 * pinned to their tiles; otherwise a fresh flag is minted there and bound with the trade's radius. A
 * building-employed collector has no delivery flag: its workplace is both its work anchor and sink.
 *
 * The clicked node snaps to the nearest legal one within {@link WORK_FLAG_SNAP_MAX_RADIUS}, so "work this
 * iron mine" lands on the ore itself. The snap carries the settler's signpost confinement, so the flag can
 * only land on ground that settler may work. The order on any other trade is a no-op rather than a stray
 * flag.
 */
export function setWorkFlag(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setWorkFlag' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no cells to plant a flag on
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (world.has(e, JobAssignment)) return;
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobUsesWorkFlag(ctx, jobType)) return;

  const live = liveWorkFlag(world, e);
  // Confinement folds into the snap rather than filtering its winner, so a click near the band edge snaps
  // inward to allowed ground instead of being pushed out and then rejected.
  const limit = navigationLimitFor(world, ctx.content, terrain, e);
  // The clicked node is the search's own first candidate, so an unblocked click resolves to itself.
  const target = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y), {
    ignoreFlag: live?.flag,
    ...(limit !== null ? { accept: (node) => limit.allowsNode(node) } : {}),
    withinRadius: WORK_FLAG_SNAP_MAX_RADIUS,
  });
  if (target === null) return; // nothing legal in snapping range - the click was not on workable ground
  const c = terrain.coordsOf(target);
  const pos = positionOfNode(c.x, c.y);

  // A moved flag restarts the search from it: the node being approached may lie outside the new radius.
  if (world.has(e, HarvestFocus)) world.remove(e, HarvestFocus);
  if (live !== undefined) {
    relocateWorkFlag(world, live.flag, pos, e);
    return;
  }
  bindFreshFlag(world, ctx, e, pos);
  clearNavState(world, e);
}

/**
 * Hold a gatherer to one good, or with `null` release it to every good - see the command doc. The pick
 * writes the counters {@link holdToGatherGood} describes. An employed gatherer forages only for its
 * workplace, so its pick must be a good that workplace stocks, judged by the same test the gatherer drive
 * filters on. Changing the pick abandons a stale harvest route immediately.
 */
export function setGatherGood(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setGatherGood' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobChangesProduction(ctx.content, jobType)) return;
  if (jobGatherGoods(ctx, jobType).length === 0) return;
  const goodType = command.goodType;
  if (goodType !== null && !jobGathersGood(ctx, jobType, goodType)) return;
  if (goodType !== null && liveWorkFlag(world, e) === undefined) {
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace !== undefined) {
      if (!world.isAlive(workplace)) return;
      const stored = workplaceStoredGoods(world, ctx, workplace);
      if (stored === undefined || !workplaceStocksGood(ctx, stored, goodType)) return;
    }
  }
  holdToGatherGood(world, ctx, e, jobType, goodType);
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic?.effect.kind === 'harvest' || atomic?.effect.kind === 'harvestFollowThrough') {
    removeCurrentAtomic(world, e);
  }
  if (world.has(e, HarvestFocus)) world.remove(e, HarvestFocus);
  clearNavState(world, e);
}

/**
 * The goods `e`'s production counters name, or undefined when `e` is no orderable worker with any: a
 * gathering trade's goods, else the recipe products of its workplace. The gather list wins, since such a
 * trade runs the gatherer drive, never the craft loop. A trade the player cannot set the production of
 * names none.
 */
function productionGoodsOf(world: World, ctx: SystemContext, e: Entity): readonly number[] | undefined {
  if (!isOrderableSettler(world, e)) return undefined;
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobChangesProduction(ctx.content, jobType)) return undefined;
  const gathered = jobGatherGoods(ctx, jobType);
  if (gathered.length > 0) return gathered;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace === undefined) return undefined;
  const buildingType = world.tryGet(workplace, Building)?.buildingType;
  if (buildingType === undefined) return undefined;
  const products = contentIndex(ctx.content).recipeByProductByBuilding.get(buildingType);
  return products === undefined ? undefined : [...products.keys()];
}

/**
 * Make only the listed goods, each unlimited, and stop every other one - see the command doc. An empty
 * list removes the counters, so every good is unlimited again. The craft rotation restarts at its first
 * product; a batch already grinding keeps its product and a stroke already swinging lands, so the choice
 * applies from the next cycle start or harvest pick.
 */
export function setProductionGoods(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setProductionGoods' }>,
): void {
  const e = command.entity;
  const goods = productionGoodsOf(world, ctx, e);
  if (goods === undefined) return; // nothing to choose
  if (command.goods.length === 0) {
    world.remove(e, ProductionCounters); // every good unlimited
    return;
  }
  const listed = new Set(command.goods.filter((g) => goods.includes(g)));
  if (listed.size === 0) return; // named nothing this worker makes
  writeProductionGoods(world, e, goods, listed);
}

/** Set how many more units of one good a worker makes or gathers - see the command doc. */
export function setProductionCount(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setProductionCount' }>,
): void {
  const e = command.entity;
  const goods = productionGoodsOf(world, ctx, e);
  if (goods === undefined || !goods.includes(command.goodType)) return;
  const count = Math.min(Math.max(command.count, 0), PRODUCTION_UNLIMITED);
  writeProductionCount(world, e, command.goodType, count);
}
