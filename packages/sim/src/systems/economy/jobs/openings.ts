import { Building, JobAssignment, ownerOf, ownersCompatible, Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingEnabled, type NeedSubject, settlerMeetsNeed } from '../../progression/index.js';
import { isFighterJob } from '../../readviews/index.js';
import { buildingWorkerJobs } from '../../stores/index.js';

/** The settler-side context an openness probe reads: who is asking ({@link NeedSubject} - the same
 *  tribe/owner/experience triple the `needfor*` gate judges). One object because these always travel
 *  together. */
export interface OpeningsQuery extends NeedSubject {
  readonly world: World;
  readonly ctx: SystemContext;
  /** The settler's CURRENT trade (null when it holds none) - read only by the garrison gate, which admits
   *  a fighting-class slot to a settler already of that class ({@link garrisonPostOpenTo}). */
  readonly jobType: number | null;
}

/**
 * The open worker job at `building` chosen by the caller's ORDERED `jobPriority` preference: the first job
 * in the list the building actually offers AND has room for, or null. A job the building does not employ is
 * skipped; the same-tribe/same-owner and per-building capacity gates run on every entry.
 *
 * Employment is directed, never automatic - this resolves the `assignWorker` command, which the player and
 * the AI player both issue - so the two extracted gates on a specialization split (the coiner carries both:
 * `jobEnablesJob 8/13 14` + `needforjob 14 …`) resolve as:
 *  - the TRIBE-tech gate (`jobEnablesJob`, "does a settler of the enabling trade live here") is NOT applied,
 *    a deliberate convenience deviation: an assignment staffs a built workshop with its own trade instead of
 *    silently downgrading to the carrier slot (the reported "mennica → tragarz" bug);
 *  - the per-settler XP threshold (`needforjob`) IS enforced, like everywhere else. A trade is earned by the
 *    settler, so an assignment cannot mint a 0-XP potter the profession picker refuses to offer; an
 *    unqualified settler falls through to the next listed job, which is the carrier slot - the original's
 *    "make him a tradesman, else a hauler" rule.
 * The building-level gate (`buildingEnabled`) runs too but is currently a feature-wide no-op (see it).
 *
 * A building still under construction answers like a finished one: its slots take staff while it is raised,
 * and that staff waits at the site until it stands (`drives/economy/site-staff.ts`). An upgrade site reports
 * the slots of the tier it currently IS - the target tier is adopted only on completion - so the extra seats
 * a higher tier brings cannot be filled early.
 *
 * source-basis: hiring onto a foundation at all, and the upgrade's base-tier cap, are a user rule with no
 * original oracle - the original offers no pre-completion staffing. The slot counts and the tier chain
 * themselves are extracted (`logicworker`, `upgradeTarget`); only the timing is ours.
 */
export function openWorkerJobFromList(
  query: OpeningsQuery,
  building: Entity,
  jobPriority: readonly number[],
): number | null {
  const { world, ctx, tribe } = query;
  const b = world.tryGet(building, Building);
  if (b === undefined || b.tribe !== tribe) return null;
  if (!ownersCompatible(query.owner, ownerOf(world, building))) return null; // another player's workplace (sameSide doc)
  if (!buildingEnabled(world, ctx, tribe, b.buildingType)) return null; // building-unlock gate (disabled - see buildingEnabled)
  const offered = buildingWorkerJobs(world, ctx, building);
  for (const jobType of jobPriority) {
    if (!offered.has(jobType)) continue; // not a job this building employs
    if (!jobUnderstaffed(query, building, jobType)) continue;
    if (!garrisonPostOpenTo(query, jobType)) continue;
    if (!settlerMeetsNeed(world, ctx, query, 'job', jobType)) continue; // XP gate (needforjob)
    return jobType;
  }
  return null;
}

/**
 * Whether a GARRISON slot admits the querying settler. A worker slot naming a fighting class - the towers'
 * `logicworker 40 3` / `41 3` short/long-bow posts - is manned, not trained into: it takes only a settler
 * who already fights in exactly that class, since taking up a weapon good is what sets a soldier's class
 * (`atomics/effects/goods/weapon-class.ts`). Without it a tower would re-trade any colonist into an archer.
 *
 * The readable data says only that the posts exist; who may take one is our rule. Every non-fighter slot
 * passes.
 */
function garrisonPostOpenTo(query: OpeningsQuery, jobType: number): boolean {
  return !isFighterJob(query.ctx.content, jobType) || query.jobType === jobType;
}

/**
 * Whether `jobType` has an unfilled `workers` slot **at this specific** `building`: the building
 * type's slot `count` for that job exceeds the number of settlers *bound to this building* for that
 * job ({@link JobAssignment}). Per-building (not tribe-wide) head-count, so two same-type workplaces
 * each fill their own slots independently - a worker bound to mill A doesn't make mill B look staffed.
 *
 * Determinism: a count of bound settlers (addition commutes), so iterating query insertion order is
 * fine - it's not a *pick*, just a sum (AGENTS.md: only a chosen-entity scan needs canonical order).
 */
function jobUnderstaffed(query: OpeningsQuery, building: Entity, jobType: number): boolean {
  const { world, ctx } = query;
  const b = world.get(building, Building);
  const type = contentIndex(ctx.content).buildings.get(b.buildingType);
  const slot = type?.workers.find((w) => w.jobType === jobType);
  if (slot === undefined) return false; // not a worker job here
  let held = 0;
  for (const e of world.query(Settler, JobAssignment)) {
    if (world.get(e, JobAssignment).workplace !== building) continue;
    if (world.get(e, Settler).jobType === jobType) held++;
  }
  return held < slot.count;
}
