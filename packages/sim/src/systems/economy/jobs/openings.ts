import { Building, JobAssignment, ownerOf, ownersCompatible, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, jobEnabled, type NeedSubject, settlerMeetsNeed } from '../../progression/index.js';
import { isFighterJob } from '../../readviews/index.js';
import { buildingWorkerJobs } from '../../stores/index.js';

/** The settler-side context an openness probe reads: the same tribe/owner/experience triple the
 *  `needfor*` gate judges. */
export interface OpeningsQuery extends NeedSubject {
  /** Initial map attachments retain their authored trade even before its building technology opens. */
  readonly authored?: boolean;
  readonly world: World;
  readonly ctx: SystemContext;
  /** The settler's current trade, null when it holds none; read only by the garrison gate. */
  readonly jobType: number | null;
}

/**
 * Select the first offered, understaffed trade the worker qualifies for. Catalogs with explicit house
 * requirements separate construction discovery from staffing; a newly chosen trade must be known to
 * the player. Initial authored attachments and workers retaining their current trade keep their seats.
 * Foundation staffing and an upgrade's base-tier slot cap are authored approximations.
 */
export function openWorkerJobFromList(
  query: OpeningsQuery,
  building: Entity,
  jobPriority: readonly number[],
): number | null {
  const { world, ctx, tribe } = query;
  const b = world.tryGet(building, Building);
  if (b === undefined || b.tribe !== tribe) return null;
  if (!ownersCompatible(query.owner, ownerOf(world, building))) return null; // another player's workplace
  const modern = contentIndex(ctx.content).tribes.get(tribe)?.technology !== undefined;
  if (
    !modern &&
    !query.authored &&
    !buildingEnabled(world, ctx, ownerOf(world, building), tribe, b.buildingType)
  )
    return null;
  const offered = buildingWorkerJobs(world, ctx, building);
  for (const jobType of jobPriority) {
    if (!offered.has(jobType)) continue;
    if (!jobUnderstaffed(query, building, jobType)) continue;
    if (!garrisonPostOpenTo(query, jobType)) continue;
    const alreadyHoldsTrade = query.jobType === jobType;
    if (
      modern &&
      !query.authored &&
      !alreadyHoldsTrade &&
      !jobEnabled(world, ctx, query.owner, tribe, jobType)
    )
      continue;
    // A bow soldier's `needforjob 40 5 69` reads a fight track only fighting accrues, so re-gating a
    // settler already in the trade would leave every tower post unmannable.
    if (!alreadyHoldsTrade && !settlerMeetsNeed(world, ctx, query, 'job', jobType)) continue;
    return jobType;
  }
  return null;
}

/**
 * Whether a garrison slot admits the querying settler. A worker slot naming a fighting class - the towers'
 * `logicworker 40 3` / `41 3` short/long-bow posts - is manned, not trained into: it takes only a settler
 * who already fights in exactly that class, since taking up a weapon good is what sets a soldier's class.
 * Authored: the readable data says only that the posts exist, not who may take one.
 */
function garrisonPostOpenTo(query: OpeningsQuery, jobType: number): boolean {
  return !isFighterJob(query.ctx.content, jobType) || query.jobType === jobType;
}

/**
 * Whether `jobType` has an unfilled `workers` slot at this specific `building`. The head-count is
 * per-building rather than tribe-wide, so two same-type workplaces each fill their own slots
 * independently. A commutative sum rather than a pick, so query insertion order is fine.
 */
function jobUnderstaffed(query: OpeningsQuery, building: Entity, jobType: number): boolean {
  const { world, ctx } = query;
  const b = world.get(building, Building);
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false;
  let held = 0;
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace !== building) continue;
    if (world.get(e, Settler).jobType === jobType) held++;
  }
  return held < slot.count;
}
