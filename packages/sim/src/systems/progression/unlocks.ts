import type {
  HumanJobExperienceType,
  JobEnablesKind,
  JobRequirement,
  JobRequirementTarget,
  Recipe,
  VehicleType,
} from '@open-northland/data';
import { isAiPlayer, ownerOf, professionProgressionEnabled, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { aliveTribeJobs } from './alive-jobs.js';
import { requirementRepeats } from './bonus.js';

/** Kill-switch for the building tech-unlock gate, currently off. Annotated `boolean` rather than the
 *  literal so both branches of the gate stay live for the type checker. */
const BUILDING_UNLOCK_GATE_ENABLED: boolean = false;

/**
 * Whether a building of `buildingType` is unlocked for `tribe` right now: the read side of the
 * `tribetypes` `jobEnablesHouse <jobType> <houseType>` edges, a house enabled once a settler of the
 * gating job is present in the tribe.
 *
 * While {@link BUILDING_UNLOCK_GATE_ENABLED} is false this always returns true, but stays a live call at
 * every gate site, so flipping the switch restores the behaviour with no code moves.
 */
export function buildingEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  buildingType: number,
): boolean {
  if (!BUILDING_UNLOCK_GATE_ENABLED) return true;
  return tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType);
}

/**
 * Whether producing `goodType` is unlocked for `tribe` right now: the `good` kind of the same
 * `jobEnables` tech-graph, so a tannery makes no leather until the tribe has the tanner that enables it.
 */
export function goodEnabled(world: World, ctx: SystemContext, tribe: number, goodType: number): boolean {
  if (!professionProgressionEnabled(world)) return true; // free start: goods are civilian, no carve-out
  return tribeUnlockEnabled(world, ctx, tribe, 'good', goodType);
}

export function recipeOutputsEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  recipe: Recipe,
): boolean {
  for (const output of recipe.outputs) {
    if (!goodEnabled(world, ctx, tribe, output.goodType)) return false;
  }
  return true;
}

/**
 * Shared read side of the `jobEnables` tech-graph for a single `(kind, targetId)`: enabled when no edge of
 * `kind` gates the target, or a settler of a gating job is currently alive in the tribe. A tribe absent
 * from content gates nothing, so a map with no tribe-type data still places its start buildings. The
 * tribe id is the `TribeType` `typeId` that `Settler.tribe` and `Building.tribe` carry.
 *
 * Both halves are memoized, so a probe costs only the handful of edges that gate this one target. A pure
 * membership query, so nothing here needs canonical order.
 */
function tribeUnlockEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  kind: JobEnablesKind,
  targetId: number,
): boolean {
  const enablingJobs = contentIndex(ctx.content).enablingJobsByTribe.get(tribe)?.get(kind)?.get(targetId);
  if (enablingJobs === undefined) return true;

  const trades = aliveTribeJobs(world).get(tribe);
  if (trades === undefined) return false; // the tribe holds no trade at all
  for (const jobType of enablingJobs) {
    if (trades.has(jobType)) return true;
  }
  return false;
}

/**
 * The ship types `tribe` has currently unlocked, sorted ascending by `typeId` so the order cannot depend
 * on `content.vehicles` declaration order. Composes the `passengerSlots` ship classification with the
 * `vehicle`-kind tech gate. Both axes are pinned to extracted data, and this adds no mechanic: nothing
 * embarks and no hull is spawned.
 */
export function tribeShipsUnlocked(world: World, ctx: SystemContext, tribe: number): VehicleType[] {
  return ctx.content.vehicles
    .filter((v) => isShipVehicle(v) && tribeUnlockEnabled(world, ctx, tribe, 'vehicle', v.typeId))
    .sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether a settler's accrued XP satisfies a single `needfor*` requirement from the
 * `{need,train}for{job,good}` table. The requirement's `amount` is measured in repeats of its
 * `experienceTypes` tracks, which is what makes the data's flat 5..30 amounts commensurable across tracks
 * whose factors span 1..250. A requirement with no `experienceTypes` is vacuously met, and a `train` row
 * is read by {@link schoolingMet} instead.
 *
 * Approximated: whether a two-`expType` line means "sum both" or "either alone" has no readable oracle,
 * so summing the named tracks is the deterministic reading.
 */
export function experienceRequirementMet(
  ctx: SystemContext,
  experience: ReadonlyMap<number, number>,
  requirement: JobRequirement,
): boolean {
  if (requirement.requirement !== 'need') return true;
  if (requirement.experienceTypes.length === 0) return true;
  const repeats = requirementRepeats(ctx.content.jobExperience, experience, requirement.experienceTypes);
  return repeats >= requirement.amount;
}

/** Who is asking a `needfor*` gate. */
export interface NeedSubject {
  readonly tribe: number;
  /** The owning player, or `undefined` for a neutral settler (which the gates do apply to). */
  readonly owner: number | undefined;
  readonly experience: ReadonlyMap<number, number>;
}

export function needSubjectOf(world: World, settler: Entity): NeedSubject {
  const s = world.get(settler, Settler);
  return { tribe: s.tribe, owner: ownerOf(world, settler), experience: s.experience };
}

/**
 * Whether the experience tech tree gates `owner`'s settlers at all. An AI seat never pays it (authored:
 * the progression toggle is a human-player setting and must not handicap the bots); a human or neutral
 * seat follows `ProgressionRules`.
 */
export function experienceGatesApply(world: World, owner: number | undefined): boolean {
  if (owner !== undefined && isAiPlayer(world, owner)) return false;
  return professionProgressionEnabled(world);
}

/**
 * Whether a settler meets every `needfor*` XP threshold gating a `(target, targetId)` for its tribe. A
 * target with several must clear all of them, and a tribe absent from content thresholds nothing. Where
 * the tree does not apply every civilian target is unthresholded, but fighter jobs stay gated either way:
 * on accrued XP, or on the barracks schooling {@link schoolingMet} reads.
 */
export function settlerMeetsNeed(
  world: World,
  ctx: SystemContext,
  subject: NeedSubject,
  target: JobRequirementTarget,
  targetId: number,
): boolean {
  const { tribe, owner, experience } = subject;
  const fighterJob = target === 'job' && isFighterJob(ctx.content, targetId);
  if (!experienceGatesApply(world, owner) && !fighterJob) return true;
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return true;
  if (
    fighterJob &&
    schoolingMet(ctx.content.jobExperience, tribeType.jobRequirements, experience, targetId)
  ) {
    return true;
  }
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== target || req.targetId !== targetId) continue;
    if (!experienceRequirementMet(ctx, experience, req)) return false;
  }
  return true;
}

/**
 * Whether a settler has paid a job's barracks schooling - every `trainforjob` row for `targetId` met in
 * TRAINING repeats. The alternative path onto a fighter trade: its `needforjob` rows read tracks only that
 * band itself accrues (viking `needforjob 31 5 69`), so a civilian could never earn one by working, and
 * meeting either path unlocks the trade. A target with no `train` row is not schooled, so this can only
 * widen the gate. Read for fighter targets only.
 *
 * Source basis (readable-semantics inference): the data states both row kinds but not how they combine.
 * Reading them as alternatives is what keeps the `trainfor*` rows from being dead.
 */
export function schoolingMet(
  tracks: readonly HumanJobExperienceType[],
  requirements: readonly JobRequirement[],
  experience: ReadonlyMap<number, number>,
  targetId: number,
): boolean {
  let schooled = false;
  for (const req of requirements) {
    if (req.requirement !== 'train' || req.target !== 'job' || req.targetId !== targetId) continue;
    if (requirementRepeats(tracks, experience, req.experienceTypes) < req.amount) return false;
    schooled = true;
  }
  return schooled;
}
