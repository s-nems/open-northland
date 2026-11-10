import type { ContentSet, JobType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { isCarrierJobId, isFighterRole, isTraderJobId, jobRoleOfId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { atomicSpendsReligion } from './religion.js';

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

const lowestJobs = new WeakMap<ReadonlySet<number>, number | null>();

/** The canonical pick over a role's job set, so set iteration order never decides the answer. Kept per
 *  set, which a content index builds once: the draft asks it per settler. */
function lowestJobOf(jobs: ReadonlySet<number>): number | null {
  const held = lowestJobs.get(jobs);
  if (held !== undefined) return held;
  let lowest: number | null = null;
  for (const jobType of jobs) {
    if (lowest === null || jobType < lowest) lowest = jobType;
  }
  lowestJobs.set(jobs, lowest);
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

const religiousJobs = new WeakMap<ContentSet, Map<number, boolean>>();

/** Authored religion need, extended deliberately to trades whose allowed actions spend it. */
export function jobNeedsReligion(content: ContentSet, jobType: number | null): boolean {
  if (jobType === null) return false;
  let jobs = religiousJobs.get(content);
  if (jobs === undefined) {
    jobs = new Map();
    religiousJobs.set(content, jobs);
  }
  const cached = jobs.get(jobType);
  if (cached !== undefined) return cached;
  const index = contentIndex(content);
  const needs =
    index.jobs.get(jobType)?.needsReligion === true ||
    content.tribes.some((tribe) =>
      [...(index.atomicsByJob.get(jobType) ?? [])].some((atomic) =>
        atomicSpendsReligion(content, { tribe: tribe.typeId, jobType }, atomic),
      ),
    );
  jobs.set(jobType, needs);
  return needs;
}

/**
 * Whether the trade never goes home (`jobtypes.ini` `ignoresHomeHouseFlag`: trader, scout, every soldier
 * and hero), so nothing it spends out in the field is halved for being spent there.
 */
export function jobIgnoresHomeHouse(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.ignoresHomeHouse === true;
}

/**
 * Whether the player sets what the trade makes or gathers (`jobtypes.ini` `userCanChangeProductionFlag`;
 * the hunter's is 0, so it takes every good of every kill). A record without the flag reads as
 * changeable. The production counters of a trade that cannot change them never apply.
 */
export function jobChangesProduction(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.changesProduction !== false;
}

/** Whether the trade works only through a workplace ({@link JobType} `needsWorkHouse`); a record without
 *  the flag reads as free to work without one. */
export function jobNeedsWorkHouse(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.needsWorkHouse === true;
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

/** A settler of the land trader's trade. */
export function isTrader(world: World, content: ContentSet, settler: Entity): boolean {
  return isTraderJob(content, world.tryGet(settler, Settler)?.jobType ?? null);
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

/** The shore-working fisher, not the never-staffed `fisher_sea` row. */
export function isFisherJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).jobs.get(jobType)?.id === 'fisher';
}
