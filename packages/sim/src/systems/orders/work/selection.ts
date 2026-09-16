import {
  Building,
  CraftSelection,
  CurrentAtomic,
  GatherSelection,
  JobAssignment,
  Settler,
  WorkFlag,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import { positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import {
  bindFreshFlag,
  jobCanHarvest,
  jobCanHarvestGood,
  jobUsesWorkFlag,
  liveWorkFlag,
  relocateWorkFlag,
} from '../../economy/work-flag.js';
import { nearestWorkFlagPlacement } from '../../footprint/index.js';
import { clearNavState } from '../../movement/nav-state.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { workplaceStocksGood, workplaceStoredGoods } from '../../stores/index.js';
import { isOrderableSettler } from '../guards.js';

/**
 * How far {@link setWorkFlag} snaps a click that landed on a blocked node, in half-cell nodes. Past this
 * the click counts as "not workable ground" rather than silently relocating the gatherer's yard.
 * Approximation: the original's click tolerance is not decoded, and 3 tiles sits well inside the default
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

  if (live !== undefined) {
    relocateWorkFlag(world, live.flag, pos, e);
    return;
  }
  bindFreshFlag(world, ctx, e, pos);
  clearNavState(world, e);
}

/** Set a gatherer's resource filter. Flag-bound: {@link WorkFlag.goodType} (`null` = every map good
 * its job may harvest). Flag-less but employed at a stocking building: {@link GatherSelection}, valid
 * only for a good the workplace stores (`null` = every stored good). Changing the filter abandons a stale
 * harvest route immediately. */
export function setGatherGood(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setGatherGood' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  const settler = world.get(e, Settler);
  if (settler.jobType === null || !jobCanHarvest(ctx, settler.jobType)) return;
  const goodType = command.goodType;
  if (goodType !== null && !jobCanHarvestGood(ctx, settler.jobType, goodType)) return;
  const flag = liveWorkFlag(world, e);
  if (flag !== undefined) {
    const binding = world.mut(e, WorkFlag);
    if (goodType === null) delete binding.goodType;
    else binding.goodType = goodType;
  } else {
    // An employed gatherer forages only for its workplace, so the pick must be a good that workplace
    // stockpiles, judged by the same test the gatherer drive filters on.
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace === undefined || !world.isAlive(workplace)) return;
    if (goodType === null) {
      world.remove(e, GatherSelection); // back to every stored good
    } else {
      const stored = workplaceStoredGoods(world, ctx, workplace);
      if (stored === undefined || !workplaceStocksGood(ctx, stored, goodType)) return;
      if (!world.has(e, GatherSelection)) {
        world.add(e, GatherSelection, { goodType });
      } else {
        world.mut(e, GatherSelection).goodType = goodType;
      }
    }
  }
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic?.effect.kind === 'harvest') world.remove(e, CurrentAtomic);
  clearNavState(world, e);
}

/**
 * Set a craft worker's product selection - see the command doc. The selection is stored ascending and
 * deduped, so the rotation order is by goodType rather than click order. A batch already grinding keeps its
 * product, so the choice applies from the next cycle start.
 */
export function setCraftGoods(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setCraftGoods' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  const workplace = world.tryGet(e, JobAssignment)?.workplace;
  if (workplace === undefined) return;
  const buildingType = world.tryGet(workplace, Building)?.buildingType;
  if (buildingType === undefined) return;
  const recipes = contentIndex(ctx.content).recipeByProductByBuilding.get(buildingType);
  if (recipes === undefined) return; // not a recipe workplace - nothing to choose
  if (command.goods.length === 0) {
    world.remove(e, CraftSelection); // back to the all-products default
    return;
  }
  const goods = [...new Set(command.goods)].filter((g) => recipes.has(g)).sort((a, b) => a - b);
  if (goods.length === 0) return; // named nothing this workplace makes
  if (!world.has(e, CraftSelection)) {
    world.add(e, CraftSelection, { goods, cursor: 0 });
  } else {
    const selection = world.mut(e, CraftSelection);
    selection.goods = goods;
    selection.cursor = 0;
  }
}
