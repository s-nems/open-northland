import { Building, JobAssignment, ownerOf, ownersCompatible, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, type NeedSubject, settlerMeetsNeed } from '../../progression/index.js';
import { isFighterJob } from '../../readviews/index.js';
import { buildingWorkerJobs } from '../../stores/index.js';

/** The settler-side context an openness probe reads: the same tribe/owner/experience triple the
 *  `needfor*` gate judges. */
export interface OpeningsQuery extends NeedSubject {
  readonly world: World;
  readonly ctx: SystemContext;
  /** The settler's current trade, null when it holds none; read only by the garrison gate. */
  readonly jobType: number | null;
}

/**
 * The open worker job at `building` chosen by the caller's ordered `jobPriority`: the first job the building
 * both offers and has room for, or null.
 *
 * Employment is directed, never automatic, so the two extracted gates on a specialization split (the coiner
 * carries both, `jobEnablesJob 8/13 14` and `needforjob 14 …`) resolve as:
 *  - the tribe-tech gate (`jobEnablesJob`) is not applied, a deliberate convenience deviation so an
 *    assignment staffs a built workshop with its own trade instead of silently downgrading to the carrier
 *    slot;
 *  - the per-settler XP threshold (`needforjob`) is enforced on a trade the settler does not yet hold, so an
 *    unqualified settler falls through to the next listed job, which is the carrier slot - the original's
 *    "make him a tradesman, else a hauler" rule. Being posted to the trade it already practises is not
 *    earning it, so that case skips the gate.
 *
 * A building still under construction answers like a finished one, and an upgrade site reports the slots of
 * the tier it currently is, so a higher tier's extra seats cannot be filled early. The slot counts and the
 * tier chain are extracted (`logicworker`, `upgradeTarget`); hiring onto a foundation and the upgrade's
 * base-tier cap are authored, since the original offers no pre-completion staffing to read.
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
  if (!buildingEnabled(world, ctx, ownerOf(world, building), tribe, b.buildingType)) return null;
  const offered = buildingWorkerJobs(world, ctx, building);
  for (const jobType of jobPriority) {
    if (!offered.has(jobType)) continue;
    if (!jobUnderstaffed(query, building, jobType)) continue;
    if (!garrisonPostOpenTo(query, jobType)) continue;
    const alreadyHoldsTrade = query.jobType === jobType;
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
