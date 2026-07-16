import {
  Age,
  AttackOrder,
  Building,
  CurrentAtomic,
  Engagement,
  Fleeing,
  JobAssignment,
  ownerOf,
  PlayerOrder,
  Position,
  Settler,
  SiteAssignment,
  sameSide,
  UnderConstruction,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import { BUILD_HOUSE_ATOMIC_ID } from '../agents/actions.js';
import { jobAtomics } from '../agents/targets/index.js';
import type { SystemContext } from '../context.js';
import {
  bindFreshFlag,
  jobCanHarvest,
  liveWorkFlag,
  removeWorkFlag,
  syncWorkFlagToJob,
} from '../economy/flags.js';
import { openWorkerJobFromList } from '../economy/jobs/index.js';
import { clearNavState } from '../spatial.js';
import { stampDefaultStance } from './combat.js';
import { isOrderableSettler } from './guards.js';

/**
 * Change one owned settler's profession: set its `Settler.jobType` and reset it to a fresh idle worker of the
 * new trade — drop the old workplace binding ({@link JobAssignment}) so the JobSystem re-employs it at a
 * building of the new job, cancel any current action/route, and clear any {@link PlayerOrder}. The unit keeps
 * any load it is carrying (it will still deposit it).
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
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  world.remove(e, SiteAssignment); // and drops any construction-crew membership of the old trade
  clearNavState(world, e);
  world.remove(e, Engagement); // drop any auto-combat state — the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  stampDefaultStance(world, e, jobType);
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
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
  const b = command.building;
  if (!world.isAlive(b) || !world.has(b, Building)) return;

  const settler = world.get(e, Settler);
  const jobType = openWorkerJobFromList(
    world,
    ctx,
    b,
    settler.tribe,
    ownerOf(world, e),
    settler.experience,
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
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}

/**
 * Place / move one owned gatherer's work flag to node (x,y) — the player's "work here" order (the gathering
 * twin of {@link moveUnit}, mapped from Ctrl+Right-Click). If the gatherer already carries a {@link WorkFlag}
 * whose flag entity still exists, that flag is relocated to (x,y) — only the marker moves; the goods already
 * dropped stay pinned to their tiles (a flag stores nothing). Otherwise a fresh flag — a pure
 * {@link DeliveryFlag} marker (no {@link Stockpile}: the harvest piles on the ground around it, not into it) —
 * is created there and bound with the {@link DEFAULT_WORK_FLAG_RADIUS}. From then on the gatherer harvests only
 * within that flag's radius, carries only what it dug, and banks it there ({@link planGatherer}).
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim; a dead/stale target, a
 * non-settler, a neutral (unowned) entity, or a settler whose job cannot harvest — only a gatherer carries a
 * work flag, so Ctrl+Right-Click on a soldier is a no-op, never a stray flag. Carries no issuing-player yet;
 * the per-player authority check lands with lockstep.
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

  // Snap to a valid node (an off-map click lands on the nearest cell, like moveUnit) and take its tile Position.
  const c = terrain.coordsOf(terrain.nodeAtClamped(command.x, command.y));
  const pos = positionOfNode(c.x, c.y);

  const live = liveWorkFlag(world, e);
  if (live !== undefined) {
    // Relocate the existing flag — only the marker moves (Position mutated in place). The goods already
    // dropped are separate ground heaps pinned to their own tiles, so they stay put.
    const p = world.get(live.flag, Position);
    p.x = pos.x;
    p.y = pos.y;
    return;
  }
  // No live flag yet (fresh gatherer, or its flag was removed) — mint one here and bind / re-point.
  bindFreshFlag(world, e, pos);
}
