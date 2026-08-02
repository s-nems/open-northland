import {
  Age,
  Building,
  Carrying,
  CurrentAtomic,
  DeferredOrder,
  JobAssignment,
  ownerOf,
  PlayerOrder,
  Settler,
  SiteAssignment,
  sameSide,
  UnderConstruction,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { applyTradeChange, bindEmployment, openWorkerJobFromList } from '../../economy/jobs/index.js';
import { interactionNode } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { jobCanBuild, startDrop } from '../../settlers/atomics/start.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { clearNavState } from '../../spatial/nodes.js';
import { deferOrderDuringAtomic, isOrderableSettler, isTradeAssignable } from '../guards.js';

/**
 * Change one owned settler's profession: reset it to a fresh idle worker of the new trade
 * ({@link reidleAsJob}) and drop the old workplace binding ({@link JobAssignment}).
 *
 * It leaves the settler UNPOSTED, and nothing employs it again on its own: a trade whose work runs
 * through a binding (a carrier's haul rung, a craftsman's producer loop) stays inert until the player
 * also posts it somewhere ({@link assignWorker}). Trading and posting are two decisions in this engine.
 *
 * Recoverable bad input (skipped, still logged): a target {@link isTradeAssignable} rejects, an unknown
 * `jobType`, or a trade whose `needforjob` XP threshold this settler hasn't earned yet
 * ({@link settlerMeetsNeed} - the tech tree's manual seam: a profession must be discovered through
 * accrued repeats; the profession-progression toggle lifts the civilian gates, fighters stay
 * barracks-gated either way).
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!isTradeAssignable(world, e)) return;
  if (!contentIndex(ctx.content).commandJobs.has(command.jobType)) return; // unknown job - skip
  if (!settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', command.jobType)) return; // unearned trade
  // A non-interruptible atomic parks the whole order instead of being discarded (see deferOrderDuringAtomic).
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;

  world.remove(e, JobAssignment); // the old post is not the new trade's - the player picks the next one
  reidleAsJob(world, ctx, e, command.jobType);
}

/**
 * The authoritative half of a profession change: cancel whatever the settler was doing under the old trade
 * (its action, its route, any live or parked {@link PlayerOrder}) and set its load down, before taking up
 * `jobType` ({@link applyTradeChange}). Shared by the employment orders and the barracks drill
 * (`settlers/drives/training.ts`).
 */
export function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  // setJob vets interruptibility before reaching here (deferOrderDuringAtomic); assignWorker still cancels
  // unconditionally, a remaining member of the uninterruptible-atomic class, tracked in
  // docs/tickets/sim/orders-cancel-remaining-atomic-stomps.md.
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // an employment change executing now supersedes any earlier parked order
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  clearNavState(world, e);
  // A hands-full settler sets the old trade's haul down here rather than carrying it on into the new job
  // (the requested "drop when you change job" behavior). Before the trade change, so the arms a disarmed
  // soldier is about to take up ({@link applyTradeChange}) are not swept into this drop.
  if (world.has(e, Carrying)) startDrop(world, ctx, e);
  applyTradeChange(world, ctx, e, jobType);
}

/**
 * Assign one owned settler to work at a specific `building` (the `assignWorker` command - the one way a
 * settler becomes employed): resolve the building's open worker job in the command's
 * `jobPriority` preference order ({@link openWorkerJobFromList} - a same-tribe/same-owner, tech-enabled
 * building with an understaffed slot), re-idle the settler as that job, and bind it to the chosen building
 * ({@link bindEmployment}). The priority expresses the RTS intent (a tradesman first, a hauler as fallback):
 * a settler that has not earned the trade's `needforjob` repeats falls through to the hauler slot, while the
 * tribe-tech gate is relaxed for the player - see {@link openWorkerJobFromList}.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a target {@link isTradeAssignable}
 * rejects, a dead/stale/non-building target, or a building that offers this settler no open worker job right
 * now (full, wrong tribe, not a workplace, or gated).
 */
export function assignWorker(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignWorker' }>,
): void {
  const e = command.entity;
  if (!isTradeAssignable(world, e)) return;
  const b = command.building;
  if (!world.isAlive(b) || !world.has(b, Building)) return;
  // Signpost confinement: a workplace beyond the settler's allowed area is refused like an out-of-area
  // move order (moveUnit) - the player extends the network first, then staffs the far building.
  const terrain = ctx.terrain;
  if (terrain !== undefined) {
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (limit !== null) {
      const inode = interactionNode(world, ctx, b);
      if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return;
    }
  }

  const settler = world.get(e, Settler);
  const jobType = openWorkerJobFromList(
    { world, ctx, tribe: settler.tribe, owner: ownerOf(world, e), experience: settler.experience },
    b,
    command.jobPriority,
  );
  if (jobType === null) return;

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  reidleAsJob(world, ctx, e, jobType);
  bindEmployment(world, ctx, e, b, jobType);
}

/**
 * Assign one owned builder to a specific construction `site` - the original's "put a builder on a foundation"
 * (right-click a site with a builder selected). It pins a {@link SiteAssignment} so the builder drive raises
 * that site over the nearest one and the site's workers window lists the settler until the build finishes
 * ({@link import('../../settlers/drives/economy/index.js').planBuilder} re-stamps or drops the pin). Only the
 * builder trade qualifies - a civilian right-clicked onto a site is a no-op (the app routes normal buildings
 * to `assignWorker` instead). Authoritative like every employment order: it cancels the current
 * action/route/hold so the builder heads for its site this tick.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale/non-settler/neutral
 * issuer, a still-growing child, a dead or not-under-construction target, a wrong-tribe site, or a site
 * owned by another player (a player pins only its own foundations - two same-tribe players stay apart).
 * Unlike {@link setJob}/{@link assignWorker} it applies no women-take-no-trade gate: this order pins a site
 * rather than changing a trade, and the {@link jobCanBuild} check below already admits only a settler that
 * holds a builder job.
 *
 * Deliberately NO signpost-confinement gate (unlike `assignWorker`): a pinned site is how the player
 * extends the network's frontier, and the builder drive treats the pinned site as a bound sink
 * (`toOwnCrewSite`) so the crew can raise it from outside the walkable-area rule.
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
  if (!sameSide(world, e, site)) return; // another player's foundation - not this side's
  if (settler.jobType === null || !jobCanBuild(ctx, settler.jobType)) return;

  world.add(e, SiteAssignment, { site, pinned: true });
  // Obey now - the planner heads for the pinned site this tick. Still an unconditional cancel (a remaining
  // member of the uninterruptible-atomic class, same ticket as reidleAsJob's note).
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // a builder pin executing now supersedes any earlier parked order
  // A builder pinned mid-haul keeps its load (unlike a profession change): re-pinning is the same trade, just a
  // different site, so it carries the (often scarce) material onward and the delivery drive banks it, rather
  // than dumping it in the field. Only a job change or an enemy makes a carrier set its load down.
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}
