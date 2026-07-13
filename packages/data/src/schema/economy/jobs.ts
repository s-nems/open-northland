import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

export const JobType = z.strictObject({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /** Atomic ids this job is permitted to perform (`jobtypes` `allowatomic`), in file order. */
  allowedAtomics: z.array(AtomicId).default([]),
  /** Always-available base atomics for this job (`jobtypes` `baseatomics`), in file order. */
  baseAtomics: z.array(AtomicId).default([]),
  /** Atomic ids explicitly denied to this job (`jobtypes` `forbidatomic`) — an override that the
   *  planner must treat as a hard exclusion, distinct from merely "not in allowedAtomics". */
  forbiddenAtomics: z.array(AtomicId).default([]),
  source: Provenance.optional(),
});
export type JobType = z.infer<typeof JobType>;

/**
 * One `[humanjobexperiencetype]` record (`Data/logic/humanjobexperiencetypes.ini`) — a
 * per-specialization experience track. The original game grants a settler experience *within a
 * narrow specialization* (a `(job, good)` pairing, e.g. "collector wood" = job 8 + good 5), not just
 * per job: doing the same job on the same good repeatedly is what makes a settler an expert at it.
 * This table is the source of those tracks, the input the Phase-3 ProgressionSystem accrues XP into.
 *
 * A record names its owning `jobType` (`job`, always present) and, when the specialization is
 * good-specific, the `goodType` it trains on (`good`, present on 44 of 70 base records — a "general"
 * track like "builder general" omits it). `experienceFactor` (`experiencefactor`) scales how fast XP
 * accrues on this track; `baseRepeatCounter` (`baserepeatcounter`, on a few records) is the original's
 * repeat-count tuning for the track. Both numbers are captured raw — their exact runtime curve is the
 * ProgressionSystem's concern, pinned later; this is the data-extraction slice only (no XP logic yet).
 */
export const HumanJobExperienceType = z.strictObject({
  /** The track's `type` id (unique within this table). */
  typeId: TypeId,
  /** Stable slug from `name` (e.g. "collector wood" -> `collector_wood`); `jobxp_<typeId>` if unnamed. */
  id: z.string(),
  name: z.string().optional(),
  /** The owning job (`job`) — always present; cross-checked against the job table at load. */
  jobType: TypeId,
  /** The specialization's good (`good`), when the track is good-specific; absent on "general" tracks. */
  goodType: TypeId.optional(),
  /** `experiencefactor` — how fast XP accrues on this track (raw; the curve is the ProgressionSystem's). */
  experienceFactor: z.number().int().nonnegative().default(0),
  /** `baserepeatcounter` — the original's repeat-count tuning for the track (raw), when present. */
  baseRepeatCounter: z.number().int().nonnegative().optional(),
  source: Provenance.optional(),
});
export type HumanJobExperienceType = z.infer<typeof HumanJobExperienceType>;
