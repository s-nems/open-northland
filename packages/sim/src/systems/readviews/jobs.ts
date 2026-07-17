import type { ContentSet, JobType } from '@open-northland/data';

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
