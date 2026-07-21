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
  liveWorkFlag,
  relocateWorkFlag,
} from '../../economy/flags.js';
import { nearestWorkFlagPlacement } from '../../footprint/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { clearNavState } from '../../spatial.js';
import { workplaceStoredGoods } from '../../stores/index.js';
import { isOrderableSettler } from '../guards.js';

/**
 * How far {@link setWorkFlag} snaps a click that landed on a blocked node. Sized to clear the body under
 * the cursor — a resource cluster or a building — while keeping the flag where the player pointed: past
 * this the click is treated as "not workable ground" rather than silently relocating the gatherer's yard.
 * Named approximation: the original's click tolerance is not decoded, and 3 tiles sits well inside
 * {@link DEFAULT_WORK_FLAG_RADIUS}, so a snapped flag still covers the patch the player aimed at.
 */
const WORK_FLAG_SNAP_MAX_RADIUS = 6;

/**
 * Place / move one owned gatherer's work flag to node (x,y) — the player's "work here" order (the gathering
 * twin of {@link moveUnit}, mapped from Ctrl+Right-Click). If the gatherer already carries a {@link WorkFlag}
 * whose flag entity still exists, that flag is relocated to (x,y) — only the marker moves; the goods already
 * dropped stay pinned to their tiles (a flag stores nothing). Otherwise a fresh flag — a pure
 * {@link DeliveryFlag} marker (no {@link Stockpile}: the harvest piles on the ground around it, not into it) —
 * is created there and bound with the {@link DEFAULT_WORK_FLAG_RADIUS}. From then on the gatherer harvests only
 * within that flag's radius, carries only what it dug, and banks it there ({@link planGatherer}).
 *
 * The clicked node is snapped to the nearest legal one within {@link WORK_FLAG_SNAP_MAX_RADIUS}
 * ({@link nearestWorkFlagPlacement}): the player aims at the patch to work, and a resource body blocks its
 * own cells, so "work this iron mine" lands on the ore itself. The snap carries the settler's signpost
 * confinement, so it can only land on ground that settler may work — a narrow stream snaps to its bank.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim; a dead/stale target, a
 * non-settler, a neutral (unowned) entity, a settler whose job cannot harvest — only a gatherer carries a
 * work flag, so Ctrl+Right-Click on a soldier is a no-op, never a stray flag — or a click with no legal node
 * in snapping range (mid-lake, a walled-in pocket, wholly outside the settler's signpost area). Carries no
 * issuing-player yet; the per-player authority check lands with lockstep.
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
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobCanHarvest(ctx, jobType)) return; // only a gatherer carries a work flag

  const live = liveWorkFlag(world, e);
  // Signpost confinement: a gatherer can't be sent to work ground it doesn't know the way to. Folded into
  // the snap rather than applied to its winner, so a click near the band edge snaps INWARD to allowed
  // ground instead of being pushed out and then rejected.
  const limit = navigationLimitFor(world, terrain, e);
  // Clamp an off-map click onto the grid (like moveUnit), then snap off any body it landed on. The clicked
  // node is the search's own first candidate, so an unblocked click resolves to itself.
  const target = nearestWorkFlagPlacement(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y), {
    ignoreFlag: live?.flag,
    ...(limit !== null ? { accept: (node) => limit.allowsNode(node) } : {}),
    withinRadius: WORK_FLAG_SNAP_MAX_RADIUS,
  });
  if (target === null) return; // nothing legal in snapping range — the click was not on workable ground
  const c = terrain.coordsOf(target);
  const pos = positionOfNode(c.x, c.y);

  if (live !== undefined) {
    // Relocate the existing flag — only the marker moves, and its gatherer sheds the delivery/nav state
    // that cached the old position (see {@link relocateWorkFlag}).
    relocateWorkFlag(world, live.flag, pos, e);
    return;
  }
  // No live flag yet (fresh gatherer, or its flag was removed) — mint one here and bind / re-point.
  bindFreshFlag(world, e, pos);
  clearNavState(world, e);
}

/** Set a gatherer's resource filter. Flag-bound: {@link WorkFlag.goodType} (`null` = every map good
 * its job may harvest). Flag-less but employed at a stocking building: {@link GatherSelection}, valid
 * only for a good the workplace stores (`null` = every stored good). Invalid goods, non-gatherers and
 * unemployed flag-less settlers are ignored; changing the filter abandons a stale harvest route
 * immediately. */
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
    const binding = world.get(e, WorkFlag);
    if (goodType === null) delete binding.goodType;
    else binding.goodType = goodType;
    world.touch(e);
  } else {
    // The flag-less employed path: the pick lives in a GatherSelection and must be a good the bound
    // workplace stockpiles (the "an employed gatherer forages only for its workplace" rule).
    const workplace = world.tryGet(e, JobAssignment)?.workplace;
    if (workplace === undefined || !world.isAlive(workplace)) return;
    if (goodType === null) {
      world.remove(e, GatherSelection); // back to every stored good
    } else {
      if (!(workplaceStoredGoods(world, ctx, workplace)?.has(goodType) ?? false)) return;
      const selection = world.tryGet(e, GatherSelection);
      if (selection === undefined) {
        world.add(e, GatherSelection, { goodType });
      } else {
        selection.goodType = goodType;
        world.touch(e);
      }
    }
  }
  const atomic = world.tryGet(e, CurrentAtomic);
  if (atomic?.effect.kind === 'harvest') world.remove(e, CurrentAtomic);
  clearNavState(world, e);
}

/**
 * Set a craft worker's product selection ({@link CraftSelection}) — which of its bound workplace's
 * products it crafts, alternating when several are chosen (see the component doc for the rotation).
 * The selection is stored ascending and deduped (canonical; the rotation order is by goodType, not
 * click order) with the cursor reset. Goods the workplace's recipes don't make are dropped; a
 * selection with none left is ignored (recoverable bad input), and an empty selection restores the
 * all-products default by removing the component. Batches already grinding keep their product — the
 * choice applies from the next cycle start, mirroring how a mid-harvest `setGatherGood` cancels only
 * the not-yet-banked work.
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
  if (recipes === undefined) return; // not a recipe workplace — nothing to choose
  if (command.goods.length === 0) {
    world.remove(e, CraftSelection); // back to the all-products default
    return;
  }
  const goods = [...new Set(command.goods)].filter((g) => recipes.has(g)).sort((a, b) => a - b);
  if (goods.length === 0) return; // named nothing this workplace makes
  const selection = world.tryGet(e, CraftSelection);
  if (selection === undefined) {
    world.add(e, CraftSelection, { goods, cursor: 0 });
  } else {
    selection.goods = goods;
    selection.cursor = 0;
    world.touch(e);
  }
}
