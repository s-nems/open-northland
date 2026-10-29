import {
  Building,
  CurrentAtomic,
  JobAssignment,
  Position,
  playerPlacementTribes,
  professionProgressionEnabled,
  Settler,
  StayPoint,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';
import { byExperience, experienceRank } from '../../ai-shared/workforce/experience.js';
import type { SpareForce } from '../../ai-shared/workforce/pool.js';
import {
  groundDistance,
  HUNT_CHASE_SLACK_NODES,
  HUNT_PREY_SCORE_CEILING,
  preyScore,
  workplaceHuntingGround,
} from '../../conflict/hunting/index.js';
import { huntingGroundHoldsCarcass } from '../../conflict/hunting/kill-claim.js';
import { isHuntTarget } from '../../conflict/targeting.js';
import type { SystemContext } from '../../context.js';
import { jobEnabled, needSubjectOf, settlerMeetsNeed, typeAllowed } from '../../progression/index.js';
import { hunterJobType, isHunterJob } from '../../readviews/index.js';
import { entityNode } from '../../spatial/nodes.js';
import { seatBaseOf } from '../base.js';
import { OPENING_HUNT_UNTIL_TICKS } from '../game-phase.js';
import { technologyTable } from '../technology/requirements.js';
import type { StaffingTally } from './tally.js';

/** One decision's base hunters: the hunter trade, the men posted at the base, and how many it keeps. */
export interface HuntingPlan {
  readonly base: Entity;
  readonly job: number;
  /** The base's hunters; the decision's hire is pushed in. */
  readonly posted: Entity[];
  /** The opening hunter, plus the food-shortage hunters while the seat runs short ({@link foodHunters}). */
  readonly want: number;
  readonly apprentices: ReadonlySet<Entity>;
}

/** The seat's {@link HuntingPlan}, or null when the content lacks the hunter trade or the base's hunter
 *  seat. `extraFor` gives the food-shortage hunters the seat wants beside the opening one, from how many
 *  it holds now. */
export function huntingPlan(
  world: World,
  ctx: SystemContext,
  player: number,
  base: Entity,
  extraFor: (held: number) => number,
  apprentices: ReadonlySet<Entity>,
): HuntingPlan | null {
  const job = hunterJobType(ctx.content);
  if (job === null || !offersHunterSeat(world, ctx, base, job)) return null;
  const posted = huntersAt(world, ctx, player, base);
  return { base, job, posted, want: 1 + extraFor(Math.max(0, posted.length - 1)), apprentices };
}

/**
 * The base hunters: one man employed at the seat's base on its hunter slot, handed back to the civilian
 * pool once {@link OPENING_HUNT_UNTIL_TICKS} passes, and earlier once he idles with no game left on the
 * base's hunting ground (authored). Under the experience gates the post outlasts the clock while his
 * kills still have a trade to open or fill ({@link huntOpensTrades}), and is re-filled after the hunter
 * was promoted into one: the owner's ruling keeps the hunter until the breeder and the sewer open. An
 * apprentice earning a discovery by his kills is never retired. The first phase keeps and hires the one
 * post; the surplus phase, out of the men the other posts leave, hires the food-shortage hunters the plan
 * wants, and the first phase hands the extra ones back once the plan no longer wants them, the least
 * practised first. Employed rather than flag-bound because the post gives him the base as his hunting
 * ground and banks his kills as food.
 */
export function allocateHunters(
  world: World,
  ctx: SystemContext,
  player: number,
  plan: HuntingPlan | null,
  force: SpareForce,
  builderJob: number | null,
  tally: StaffingTally,
  phase: 'first' | 'surplus',
): PlayerCommand[] {
  if (plan === null) return [];
  const { base, job, posted } = plan;
  const free = (e: Entity): boolean => !plan.apprentices.has(e);
  if (ctx.tick >= OPENING_HUNT_UNTIL_TICKS && !huntOpensTrades(world, ctx, player, tally))
    return phase === 'first' ? retireHunters(world, posted.filter(free), builderJob) : [];
  if (posted.length > 0) {
    // Not mid-action, walking included: a walk carries no CurrentAtomic.
    const idle = posted.some((e) => !world.has(e, CurrentAtomic));
    if (idle && !huntWorkLeft(world, ctx, base, job, posted, HUNT_CHASE_SLACK_NODES))
      return phase === 'first' ? retireHunters(world, posted.filter(free), builderJob) : [];
    if (phase === 'first') {
      const extra = byExperience([...posted], experienceRank(world, ctx, job)).slice(plan.want);
      return retireHunters(world, extra.filter(free), builderJob);
    }
  } else if (!huntWorkLeft(world, ctx, base, job, posted, 0)) return [];
  const want = phase === 'first' ? 1 : plan.want;
  if (posted.length >= want) return [];
  // Only the per-settler half of the command's own gate is left to ask of a candidate: `posted` above
  // is already this building's whole hunter headcount, since a workplace employs its owner's men alone.
  const spare = force.take((e) => settlerMeetsNeed(world, ctx, needSubjectOf(world, e), 'job', job));
  if (spare === null) return [];
  posted.push(spare);
  return [{ kind: 'assignWorker', entity: spare, building: base, jobPriority: [job] }];
}

/** Whether the seat's base hunter could earn hunting experience: one is posted there, or the base offers
 *  a hunter seat with game left on its ground. */
export function seatHuntsGame(world: World, ctx: SystemContext, player: number): boolean {
  const hunterJob = hunterJobType(ctx.content);
  const base = seatBaseOf(world, ctx, player);
  if (hunterJob === null || base === null || !offersHunterSeat(world, ctx, base, hunterJob)) return false;
  const posted = huntersAt(world, ctx, player, base);
  return huntWorkLeft(world, ctx, base, hunterJob, posted, posted.length > 0 ? HUNT_CHASE_SLACK_NODES : 0);
}

/**
 * Whether hunting still has a trade to open for the seat under the experience gates: a job a hunting
 * track's `needforjob` row gates (the breeder and the sewer in the shipped tribes) that the seat may hold
 * but has not discovered, or one an owned building has a slot for and nobody in it, since only a man with
 * the hunter's experience can take that slot.
 */
function huntOpensTrades(world: World, ctx: SystemContext, player: number, tally: StaffingTally): boolean {
  if (!professionProgressionEnabled(world)) return false;
  const tribe = playerPlacementTribes(world, player)?.[0];
  const table = tribe === undefined ? null : technologyTable(ctx.content, tribe);
  if (tribe === undefined || table === null) return false;
  const index = contentIndex(ctx.content);
  for (const gate of table.jobs.values()) {
    const hunted = gate.needs.some((row) => row.tracks.some((t) => t.work.kind === 'hunt'));
    if (!hunted || !typeAllowed(world, ctx, player, tribe, 'job', gate.typeId)) continue;
    if (!jobEnabled(world, ctx, player, tribe, gate.typeId)) return true;
    for (const building of ownedBuildings(world, player)) {
      const type = index.buildings.get(world.get(building, Building).buildingType);
      const slot = type?.workers.some((w) => w.jobType === gate.typeId && w.count > 0) ?? false;
      if (slot && (tally.get(building)?.get(gate.typeId) ?? 0) === 0) return true;
    }
  }
  return false;
}

function huntersAt(world: World, ctx: SystemContext, player: number, base: Entity): Entity[] {
  return ownedSettlers(world, player).filter(
    (e) =>
      world.tryGet(e, JobAssignment)?.workplace === base &&
      isHunterJob(ctx.content, world.get(e, Settler).jobType),
  );
}

/** Whether the base's building type declares a `hunterJob` worker slot at all. */
function offersHunterSeat(world: World, ctx: SystemContext, base: Entity, hunterJob: number): boolean {
  const type = contentIndex(ctx.content).buildings.get(world.get(base, Building).buildingType);
  return type?.workers.some((w) => w.jobType === hunterJob && w.count > 0) ?? false;
}

/**
 * Whether the base's hunting ground, widened by `slack` nodes, still holds live game a hunter could walk
 * to and would pick (scored from the ground's anchor, see {@link HUNT_PREY_SCORE_CEILING}) or an unbanked
 * carcass of a posted hunter's. The hire asks the bare ground and the retirement the
 * chase leash, so game grazing on the edge does not flip the post each decision. Mapless: always true.
 */
function huntWorkLeft(
  world: World,
  ctx: SystemContext,
  base: Entity,
  hunterJob: number,
  posted: readonly Entity[],
  slack: number,
): boolean {
  const terrain = ctx.terrain;
  const ground = terrain === undefined ? null : workplaceHuntingGround(world, terrain, base);
  if (terrain === undefined || ground === null) return true;
  if (posted.some((h) => huntingGroundHoldsCarcass(world, ctx, terrain, h, hunterJob, ground))) return true;
  const reach = ground.radius + slack;
  const home = terrain.componentOf(ground.anchorCell);
  // Wildlife is the StayPoint carrier set, far smaller than the settler store.
  for (const t of world.query(StayPoint, Settler, Position)) {
    if (!isHuntTarget(world, ctx, t, hunterJob)) continue;
    const at = entityNode(world, terrain, t);
    if (groundDistance(terrain, ground.anchorCell, at) > reach) continue;
    if (preyScore(world, terrain, ground.anchorCell, t) >= HUNT_PREY_SCORE_CEILING) continue;
    if (home < 0 || terrain.componentOf(at) === home) return true;
  }
  return false;
}

/** Hand the opening hunters back to the pool as builders, leaving a man mid-action alone. */
function retireHunters(world: World, posted: readonly Entity[], builderJob: number | null): PlayerCommand[] {
  if (builderJob === null) return [];
  return posted
    .filter((e) => !world.has(e, CurrentAtomic))
    .map((e) => ({ kind: 'setJob', entity: e, jobType: builderJob }));
}
