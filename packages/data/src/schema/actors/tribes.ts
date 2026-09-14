import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

export const AtomicBinding = z.strictObject({
  jobType: TypeId,
  atomicId: AtomicId,
  animation: z.string(),
});
export type AtomicBinding = z.infer<typeof AtomicBinding>;

/**
 * Which type table a `tribetypes` `jobEnables<Kind> <jobType> <targetId>` edge's target id belongs to.
 * The four source keys differ only in that table, so they unify into one record keyed by `kind`; a
 * `vehicle` target uses the `logicvehicletype` namespace, distinct from the building one.
 */
export const JobEnablesKind = z.enum(['good', 'house', 'job', 'vehicle']);
export type JobEnablesKind = z.infer<typeof JobEnablesKind>;

export const JobEnables = z.strictObject({
  /** The job whose presence unlocks the target (`jobEnables*`'s first int). */
  jobType: TypeId,
  /** Which type table `targetId` indexes (from the `jobEnables<Kind>` key). */
  kind: JobEnablesKind,
  /** The unlocked target id, keyed within `kind`'s type table (the second int). */
  targetId: TypeId,
});
export type JobEnables = z.infer<typeof JobEnables>;

/**
 * One experience requirement from `tribetypes` `{need,train}for{job,good} <targetId> <amount> <expType>
 * [expType2]`. `experienceTypes` mostly name `humanjobexperiencetypes` ids but span a wider space:
 * `need` lines reach 72/73/75 and `train` lines pay in synthetic "school" markers (observed 57/77), so
 * they are captured without a cross-reference check.
 */
export const JobRequirementKind = z.enum(['need', 'train']);
export type JobRequirementKind = z.infer<typeof JobRequirementKind>;
export const JobRequirementTarget = z.enum(['job', 'good']);
export type JobRequirementTarget = z.infer<typeof JobRequirementTarget>;

export const JobRequirement = z.strictObject({
  /** `need` (XP already accrued) vs `train` (schooling), from the `need`/`train` key prefix. */
  requirement: JobRequirementKind,
  /** `job` vs `good`, from the `forjob`/`forgood` key suffix - which table `targetId` indexes. */
  target: JobRequirementTarget,
  /** The unlocked target id, keyed within `target`'s type table (the first int). */
  targetId: TypeId,
  /** The experience amount required (the second int). */
  amount: z.number().int().nonnegative(),
  /** The experience-type id(s) the amount is measured in (one or two; the third/fourth ints). */
  experienceTypes: z.array(TypeId).default([]),
});
export type JobRequirement = z.infer<typeof JobRequirement>;

export const TribeType = z.strictObject({
  typeId: TypeId,
  id: z.string(),
  name: z.string().optional(),
  /**
   * The hitpoint pool an adult settler of this tribe carries. Human HP is not in the readable data
   * (source basis "Combat hit resolution"), so this is an approximation supplied at the content
   * boundary; `0` means unset and the sim falls back to its `DEFAULT_SETTLER_HITPOINTS`.
   */
  hitpoints: z.number().int().nonnegative().default(0),
  /** `setatomic` bindings in file order - a tribe's atomic→animation vocabulary, per job. */
  atomicBindings: z.array(AtomicBinding).default([]),
  /** `jobEnables*` tech-graph edges in file order, repeated triples included. */
  jobEnables: z.array(JobEnables).default([]),
  /** `{need,train}for{job,good}` XP/schooling requirements in file order. */
  jobRequirements: z.array(JobRequirement).default([]),
  /** Initial allow tables; a synthetic catalog without them is unrestricted. */
  permissions: z
    .strictObject({
      job: z.array(TypeId),
      house: z.array(TypeId),
      good: z.array(TypeId),
    })
    .optional(),
  /** Explicit discovery requirements; a catalog without them discovers along its profession edges. */
  technology: z
    .strictObject({
      houses: z.array(
        z.strictObject({
          house: TypeId,
          jobs: z.array(TypeId),
          goods: z.array(TypeId),
        }),
      ),
    })
    .optional(),
  source: Provenance.optional(),
});
export type TribeType = z.infer<typeof TribeType>;

/**
 * One timed event inside an atomic animation (`event`/`eventx <at> <type> [value]` in
 * `atomicanimations.ini`). `at` is an offset within the animation's `length`; `type` and `value` form an
 * undocumented numeric vocabulary kept raw. `extended` marks the `eventx` variant.
 */
export const AtomicEvent = z.strictObject({
  at: z.number().int().nonnegative(),
  type: z.number().int().nonnegative(),
  value: z.number().int().optional(),
  extended: z.boolean().default(false),
});
export type AtomicEvent = z.infer<typeof AtomicEvent>;

/**
 * Timing and effect data for one named animation from `atomicanimations.ini` (readable in the
 * `culturesnation` mod, `.cif` in the base game). Tribe `setatomic` bindings are not cross-referenced
 * against these names: the mod's readable set is a subset of the base-game animations, so an absent
 * name is not a dangling reference.
 */
export const AtomicAnimation = z.strictObject({
  /** Filesystem-safe slug of `name`. Display-only - it lowercases, so resolve `setatomic` bindings
   *  against `name`, not `id`. */
  id: z.string(),
  /** The animation's exact name - the resolvable key referenced by `tribetypes` `setatomic`. */
  name: z.string(),
  /** Duration in animation ticks (`length`). */
  length: z.number().int().nonnegative().default(0),
  /** Whether the animation may be interrupted mid-play (`interruptable 1` in the source). */
  interruptible: z.boolean().default(false),
  /** Initial facing-direction index (`startdirection`), when the animation pins one. */
  startDirection: z.number().int().nonnegative().optional(),
  /** Timed events in file order (`event`/`eventx` lines). */
  events: z.array(AtomicEvent).default([]),
  source: Provenance.optional(),
});
export type AtomicAnimation = z.infer<typeof AtomicAnimation>;
