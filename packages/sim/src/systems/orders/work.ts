import {
  Age,
  AttackOrder,
  Building,
  CurrentAtomic,
  Engagement,
  Fleeing,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { bindFreshFlag, jobCanHarvest, liveWorkFlag, syncWorkFlagToJob } from '../economy/flags.js';
import { openWorkerJobFromList } from '../economy/jobs/index.js';
import { stampDefaultStance } from './combat.js';

/**
 * Change one OWNED settler's profession (the settler UI's "zmiana zawodu"): set its `Settler.jobType`
 * and reset it to a fresh idle worker of the new trade — drop the old workplace binding
 * ({@link JobAssignment}) so the JobSystem re-employs it at a building of the new job, cancel any
 * current action/route, and clear any {@link PlayerOrder} (a profession change hands the unit back to
 * the economy). The unit keeps any load it is carrying (it will still deposit it).
 *
 * Recoverable bad input (skipped, still logged): a dead/stale target, a non-settler, a NEUTRAL entity
 * (no {@link Owner}), an unknown `jobType` (absent from the jobs table), or a still-growing child (an
 * {@link Age} unit — its job class is the GrowthSystem's to set, not the player's).
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  if (!contentIndex(ctx.content).commandJobs.has(command.jobType)) return; // unknown job — skip

  world.remove(e, JobAssignment); // re-employed at a building of the NEW job by the JobSystem
  reidleAsJob(world, ctx, e, command.jobType);
}

/**
 * Reset an OWNED settler to a fresh idle worker of `jobType`: set its `Settler.jobType`, cancel any
 * current action/route/hold, drop auto-combat state, stamp the new job's DEFAULT military stance (a
 * soldier→civilian flip stops auto-engaging and starts fleeing; the reverse engages — the player can
 * override afterwards with `setStance`), and SYNC the gatherer work flag to the new trade
 * ({@link syncWorkFlagToJob} — a gatherer trade gets a flag, leaving one drops it). It does NOT touch
 * {@link JobAssignment}: the caller owns the binding — {@link setJob} DROPS it (the JobSystem re-employs
 * at the first open building of the new job), while {@link assignWorker} SETS it (bind to the
 * player-chosen building). The one place the "re-idle to a new trade" reset lives, so the two employment
 * orders can't drift apart. Owned-only: the callers guard `e` is owned, so the stance stamp keeps the
 * "Stance is owned-only" invariant.
 */
function reidleAsJob(world: World, ctx: SystemContext, e: Entity, jobType: number): void {
  world.get(e, Settler).jobType = jobType;
  world.remove(e, CurrentAtomic); // cancel whatever it was doing under the old job
  world.remove(e, PlayerOrder); // an employment change returns the unit to the economy
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, Engagement); // drop any auto-combat state — the new trade re-decides its stance
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing);
  stampDefaultStance(world, e, jobType);
  syncWorkFlagToJob(world, ctx, e, jobType); // a gatherer trade carries a work flag; other trades don't
}

/**
 * Assign one OWNED settler to work at a SPECIFIC `building` (the `assignWorker` command — the
 * player-directed twin of the JobSystem's automatic assignment): resolve the building's open worker
 * job in the command's `jobPriority` preference order, through the SAME per-building openness gate the
 * JobSystem applies ({@link openWorkerJobFromList} — a same-tribe, tech-enabled workplace with an
 * understaffed slot the settler qualifies for), re-idle the settler as that job, and bind it to the
 * chosen building ({@link JobAssignment}). The priority is how the app expresses the RTS intent (a
 * tradesman first, a hauler as fallback, never a gatherer) but every candidate still clears the gate,
 * so the bound settler walks to and staffs that building through the normal AI planner, exactly like an
 * auto-assigned worker — a hand assignment can never reach a state the JobSystem wouldn't.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler
 * or NEUTRAL (unowned) issuer, a still-growing child (an {@link Age} unit — the GrowthSystem owns its
 * job class), a dead/stale/non-building target, or a building that offers this settler no open worker
 * job right now (full, wrong tribe, not a workplace, or gated).
 */
export function assignWorker(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'assignWorker' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  const b = command.building;
  if (!world.isAlive(b) || !world.has(b, Building)) return;

  const settler = world.get(e, Settler);
  const jobType = openWorkerJobFromList(
    world,
    ctx,
    b,
    settler.tribe,
    settler.experience,
    command.jobPriority,
  );
  if (jobType === null) return; // building full / wrong tribe / not a workplace / gated — no-op

  world.remove(e, JobAssignment); // drop any prior binding before re-binding to the chosen building
  // reidleAsJob also syncs the work flag; here `jobType` is a BUILDING-worker job, so the flag path only
  // ever REMOVES a stale flag (a gatherer reassigned to a building drops it). It never auto-plants: a
  // building resolves no harvest job (`openWorkerJobFromList` — "never a gatherer"), so the plant-at-feet
  // branch is unreachable through assignWorker. A future caller that DID pass a harvest job here would
  // plant the flag at the settler's current tile, not near the building — a seam to revisit if that lands.
  reidleAsJob(world, ctx, e, jobType);
  world.add(e, JobAssignment, { workplace: b });
}

/**
 * Place / move one OWNED gatherer's **work flag** to node (x,y) — the player's "work here" order (the
 * gathering twin of {@link moveUnit}, mapped from Ctrl+Right-Click). If the gatherer already carries a
 * {@link WorkFlag} whose flag entity still exists, that flag is **relocated** to (x,y) — only the marker
 * moves; the goods already dropped stay pinned to their tiles (a flag stores nothing). Otherwise a fresh
 * flag — a pure {@link DeliveryFlag} marker (no {@link Stockpile}: the harvest piles on the GROUND around
 * it, not into it) — is created there and bound with the {@link DEFAULT_WORK_FLAG_RADIUS}. From then on the
 * gatherer harvests only within that flag's radius, carries only what it dug, and banks it there
 * ({@link planGatherer}).
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim (no cells); a dead/stale
 * target, a non-settler, a NEUTRAL (unowned) entity, or a settler whose **job cannot harvest** — only a
 * gatherer carries a work flag, so Ctrl+Right-Click on a soldier is a no-op, never a stray flag. Carries no
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
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  const jobType = world.get(e, Settler).jobType;
  if (jobType === null || !jobCanHarvest(ctx, jobType)) return; // only a gatherer carries a work flag

  // Snap to a valid node (an off-map click lands on the nearest cell, like moveUnit) and take its tile Position.
  const c = terrain.coordsOf(terrain.nodeAtClamped(command.x, command.y));
  const pos = positionOfNode(c.x, c.y);

  const live = liveWorkFlag(world, e);
  if (live !== undefined) {
    // Relocate the gatherer's existing flag — only the marker moves (Position mutated in place, as the
    // MovementSystem does). The goods already dropped are separate ground heaps pinned to their own tiles,
    // so they stay put; the gatherer just starts piling FRESH harvest around the flag's new spot.
    const p = world.get(live.flag, Position);
    p.x = pos.x;
    p.y = pos.y;
    return;
  }
  // No live flag yet (fresh gatherer, or its flag was removed) — mint one here and bind / re-point.
  bindFreshFlag(world, e, pos);
}
