import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

export const JobType = z.strictObject({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Atomic ids this job is permitted to perform (`jobtypes` `allowatomic`), in file order. */
  allowedAtomics: z.array(AtomicId).default([]),
  /** The job this one inherits its atomics from (`jobtypes` `baseatomics` - a job `type`, not an
   *  atomic id, despite the key name); absent on a root job. */
  baseJob: TypeId.optional(),
  /** Atomic ids explicitly denied to this job (`jobtypes` `forbidatomic`) - a hard exclusion that also
   *  overrides what {@link baseJob} passes down. */
  forbiddenAtomics: z.array(AtomicId).default([]),
  /** `needsReligionFlag`; the behaviour it gates is `readviews/jobs.ts`'s. */
  needsReligion: z.boolean().optional(),
  /** `ignoresHomeHouseFlag`; the behaviour it gates is `readviews/jobs.ts`'s. */
  ignoresHomeHouse: z.boolean().optional(),
  source: Provenance.optional(),
});
export type JobType = z.infer<typeof JobType>;

/**
 * One `[humanjobexperiencetype]` record (`Data/logic/humanjobexperiencetypes.ini`): a per-specialization
 * experience track. The original grants experience within a narrow `(job, good)` pair ("collector wood"
 * = job 8 + good 5), not per job alone; a "general" track omits the good.
 */
export const HumanJobExperienceType = z.strictObject({
  /** The track's `type` id (unique within this table). */
  typeId: TypeId,
  /** Stable slug from `name` (e.g. "collector wood" -> `collector_wood`); `jobxp_<typeId>` if unnamed. */
  id: z.string(),
  name: z.string().optional(),
  /** The owning job (`job`), cross-checked against the job table at load. */
  jobType: TypeId,
  /** The specialization's good (`good`), when the track is good-specific; absent on "general" tracks. */
  goodType: TypeId.optional(),
  /** `experiencefactor` - how fast XP accrues on this track; the runtime curve is the ProgressionSystem's. */
  experienceFactor: z.number().int().nonnegative().default(0),
  /** `baserepeatcounter` - strokes per completed work action on the track; the sim's `workRepeatsFor`
   *  owns the reading. */
  baseRepeatCounter: z.number().int().nonnegative().optional(),
  source: Provenance.optional(),
});
export type HumanJobExperienceType = z.infer<typeof HumanJobExperienceType>;
