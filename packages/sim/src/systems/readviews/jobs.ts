import type { ContentSet, JobType } from '@open-northland/data';
import { isFighterRole, jobRoleOfId } from '../../core/content-index/jobs.js';
import { contentIndex } from '../../core/content-index.js';

/**
 * Whether `jobType` is a **fighter** trade — a soldier or hero class, the units whose whole role is combat.
 * Scouts and hunters are not: they carry weapons, but their role is exploration/predation. A `jobType` the
 * content declares no job for (and a jobless settler, `null`) is not a fighter — the roles are read off the
 * content's job table (`core/content-index/jobs.ts`), never a hardcoded id band.
 */
export function isFighterJob(content: ContentSet, jobType: number | null): boolean {
  return isSoldierJob(content, jobType) || isHeroJob(content, jobType);
}

/** Whether `jobType` is a **soldier** class — the trained half of {@link isFighterJob}, kept apart from
 *  {@link isHeroJob} because the two feed different general fight-XP tracks. */
export function isSoldierJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).soldierJobs.has(jobType);
}

/** Whether `jobType` is a **hero** class — the named mission elites ({@link isSoldierJob}). */
export function isHeroJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).heroJobs.has(jobType);
}

/** Whether a job ROW is a fighter trade — {@link isFighterJob} for a caller holding job rows rather than
 *  the running content (the HUD reads a readonly content slice, not the `ContentSet`). */
export function isFighterJobRow(job: Pick<JobType, 'id'>): boolean {
  return isFighterRole(jobRoleOfId(job.id));
}

/** Whether `jobType` is a **scout** trade — the non-combat explorer that erects signposts. */
export function isScoutJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).scoutJobs.has(jobType);
}

/**
 * Whether `jobType` is a **hunter** trade — the civilization job that hunts game (the `mayHunt` predation
 * relation). Every tribe's hunter binds the same attack atomic (`setatomic <hunter> 81 "..._hunter_attack"`,
 * verified in `DataCnmd/tribetypes12/tribetypes.ini`), so its strike reuses the combat attack/weapon/hit path.
 */
export function isHunterJob(content: ContentSet, jobType: number | null): boolean {
  return jobType !== null && contentIndex(content).hunterJobs.has(jobType);
}

/** The job id an AI assigns to make a settler a scout — the lowest scout trade the content declares (a
 *  canonical pick), or null when it declares none. */
export function scoutJobType(content: ContentSet): number | null {
  let lowest: number | null = null;
  for (const jobType of contentIndex(content).scoutJobs) {
    if (lowest === null || jobType < lowest) lowest = jobType;
  }
  return lowest;
}

/**
 * The id suffix `jobtypes` uses to mark a water-borne specialization of a land trade (`fisher` →
 * `fisher_sea`). The sea variant is a distinct jobtype whose only extracted distinguisher from its land
 * counterpart is this suffix: it carries the same `baseAtomics [6]` and an empty `allowedAtomics`, its
 * sea-work atomics being bound per-tribe via `tribetypes` `setatomic`.
 */
const SEA_JOB_SUFFIX = '_sea';

/**
 * Whether a {@link JobType} is water-borne, keyed on the {@link SEA_JOB_SUFFIX} its extracted `id` carries —
 * the only readable param separating a sea job from its land counterpart. In the real IR the suffix isolates
 * exactly `fisher_sea` (23) and `trader_sea` (26).
 */
export function isSeaJob(job: JobType): boolean {
  return job.id.endsWith(SEA_JOB_SUFFIX);
}

/**
 * The content's sea jobs ({@link isSeaJob}), sorted ascending by `typeId` so enumeration order does not
 * depend on `content.jobs` declaration order.
 */
export function seaJobs(content: ContentSet): JobType[] {
  return content.jobs.filter(isSeaJob).sort((a, b) => a.typeId - b.typeId);
}
