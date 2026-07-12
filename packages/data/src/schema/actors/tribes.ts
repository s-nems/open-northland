import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

export const AtomicBinding = z.strictObject({
  jobType: TypeId,
  atomicId: AtomicId,
  animation: z.string(),
});
export type AtomicBinding = z.infer<typeof AtomicBinding>;

/**
 * One tech-graph edge from `tribetypes` `jobEnables<Kind> <jobType> <targetId>` — having a settler
 * of `jobType` in the tribe *unlocks* a target the tribe can then produce/build/train/use. The four
 * source keys (`jobEnablesGood`/`jobEnablesHouse`/`jobEnablesJob`/`jobEnablesVehicle`) differ only in
 * what kind of id the target is, so they unify into one record discriminated by `kind`; the target
 * id is keyed within that kind's type table (a `good`→{@link GoodType}, `house`→{@link BuildingType},
 * `job`→{@link JobType}, `vehicle`→{@link VehicleType} via its `type`/`logicvehicletype` namespace,
 * which is distinct from the building namespace).
 *
 * This is the *gate* half of the progression graph — the original keys availability of goods/houses/
 * jobs/vehicles on a job being present, which is in turn gated by training/experience (`trainforjob`/
 * `needfor*`, a later slice). Edges are kept in **exact source file order** (the data interleaves the
 * four kinds within a job's block, not grouped by kind); a tribe may repeat a `(jobType, kind,
 * targetId)` triple, kept verbatim like {@link AtomicBinding} (the raw source stays faithful).
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
 * One experience requirement from `tribetypes` `{need,train}for{job,good} <targetId> <amount>
 * <expType> [expType2]` — the *experience-threshold* half of progression, sitting under the
 * {@link JobEnables} *who-unlocks-it* gate. Two orthogonal dimensions:
 *
 * - `requirement`: `need` (`needfor*` — the XP the settler must already have accrued to unlock the
 *   target) vs `train` (`trainfor*` — the schooling time/XP to acquire it at a training house, paid
 *   in a synthetic "school" experience type, not a real work track).
 * - `target`: `job` (`*forjob` — the unlocked job id) vs `good` (`*forgood` — the unlocked good id).
 *
 * `experienceTypes` mostly name `humanjobexperiencetypes` `typeId`s, but they span an id space
 * **wider than that 70-entry table** — `need` lines reach 72/73/75 and `train` lines pay in
 * synthetic "school" markers (observed 57/77) — none of which are in the experience table. So they
 * are captured but deliberately **not** cross-validated (validating them would false-positive —
 * unlike the `vehicle` {@link JobEnables} kind, which DOES resolve now the `vehicletypes` table is
 * extracted). A line carries one or two expTypes (the optional second is rare); kept in source order.
 */
export const JobRequirementKind = z.enum(['need', 'train']);
export type JobRequirementKind = z.infer<typeof JobRequirementKind>;
export const JobRequirementTarget = z.enum(['job', 'good']);
export type JobRequirementTarget = z.infer<typeof JobRequirementTarget>;

export const JobRequirement = z.strictObject({
  /** `need` (XP already accrued) vs `train` (schooling), from the `need`/`train` key prefix. */
  requirement: JobRequirementKind,
  /** `job` vs `good`, from the `forjob`/`forgood` key suffix — which table `targetId` indexes. */
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
  /** `setatomic` bindings in file order — a tribe's atomic→animation vocabulary, per job. */
  atomicBindings: z.array(AtomicBinding).default([]),
  /** `jobEnables*` tech-graph edges in file order — what each job unlocks for the tribe. */
  jobEnables: z.array(JobEnables).default([]),
  /** `{need,train}for{job,good}` XP/schooling requirements in file order — the gate's threshold half. */
  jobRequirements: z.array(JobRequirement).default([]),
  source: Provenance.optional(),
});
export type TribeType = z.infer<typeof TribeType>;

/**
 * One timed event inside an atomic animation (`event`/`eventx <at> <type> [value]` in
 * `atomicanimations.ini`). `at` is the offset within the animation's `length`; `type` + `value`
 * form an undocumented numeric vocabulary (good yields, hunger/morale deltas, sound/effect cues) —
 * captured faithfully here and interpreted later by the Phase-2 AtomicSystem, mirroring how
 * {@link AtomicId} stays a raw id with no master table. `value` is optional and may be signed.
 * `extended` marks the `eventx` variant (a distinct event channel in the source) from plain `event`.
 */
export const AtomicEvent = z.strictObject({
  at: z.number().int().nonnegative(),
  type: z.number().int().nonnegative(),
  value: z.number().int().optional(),
  extended: z.boolean().default(false),
});
export type AtomicEvent = z.infer<typeof AtomicEvent>;

/**
 * Timing + effect data for one named animation from `atomicanimations.ini` (the `culturesnation` mod
 * ships a readable `.ini`; the base game has it as `.cif`). `name` is the join key — a tribe's
 * `setatomic <job> <atomic> "anim"` binding ({@link AtomicBinding}) names the animation here, so this
 * is where an atomic's *duration* (`length`, in animation ticks), facing (`startdirection`) and timed
 * `events` (yields/effects) live. Cross-referencing tribe bindings against these names is deferred:
 * the mod's readable set is a subset of the base-game animations, so absent names aren't dangling.
 */
export const AtomicAnimation = z.strictObject({
  /** Filesystem-safe slug of `name`, for legibility/parity with the other IR types. Display-only —
   *  it lowercases, so it is NOT the join key; resolve `setatomic` bindings against `name`, not `id`. */
  id: z.string(),
  /** The animation's exact name — the resolvable key referenced by `tribetypes` `setatomic`. */
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
