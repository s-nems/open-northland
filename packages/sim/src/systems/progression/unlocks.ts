import type { HumanJobExperienceType, JobRequirement, JobRequirementTarget } from '@open-northland/data';
import {
  isAiPlayer,
  ownerOf,
  professionProgressionEnabled,
  Settler,
  SettlerProgress,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { jobEnabled, typeAllowed } from './availability.js';
import { requirementRepeats } from './bonus.js';

export * from './availability.js';

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
  readonly learned?: { readonly job: readonly number[]; readonly good: readonly number[] } | undefined;
}

export function needSubjectOf(world: World, settler: Entity): NeedSubject {
  const { experience, learned } = world.get(settler, SettlerProgress);
  return { tribe: world.get(settler, Settler).tribe, owner: ownerOf(world, settler), experience, learned };
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
  if (subject.learned?.[target].includes(targetId)) return true;
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
 * Whether a settler has paid a job's barracks schooling - every `trainforjob` row for `jobType` met in
 * TRAINING repeats. This is the alternative path onto a fighter trade: its `needforjob` rows read tracks
 * only that band itself accrues (viking `needforjob 31 5 69`), so a civilian could never earn one by
 * working. A job with no `train` row is not schooled, so this can only widen the gate.
 *
 * Source basis (readable-semantics inference): the data states both row kinds but not how they combine,
 * and reading them as alternatives is what keeps the `trainfor*` rows from being dead.
 */
function schoolingMet(
  tracks: readonly HumanJobExperienceType[],
  requirements: readonly JobRequirement[],
  experience: ReadonlyMap<number, number>,
  jobType: number,
): boolean {
  let schooled = false;
  for (const req of requirements) {
    if (req.requirement !== 'train' || req.target !== 'job' || req.targetId !== jobType) continue;
    if (requirementRepeats(tracks, experience, req.experienceTypes) < req.amount) return false;
    schooled = true;
  }
  return schooled;
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
