import {
  Age,
  Armor,
  AttackOrder,
  Building,
  Carrying,
  CraftSelection,
  CurrentAtomic,
  Engagement,
  Equipment,
  Female,
  Fleeing,
  GatherSelection,
  JobAssignment,
  ownerOf,
  PlayerOrder,
  Settler,
  SiteAssignment,
  SupplyRun,
  sameSide,
  UnderConstruction,
  Weapon,
  WorkFlag,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { BUILD_HOUSE_ATOMIC_ID, startDrop } from '../agents/actions.js';
import { jobAtomics } from '../agents/targets/index.js';
import type { SystemContext } from '../context.js';
import {
  bindFreshFlag,
  jobCanHarvest,
  jobCanHarvestGood,
  liveWorkFlag,
  relocateWorkFlag,
  removeWorkFlag,
  syncWorkFlagToJob,
} from '../economy/flags.js';
import { openWorkerJobFromList } from '../economy/jobs/index.js';
import { interactionNode, nearestWorkFlagPlacement } from '../footprint/index.js';
import { isFighterJob } from '../readviews/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { clearNavState } from '../spatial.js';
import { workplaceStoredGoods } from '../stores/index.js';
import { stampDefaultStance } from './combat.js';
import { isOrderableSettler } from './guards.js';

/**
 * Change one owned settler's profession: set its `Settler.jobType` and reset it to a fresh idle worker of the
 * new trade — drop the old workplace binding ({@link JobAssignment}) so the JobSystem re-employs it at a
 * building of the new job, cancel any current action/route, and clear any {@link PlayerOrder}. A unit carrying
 * a load sets it down first ({@link reidleAsJob} starts the drop atomic) so the old trade's haul isn't
 * teleported into the new job — it re-idles into the new trade once the load is on the ground.
 *
 * Recoverable bad input (skipped, still logged): a dead/stale target, a non-settler, a neutral entity (no
 * {@link Owner}), an unknown `jobType`, or a still-growing child (an {@link Age} unit — its job class is the
 * GrowthSystem's to set, not the player's).
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  // A woman keeps the woman role for life — the trades are male (faithful to the original's job model;
  // user decision 2026-07-16). Her work is the household: hoarding food home, bearing children.
  if (world.has(e, Female)) return;
  if (!contentIndex(ctx.content).commandJobs.has(command.jobType)) return; // unknown job — skip

  world.remove(e, JobAssignment); // re-employed at a building of the NEW job by the JobSystem
  reidleAsJob(world, ctx, e, command.jobType);
}

/**
 * Reset an owned settler to a fresh idle worker of `jobType`: set its `Settler.jobType`, cancel any current
 * action/route/hold, drop auto-combat state, stamp the new job's default military stance (a soldier→civilian
 * flip stops auto-engaging and starts fleeing; the reverse engages — the player can override with `setStance`),
 * and sync the gatherer work flag to the new trade ({@link syncWorkFlagToJob} — a gatherer trade gets a flag,
 * leaving one drops it). It does not touch {@link JobAssignment}: the caller owns the binding — {@link setJob}
 * drops it (the JobSystem re-employs), while {@link assignWorker} sets it (bind to the player-chosen building).
 * The single home of the "re-idle to a new trade" reset, so the two employment orders can't drift apart.
 * Owned-only: the callers guard `e` is owned, so the stance stamp keeps the "Stance is owned-only" invariant.
 */
function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  world.get(e, Settler).jobType = jobType;
  world.remove(e, CurrentAtomic); // cancel whatever it was doing under the old job
  // A profession change makes a hands-full settler set its load down first: it replaces the cancelled action
  // with the drop atomic, so the old trade's haul lands on the ground here rather than being carried on to a
  // store under the new trade (the requested "drop when you change job" behavior).
  if (world.has(e, Carrying)) startDrop(world, ctx, e);
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  world.remove(e, SiteAssignment); // and drops any construction-crew membership of the old trade
  // And its supply errand: the old trade's fetch is abandoned with the load, so the site must stop
  // counting it as inbound (the planner's tally re-seeds from live components each tick).
  world.remove(e, SupplyRun);
  clearNavState(world, e);
  world.remove(e, Engagement); // drop any auto-combat state — the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  stampDefaultStance(world, e, jobType);
  // Leaving the fighter trades disarms the settler: the arms are the soldier's role kit, and the render
  // draws the armed look from the equipped weapon good over the job — a kept weapon would freeze an
  // ex-soldier in the warrior skin. Both axes go: the Equipment display slots and the combat Weapon/Armor.
  // Named approximation: the weapon/armor goods VANISH from the economy rather than dropping or returning
  // to a store (the original's fate for a converted soldier's kit is unobserved) — recovering them is
  // docs/tickets/sim/disarm-equipment-fate.md.
  if (!isFighterJob(jobType)) {
    world.remove(e, Weapon);
    world.remove(e, Armor);
    const equipment = world.tryGet(e, Equipment);
    if (equipment !== undefined && (equipment.weapon !== null || equipment.armor !== null)) {
      equipment.weapon = null;
      equipment.armor = null;
      world.touch(e);
    }
  }
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
  // Both per-employment picks die with the employment they were made under — a new workplace offers a
  // different product/store set, so a stale pick would silently mis-steer (or stall) the new post.
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
}

/**
 * Assign one owned settler to work at a specific `building` (the `assignWorker` command — the player-directed
 * twin of the JobSystem's automatic assignment): resolve the building's open worker job in the command's
 * `jobPriority` preference order ({@link openWorkerJobFromList} — a same-tribe/same-owner, tech-enabled
 * building with an understaffed slot), re-idle the settler as that job, and bind it to the chosen building
 * ({@link JobAssignment}). The priority expresses the RTS intent (a tradesman first, a hauler as fallback).
 * Unlike the automatic scan, this path relaxes the per-slot tech/XP gate — the player staffs a built workshop
 * with its own trade — a deliberate deviation named in {@link openWorkerJobFromList}.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler or
 * neutral (unowned) issuer, a still-growing child ({@link Age}), a dead/stale/non-building target, or a
 * building that offers this settler no open worker job right now (full, wrong tribe, not a workplace, or gated).
 */
export function assignWorker(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignWorker' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  if (world.has(e, Female)) return; // women take no trade — see the setJob guard
  const b = command.building;
  if (!world.isAlive(b) || !world.has(b, Building)) return;
  // Signpost confinement: a workplace beyond the settler's allowed area is refused like an out-of-area
  // move order (moveUnit) — the player extends the network first, then staffs the far building.
  const terrain = ctx.terrain;
  if (terrain !== undefined) {
    const limit = navigationLimitFor(world, terrain, e);
    if (limit !== null) {
      const inode = interactionNode(world, ctx, b);
      if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return;
    }
  }

  const settler = world.get(e, Settler);
  const jobType = openWorkerJobFromList(
    {
      world,
      ctx,
      tribe: settler.tribe,
      owner: ownerOf(world, e),
      experience: settler.experience,
      mode: { kind: 'playerDirected' },
    },
    b,
    command.jobPriority,
  );
  if (jobType === null) return; // full / wrong tribe / other player / not a workplace / gated — no-op

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  reidleAsJob(world, ctx, e, jobType);
  world.add(e, JobAssignment, { workplace: b });
  // A gatherer hand-assigned to a building carries no work flag: reidleAsJob auto-plants one for a harvest
  // trade (the free-gatherer default), so drop it here. Where the harvest then goes is deliveryTargetFor's
  // call: into the bound building when it consumes the good (case 1 — a workshop's raw input) or is a plain
  // store (case 3b — a warehouse/HQ); a good the bound workshop doesn't stock still routes to the nearest
  // warehouse (case 5), so "the building is its flag" holds for a warehouse or a matching input, not every good.
  if (jobCanHarvest(ctx, jobType)) removeWorkFlag(world, e);
}

/**
 * Assign one owned builder to a specific construction `site` — the original's "put a builder on a foundation"
 * (right-click a site with a builder selected). It pins a {@link SiteAssignment} so the builder drive raises
 * that site over the nearest one and the site's workers window lists the settler until the build finishes
 * ({@link import('../agents/economy/index.js').planBuilder} re-stamps or drops the pin). Only the builder trade
 * qualifies (its job runs the build atomic) — a civilian right-clicked onto a site is a no-op (the app routes
 * normal buildings to `assignWorker` instead). Authoritative like every employment order: it cancels the
 * current action/route/hold so the builder heads for its site this tick.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale/non-settler/neutral
 * issuer, a still-growing child, a dead or not-under-construction target, a wrong-tribe site, or a site
 * owned by another player (a player pins only its own foundations — two same-tribe players stay apart).
 *
 * Deliberately NO signpost-confinement gate (unlike `assignWorker`): a pinned site is how the player
 * extends the network's frontier, and the builder drive treats the pinned site as a bound sink
 * (routing case 3c) so the crew can raise it from outside the walkable-area rule.
 */
export function assignBuilder(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignBuilder' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  const site = command.site;
  if (!world.isAlive(site) || !world.has(site, Building) || !world.has(site, UnderConstruction)) return;
  const settler = world.get(e, Settler);
  if (settler.tribe !== world.get(site, Building).tribe) return; // not this tribe's foundation
  if (!sameSide(world, e, site)) return; // another player's foundation — not this side's
  if (settler.jobType === null || !jobAtomics(ctx, settler.jobType).has(BUILD_HOUSE_ATOMIC_ID)) return;

  world.add(e, SiteAssignment, { site, pinned: true });
  world.remove(e, CurrentAtomic); // obey now — the planner heads for the pinned site this tick
  // A builder pinned mid-haul keeps its load (unlike a profession change): re-pinning is the same trade, just a
  // different site, so it carries the (often scarce) material onward and the delivery drive banks it, rather
  // than dumping it in the field. Only a job change or an enemy makes a carrier set its load down.
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}

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
