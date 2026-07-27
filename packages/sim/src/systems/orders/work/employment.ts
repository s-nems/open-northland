import {
  Age,
  Armor,
  AttackOrder,
  Building,
  Carrying,
  CraftSelection,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  Equipment,
  EquipOrder,
  Fleeing,
  GatherSelection,
  JobAssignment,
  ownerOf,
  PlayerOrder,
  Position,
  Settler,
  SiteAssignment,
  SupplyRun,
  sameSide,
  TrainingOrder,
  UnderConstruction,
  Weapon,
} from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { bindEmployment, openWorkerJobFromList } from '../../economy/jobs/index.js';
import { syncWorkFlagToJob } from '../../economy/work-flag.js';
import { interactionNode } from '../../footprint/index.js';
import { needSubjectOf, settlerMeetsNeed } from '../../progression/index.js';
import { isFighterJob } from '../../readviews/index.js';
import { jobCanBuild, startDrop } from '../../settlers/actions.js';
import { addCarry, isUsed, placeUnitOnTile } from '../../settlers/effects-goods/index.js';
import { navigationLimitFor } from '../../signposts/index.js';
import { clearNavState } from '../../spatial/nodes.js';
import { stampDefaultStance } from '../combat.js';
import { deferOrderDuringAtomic, isOrderableSettler, isTradeAssignable } from '../guards.js';

/**
 * Change one owned settler's profession: set its `Settler.jobType` and reset it to a fresh idle worker of the
 * new trade — drop the old workplace binding ({@link JobAssignment}) so the JobSystem re-employs it at a
 * building of the new job, cancel any current action/route, and clear any {@link PlayerOrder}. A unit carrying
 * a load sets it down first ({@link reidleAsJob} starts the drop atomic) so the old trade's haul isn't
 * teleported into the new job — it re-idles into the new trade once the load is on the ground.
 *
 * Recoverable bad input (skipped, still logged): a target {@link isTradeAssignable} rejects, an unknown
 * `jobType`, or a trade whose `needforjob` XP threshold this settler hasn't earned yet
 * ({@link settlerMeetsNeed} — the tech tree's manual seam: a profession must be discovered through
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
  if (!contentIndex(ctx.content).commandJobs.has(command.jobType)) return; // unknown job — skip
  if (!settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', command.jobType)) return; // unearned trade
  // A non-interruptible atomic parks the whole order instead of being discarded (see deferOrderDuringAtomic).
  if (deferOrderDuringAtomic(world, ctx, e, command)) return;

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
 * The single home of the "re-idle to a new trade" reset, so the employment orders and the barracks drill
 * (`settlers/training.ts`) can't drift apart.
 * Owned-only: the callers guard `e` is owned, so the stance stamp keeps the "Stance is owned-only" invariant.
 */
export function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  world.get(e, Settler).jobType = jobType;
  world.remove(e, TrainingOrder); // a trade change calls off a drill errand — the settler was re-tasked
  // Cancel whatever it was doing under the old job. setJob vets interruptibility before reaching here
  // (deferOrderDuringAtomic); assignWorker still cancels unconditionally — a remaining member of the
  // uninterruptible-atomic class, tracked in docs/tickets/sim/orders-cancel-remaining-atomic-stomps.md.
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // an employment change executing now supersedes any earlier parked order
  // Before the drop below, so a shed unit joins it.
  if (isFighterJob(ctx.content, jobType)) shedToolOnEnlist(world, e);
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
  stampDefaultStance(world, ctx.content, e, jobType);
  // Leaving the fighter trades disarms the settler: the arms are the soldier's role kit, and the render
  // draws the armed look from the equipped weapon good over the job — a kept weapon would freeze an
  // ex-soldier in the warrior skin. Both axes go: the Equipment display slots and the combat Weapon/Armor.
  // Deliberately AFTER the load-drop step above: with empty hands the first freed unit is taken up, so
  // the delivery drive walks it into a store instead of leaving it in the grass. Anything the hands
  // cannot take (the second unit, or either one when the settler was already loaded) lands at its feet
  // for a porter.
  if (!isFighterJob(ctx.content, jobType)) {
    world.remove(e, Weapon);
    world.remove(e, Armor);
    shedSlotGood(world, e, 'weapon');
    shedSlotGood(world, e, 'armor');
  }
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
  // The per-employment picks die with the employment they were made under (the rule {@link bindEmployment}
  // applies on the re-binding path; here the settler goes unemployed until the JobSystem re-posts it).
  world.remove(e, GatherSelection);
  world.remove(e, CraftSelection);
}

/**
 * A fighter keeps no tool - it aids only production work (user rule 2026-07-25) - so entering a
 * soldier/hero trade empties the slot ({@link shedSlotGood}) and calls off a tool-slot equip errand in
 * flight (an errand for another slot survives, as on any job change).
 */
function shedToolOnEnlist(world: World, e: Entity): void {
  const order = world.tryGet(e, EquipOrder);
  if (order !== undefined && order.group === 'tool') world.remove(e, EquipOrder);
  shedSlotGood(world, e, 'tool');
}

/**
 * Empty one equipment slot the settler's NEW trade may not use, without swallowing the good: a fresh
 * unit joins free or same-good hands, else lands on the settler's own tile; a part-used one - or one on
 * a positionless settler - is destroyed (the take-off rule, settlers/effects-goods/equip.ts). Both
 * endings serve the user's rule (2026-07-26: a store if the economy can manage it, the ground
 * otherwise) - a unit left in hand is banked by the delivery drive, a grounded one is collected by a
 * porter like any loose pile.
 */
function shedSlotGood(world: World, e: Entity, group: 'tool' | 'weapon' | 'armor'): void {
  const equipment = world.tryGet(e, Equipment);
  const worn = equipment?.[group];
  if (equipment === undefined || worn == null) return;
  equipment[group] = null;
  world.touch(e);
  if (isUsed(worn)) return;
  const held = world.tryGet(e, Carrying);
  if (held === undefined || held.goodType === worn.goodType) {
    addCarry(world, e, worn.goodType, 1);
    return;
  }
  const pos = world.tryGet(e, Position);
  if (pos === undefined) return;
  const node = nodeOfPosition(pos.x, pos.y);
  const at = positionOfNode(node.hx, node.hy); // the node's canonical lattice tile, so drops stack
  placeUnitOnTile(world, at.x, at.y, worn.goodType, ownerOf(world, e));
}

/**
 * Assign one owned settler to work at a specific `building` (the `assignWorker` command — the player-directed
 * twin of the JobSystem's automatic assignment): resolve the building's open worker job in the command's
 * `jobPriority` preference order ({@link openWorkerJobFromList} — a same-tribe/same-owner, tech-enabled
 * building with an understaffed slot), re-idle the settler as that job, and bind it to the chosen building
 * ({@link bindEmployment}). The priority expresses the RTS intent (a tradesman first, a hauler as fallback):
 * a settler that has not earned the trade's `needforjob` repeats falls through to the hauler slot, while the
 * tribe-tech gate is relaxed for the player — see {@link openWorkerJobFromList}.
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
    const limit = navigationLimitFor(world, ctx.content, terrain, e);
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
 * ({@link import('../../settlers/economy/index.js').planBuilder} re-stamps or drops the pin). Only the builder
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
  // Obey now — the planner heads for the pinned site this tick. Still an unconditional cancel (a remaining
  // member of the uninterruptible-atomic class, same ticket as reidleAsJob's note).
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // a builder pin executing now supersedes any earlier parked order
  // A builder pinned mid-haul keeps its load (unlike a profession change): re-pinning is the same trade, just a
  // different site, so it carries the (often scarce) material onward and the delivery drive banks it, rather
  // than dumping it in the field. Only a job change or an enemy makes a carrier set its load down.
  world.remove(e, PlayerOrder);
  clearNavState(world, e);
}
