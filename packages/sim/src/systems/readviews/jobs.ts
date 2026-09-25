import type { ContentSet, JobType } from '@open-northland/data';
import { isCarrierJobId, isFighterRole, isTraderJobId, jobRoleOfId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';

/**
 * A soldier or hero class, whose whole role is combat. A weapon-carrying scout or hunter is not one, and
 * neither is a jobless settler. The roles come from the content's job table, never an id band.
 */
export function isFighterJob(content: ContentSet, jobType: number | null): boolean {
  return isSoldierJob(content, jobType) || isHeroJob(content, jobType);
}

/** The trained half of {@link isFighterJob}, kept apart from heroes because they feed different XP tracks. */
export function isSoldierJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).soldierJobs.has(jobType);
}

/**
 * The soldier class a barracks drill enlists a trained settler into. Approximation: the lowest declared
 * soldier trade stands in for the weaponless base class, which picks `jobtypes.ini` 31 `soldier_unarmed`
 * in every playable tribe.
 */
export function baseSoldierJobType(content: ContentSet): number | null {
  return lowestJobOf(contentIndex(content).soldierJobs);
}

/** The canonical pick over a role's job set, so set iteration order never decides the answer. */
function lowestJobOf(jobs: ReadonlySet<number>): number | null {
  let lowest: number | null = null;
  for (const jobType of jobs) {
    if (lowest === null || jobType < lowest) lowest = jobType;
  }
  return lowest;
}

/** The named mission elites, the untrained half of {@link isFighterJob}. */
export function isHeroJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).heroJobs.has(jobType);
}

/** {@link isFighterJob} for a caller holding job rows rather than the running content. */
export function isFighterJobRow(job: Pick<JobType, 'id'>): boolean {
  return isFighterRole(jobRoleOfId(job.id));
}

/** {@link isHeroJob} for a caller holding a job row rather than the running content. */
export function isHeroJobRow(job: Pick<JobType, 'id'>): boolean {
  return jobRoleOfId(job.id) === 'hero';
}

/**
 * Whether the trade serves a piety need (`jobtypes.ini` `needsReligionFlag`: joiner, armorer, smith). Every
 * other trade prays only when ordered, even the sewer, whose armour clips drain its bar.
 */
export function jobNeedsReligion(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.needsReligion === true;
}

/**
 * Whether the trade never goes home (`jobtypes.ini` `ignoresHomeHouseFlag`: trader, scout, every soldier
 * and hero), so nothing it spends out in the field is halved for being spent there.
 */
export function jobIgnoresHomeHouse(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.ignoresHomeHouse === true;
}

/** The transport trade, for the same row-holding callers as {@link isFighterJobRow}. */
export function isCarrierJobRow(job: Pick<JobType, 'id'>): boolean {
  return isCarrierJobId(job.id);
}

/** The land trader, which runs a trade route instead of a workplace craft. */
export function isTraderJob(content: ContentSet, jobType: number | null): boolean {
  const job = jobType === null ? undefined : contentIndex(content).jobs.get(jobType);
  return job !== undefined && isTraderJobId(job.id);
}

/** The non-combat explorer that erects signposts. */
export function isScoutJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).scoutJobs.has(jobType);
}

/**
 * The civilization job that hunts game. Every tribe's hunter binds the same attack atomic
 * (`setatomic <hunter> 81 "..._hunter_attack"` in `tribetypes.ini`), so its strike reuses the combat path.
 */
export function isHunterJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).hunterJobs.has(jobType);
}

/** The wandering priest, which the original routes like a scout rather than through its signposts. */
export function isDruidJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).druidJobs.has(jobType);
}

/** The lowest scout trade the content declares, or null when it declares none. */
export function scoutJobType(content: ContentSet): number | null {
  return lowestJobOf(contentIndex(content).scoutJobs);
}

/** The hunter twin of {@link scoutJobType}. */
export function hunterJobType(content: ContentSet): number | null {
  return lowestJobOf(contentIndex(content).hunterJobs);
}

/**
 * The `jobtypes` id suffix marking a water-borne specialization of a land trade. It is the only extracted
 * distinguisher: a sea variant carries the same `baseJob` and an empty `allowedAtomics`, its sea-work
 * atomics being bound per-tribe through `tribetypes` `setatomic`.
 */
const SEA_JOB_SUFFIX = '_sea';

/** The suffix isolates exactly `fisher_sea` (23) and `trader_sea` (26) in the real IR. */
export function isSeaJob(job: JobType): boolean {
  return job.id.endsWith(SEA_JOB_SUFFIX);
}

/** The shore-working fisher, distinct from its currently inert `fisher_sea` vehicle specialization. */
export function isFisherJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.id === 'fisher';
}

/** Sorted ascending by `typeId`, so enumeration does not depend on declaration order. */
export function seaJobs(content: ContentSet): JobType[] {
  return content.jobs.filter(isSeaJob).sort((a, b) => a.typeId - b.typeId);
}
