import {
  Age,
  Building,
  Carrying,
  JobAssignment,
  ownerOf,
  PlayerOrder,
  removeCurrentAtomic,
  Settler,
  SettlerProgress,
  SiteAssignment,
  SupplyRun,
  sameSide,
  UnderConstruction,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import {
  applyTradeChange,
  bindEmployment,
  openWorkerJobFromList,
  releaseEmployment,
} from '../../economy/jobs/index.js';
import { interactionNode } from '../../footprint/index.js';
import { clearNavState } from '../../movement/nav-state.js';
import { canChooseJob, needSubjectOf } from '../../progression/index.js';
import { jobCanBuild, startDrop } from '../../settlers/atomics/start.js';
import { releaseTowerPost } from '../../settlers/drives/tower-post.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { groupPlacementOrder } from '../group-placement.js';
import {
  deferOrderDuringAtomic,
  isOrderableSettler,
  isTradeAssignable,
  mayChangeTrade,
  supersedeStandingOrders,
} from '../guards.js';

/**
 * Change one owned settler's profession - see the command doc. Resets it to a fresh idle worker of the new
 * trade ({@link reidleAsJob}) and drops the old workplace binding ({@link JobAssignment}).
 *
 * It leaves the settler unposted and nothing employs it again on its own, so a trade whose work runs
 * through a binding stays inert until the player also posts it somewhere ({@link assignWorker}). Trading
 * and posting are two decisions in this engine.
 *
 * A trade whose `needforjob` XP threshold this settler has not earned is refused: that gate is the tech
 * tree's manual seam.
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!mayChangeTrade(world, e)) return;
  if (!contentIndex(ctx.content).commandJobs.has(command.jobType)) return; // unknown job - skip
  if (!canChooseJob(world, ctx, needSubjectOf(world, e), command.jobType)) return; // unearned trade
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;

  world.remove(e, JobAssignment); // the old post is not the new trade's - the player picks the next one
  reidleAsJob(world, ctx, e, command.jobType);
}

/**
 * The authoritative half of a profession change: cancel whatever the settler was doing under the old trade
 * and set its load down before taking up `jobType`. Shared by the employment orders and the barracks drill.
 */
export function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  cancelActionAndRoute(world, e);
  // The old trade's haul goes down rather than into the new job. Before the trade change, so the arms a
  // disarmed soldier is about to take up are not swept into this drop.
  if (world.has(e, Carrying)) startDrop(world, ctx, e);
  applyTradeChange(world, ctx, e, jobType);
}

/**
 * Assign one owned settler to work at a specific `building` - see the command doc. Resolves the building's
 * open worker job in the command's `jobPriority` order, re-idles the settler as that job, and binds it to
 * the building. The priority expresses the RTS intent of a tradesman first and a hauler as fallback, so a
 * settler that has not earned the trade's `needforjob` repeats falls through to the hauler slot.
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
  // move order, so the player extends the network first and staffs the far building after.
  const terrain = ctx.terrain;
  if (terrain !== undefined) {
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
    if (limit !== null) {
      const inode = interactionNode(world, ctx, b);
      if (inode !== null && !limit.allowsNode(terrain.nodeAtClamped(inode.x, inode.y))) return;
    }
  }

  const settler = world.get(e, Settler);
  const progress = world.get(e, SettlerProgress);
  const jobType = openWorkerJobFromList(
    {
      world,
      ctx,
      tribe: settler.tribe,
      owner: ownerOf(world, e),
      experience: progress.experience,
      learned: progress.learned,
      jobType: settler.jobType,
    },
    b,
    command.jobPriority,
  );
  if (jobType === null) return;

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  reidleAsJob(world, ctx, e, jobType);
  bindEmployment(world, e, b);
}

/** Employ the group at one building - see the command doc and {@link groupPlacementOrder}. */
export function assignWorkerGroup(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignWorkerGroup' }>,
): void {
  const building = command.building;
  const workplaceOf = (e: Entity): Entity | undefined => world.tryGet(e, JobAssignment)?.workplace;
  for (const { entity, jobPriority } of groupPlacementOrder(
    world,
    ctx,
    command.members,
    building,
    workplaceOf,
  )) {
    assignWorker(world, ctx, { kind: 'assignWorker', entity, building, jobPriority });
  }
}

/**
 * The player's half of {@link releaseEmployment} - see the command doc.
 *
 * A garrison is stood down through {@link releaseTowerPost}, so the explicit release and the one a walk
 * order performs cannot drift apart. The load stays in hand, as with {@link assignBuilder}.
 */
export function unassignWorker(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'unassignWorker' }>,
): void {
  const e = command.entity;
  if (!isTradeAssignable(world, e)) return;
  if (!world.has(e, JobAssignment)) return; // already unposted
  releaseTowerPost(world, ctx, e); // steps him off the tower while the binding it reads is still there
  releaseEmployment(world, ctx, e);
  cancelActionAndRoute(world, e);
}

/**
 * Assign one owned builder to a specific construction `site`, the original's "put a builder on a
 * foundation" - see the command doc. {@link jobCanBuild} admits only a settler already holding a builder
 * job, which is also why this order needs no women-take-no-trade gate.
 *
 * Deliberately no signpost-confinement gate, unlike {@link assignWorker}: a pinned site is how the player
 * extends the network's frontier, and the builder drive treats it as a bound sink so the crew can raise it
 * from outside the walkable-area rule.
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
  if (settler.jobType === null || !jobCanBuild(ctx.content, settler.jobType)) return;

  world.add(e, SiteAssignment, { site, pinned: true });
  // A builder pinned mid-haul keeps its load, unlike a profession change: the trade is unchanged, so it
  // carries the material onward instead of dumping it in the field.
  cancelActionAndRoute(world, e);
}

/**
 * Unpin one owned builder from the site {@link assignBuilder} bound it to - see the command doc. Only the
 * pin goes: the builder keeps its trade, its load and any workplace, and its next planning pass falls back
 * to the nearest-site rung. An unpinned crew membership is the builder drive's own bookkeeping, re-stamped
 * every pass, so removing the whole component would be undone the same tick.
 */
export function unassignBuilder(world: World, command: Extract<Command, { kind: 'unassignBuilder' }>): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (world.tryGet(e, SiteAssignment)?.pinned !== true) return; // never pinned - nothing to release
  world.remove(e, SiteAssignment);
  cancelActionAndRoute(world, e);
}

/** Stop what the settler's current employment had it doing and hand it back to the economy, leaving its
 *  trade, load and gear alone. */
function cancelActionAndRoute(world: World, e: Entity): void {
  // setJob vets interruptibility before reaching here; the employment orders still cancel unconditionally,
  // a remaining member of the uninterruptible-atomic class.
  removeCurrentAtomic(world, e);
  world.remove(e, SupplyRun); // releasing an interrupted construction pickup frees its source immediately
  supersedeStandingOrders(world, e);
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  clearNavState(world, e);
}
