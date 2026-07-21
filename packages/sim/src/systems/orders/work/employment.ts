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
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { jobCanBuild, startDrop } from '../../agents/actions.js';
import type { SystemContext } from '../../context.js';
import { syncWorkFlagToJob } from '../../economy/flags.js';
import { bindEmployment, openWorkerJobFromList } from '../../economy/jobs/index.js';
import { interactionNode } from '../../footprint/index.js';
import { isFighterJob } from '../../readviews/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { clearNavState } from '../../spatial.js';
import { stampDefaultStance } from '../combat.js';
import { isOrderableSettler, isTradeAssignable } from '../guards.js';

/**
 * Change one owned settler's profession: set its `Settler.jobType` and reset it to a fresh idle worker of the
 * new trade — drop the old workplace binding ({@link JobAssignment}) so the JobSystem re-employs it at a
 * building of the new job, cancel any current action/route, and clear any {@link PlayerOrder}. A unit carrying
 * a load sets it down first ({@link reidleAsJob} starts the drop atomic) so the old trade's haul isn't
 * teleported into the new job — it re-idles into the new trade once the load is on the ground.
 *
 * Recoverable bad input (skipped, still logged): a target {@link isTradeAssignable} rejects, or an unknown
 * `jobType`.
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!isTradeAssignable(world, e)) return;
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
  // The per-employment picks die with the employment they were made under (the rule {@link bindEmployment}
  // applies on the re-binding path; here the settler goes unemployed until the JobSystem re-posts it).
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
}

/**
 * Assign one owned settler to work at a specific `building` (the `assignWorker` command — the player-directed
 * twin of the JobSystem's automatic assignment): resolve the building's open worker job in the command's
 * `jobPriority` preference order ({@link openWorkerJobFromList} — a same-tribe/same-owner, tech-enabled
 * building with an understaffed slot), re-idle the settler as that job, and bind it to the chosen building
 * ({@link bindEmployment}). The priority expresses the RTS intent (a tradesman first, a hauler as fallback).
 * Unlike the automatic scan, this path relaxes the per-slot tech/XP gate — the player staffs a built workshop
 * with its own trade — a deliberate deviation named in {@link openWorkerJobFromList}.
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
  if (jobType === null) return;

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  reidleAsJob(world, ctx, e, jobType);
  bindEmployment(world, ctx, e, b, jobType);
}

/**
 * Assign one owned builder to a specific construction `site` — the original's "put a builder on a foundation"
 * (right-click a site with a builder selected). It pins a {@link SiteAssignment} so the builder drive raises
 * that site over the nearest one and the site's workers window lists the settler until the build finishes
 * ({@link import('../../agents/economy/index.js').planBuilder} re-stamps or drops the pin). Only the builder
 * trade qualifies — a civilian right-clicked onto a site is a no-op (the app routes normal buildings to
 * `assignWorker` instead). Authoritative like every employment order: it cancels the current action/route/hold
 * so the builder heads for its site this tick.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale/non-settler/neutral
 * issuer, a still-growing child, a dead or not-under-construction target, a wrong-tribe site, or a site
 * owned by another player (a player pins only its own foundations — two same-tribe players stay apart).
 * Unlike {@link setJob}/{@link assignWorker} it applies no women-take-no-trade gate: this order pins a site
 * rather than changing a trade, and the {@link jobCanBuild} check below already admits only a settler that
 * holds a builder job.
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
  if (settler.jobType === null || !jobCanBuild(ctx, settler.jobType)) return;

  world.add(e, SiteAssignment, { site, pinned: true });
  world.remove(e, CurrentAtomic); // obey now — the planner heads for the pinned site this tick
  // A builder pinned mid-haul keeps its load (unlike a profession change): re-pinning is the same trade, just a
  // different site, so it carries the (often scarce) material onward and the delivery drive banks it, rather
  // than dumping it in the field. Only a job change or an enemy makes a carrier set its load down.
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}
