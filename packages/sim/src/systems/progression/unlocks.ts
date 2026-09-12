import type {
  HumanJobExperienceType,
  JobEnablesKind,
  JobRequirement,
  JobRequirementTarget,
  Recipe,
  VehicleType,
} from '@open-northland/data';
import {
  isAiPlayer,
  mapPermission,
  ownerOf,
  professionProgressionEnabled,
  Settler,
  scriptAllows,
  scriptEnables,
  type UnlockKind,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { isShipVehicle } from '../readviews/vehicles.js';
import { aliveTribeJobs } from './alive-jobs.js';
import { requirementRepeats } from './bonus.js';

export function buildingEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  buildingType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'house', buildingType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'house', buildingType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType, owner)
  );
}

/**
 * Whether producing `goodType` is unlocked for `owner`'s `tribe` right now: the `good` kind of the same
 * `jobEnables` tech-graph, so a tannery makes no leather until the tribe has the tanner that enables it,
 * or until the map's script enabled the good for that player.
 */
export function goodEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  goodType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'good', goodType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'good', goodType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'good', goodType, owner)
  );
}

export function recipeOutputsEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  recipe: Recipe,
): boolean {
  for (const output of recipe.outputs) {
    if (!goodEnabled(world, ctx, owner, tribe, output.goodType)) return false;
  }
  return true;
}

export function jobEnabled(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  jobType: number,
): boolean {
  if (!typeAllowed(world, ctx, owner, tribe, 'job', jobType)) return false;
  if (!professionProgressionEnabled(world)) return true;
  return (
    scriptEnables(world, owner, tribe, 'job', jobType) ||
    tribeUnlockEnabled(world, ctx, tribe, 'job', jobType, owner)
  );
}

/**
 * Shared read side of the `jobEnables` tech-graph for a single `(kind, targetId)`: enabled when no edge of
 * `kind` gates the target, or a settler of a gating job is currently alive in the tribe. A tribe absent
 * from content gates nothing. The tribe id is the `TribeType` `typeId` that `Settler.tribe` and
 * `Building.tribe` carry.
 *
 * Both halves are memoized, so a probe costs only the handful of edges that gate this one target. A pure
 * membership query, so nothing here needs canonical order.
 */
function tribeUnlockEnabled(
  world: World,
  ctx: ContentContext,
  tribe: number,
  kind: JobEnablesKind,
  targetId: number,
  owner?: number,
): boolean {
  const enablingJobs = contentIndex(ctx.content).enablingJobsByTribe.get(tribe)?.get(kind)?.get(targetId);
  if (enablingJobs === undefined) return true;

  const trades = aliveTribeJobs(world, owner).get(tribe);
  if (trades === undefined) return false; // the tribe holds no trade at all
  for (const jobType of enablingJobs) {
    if (trades.has(jobType)) return true;
  }
  return false;
}

/**
 * The ship types `tribe` has currently unlocked, sorted ascending by `typeId` so the order cannot depend
 * on `content.vehicles` declaration order. Composes the extracted `passengerSlots` ship classification
 * with the `vehicle`-kind tech gate.
 */
export function tribeShipsUnlocked(
  world: World,
  ctx: ContentContext,
  tribe: number,
  owner?: number,
): VehicleType[] {
  return ctx.content.vehicles
    .filter((v) => isShipVehicle(v) && tribeUnlockEnabled(world, ctx, tribe, 'vehicle', v.typeId, owner))
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
  ctx: ContentContext,
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
 * target with several must clear all of them, and a tribe absent from content thresholds nothing. A
 * fighter job, gated even where {@link experienceGatesApply} is false, is met by accrued XP or by the
 * barracks schooling {@link schoolingMet} reads.
 */
export function settlerMeetsNeed(
  world: World,
  ctx: ContentContext,
  subject: NeedSubject,
  target: JobRequirementTarget,
  targetId: number,
): boolean {
  const { tribe, owner, experience } = subject;
  if (!typeAllowed(world, ctx, owner, tribe, target, targetId)) return false;
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
 * TRAINING repeats. This is the alternative path onto a fighter trade: its `needforjob` rows read tracks
 * only that band itself accrues (viking `needforjob 31 5 69`), so a civilian could never earn one by
 * working. A target with no `train` row is not schooled, so this can only widen the gate. Read for fighter
 * targets only.
 *
 * Source basis (readable-semantics inference): the data states both row kinds but not how they combine,
 * and reading them as alternatives is what keeps the `trainfor*` rows from being dead.
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

/** Map grants override authored bans; otherwise the tribe's initial allow table is authoritative. */
export function typeAllowed(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  if (scriptAllows(world, owner, tribe, kind, typeId) || scriptEnables(world, owner, tribe, kind, typeId))
    return true;
  return (
    mapPermission(world, owner, tribe, kind, typeId) ??
    contentIndex(ctx.content).tribes.get(tribe)?.permissions?.[kind].includes(typeId) ??
    true
  );
}

export function canChooseJob(
  world: World,
  ctx: ContentContext,
  subject: NeedSubject,
  jobType: number,
): boolean {
  return (
    jobEnabled(world, ctx, subject.owner, subject.tribe, jobType) &&
    settlerMeetsNeed(world, ctx, subject, 'job', jobType)
  );
}

export function unlockStatus(
  world: World,
  ctx: ContentContext,
  owner: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): { allowed: boolean; enabled: boolean; enablingJobs: number[] } {
  const allowed = typeAllowed(world, ctx, owner, tribe, kind, typeId);
  const enabled =
    kind === 'house'
      ? buildingEnabled(world, ctx, owner, tribe, typeId)
      : kind === 'good'
        ? goodEnabled(world, ctx, owner, tribe, typeId)
        : jobEnabled(world, ctx, owner, tribe, typeId);
  return {
    allowed,
    enabled,
    enablingJobs: [
      ...(contentIndex(ctx.content).enablingJobsByTribe.get(tribe)?.get(kind)?.get(typeId) ?? []),
    ],
  };
}
