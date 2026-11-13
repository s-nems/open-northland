import type { ContentSet, JobRequirement, JobRequirementTarget } from '@open-northland/data';
import { ownerOf, professionProgressionEnabled, Settler, SettlerProgress } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext } from '../context.js';
import { isFighterJob, isHeroJob, isSoldierJob } from '../readviews/index.js';
import { jobEnabled, typeAllowed } from './availability.js';
import { requirementRepeats } from './bonus.js';

export * from './availability.js';

/**
 * Whether a settler's accrued XP satisfies a single `needfor*` requirement from the
 * `{need,train}for{job,good}` table. The requirement's `amount` is measured in repeats of its
 * `experienceTypes` tracks, which is what makes the data's flat 5..30 amounts commensurable across tracks
 * whose factors span 1..250. A requirement with no `experienceTypes` is vacuously met, and a `train` row
 * is a school course, not a threshold.
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
  /** The settler's current trade, null when it holds none. */
  readonly jobType: number | null;
  readonly experience: ReadonlyMap<number, number>;
  readonly learned: { readonly job: readonly number[]; readonly good: readonly number[] } | undefined;
}

export function needSubjectOf(world: World, settler: Entity): NeedSubject {
  const { experience, learned } = world.get(settler, SettlerProgress);
  const { tribe, jobType } = world.get(settler, Settler);
  return { tribe, owner: ownerOf(world, settler), jobType, experience, learned };
}

/** A {@link NeedSubject} a caller owns and refills, for a per-tick loop that keeps none past its gates. */
export type NeedSubjectScratch = { -readonly [K in keyof NeedSubject]: NeedSubject[K] };

export function emptyNeedSubject(): NeedSubjectScratch {
  return { tribe: 0, owner: undefined, jobType: null, experience: new Map(), learned: undefined };
}

/** {@link needSubjectOf} written into `into`. */
export function needSubjectInto(world: World, settler: Entity, into: NeedSubjectScratch): NeedSubject {
  const progress = world.get(settler, SettlerProgress);
  const settlerState = world.get(settler, Settler);
  into.tribe = settlerState.tribe;
  into.owner = ownerOf(world, settler);
  into.jobType = settlerState.jobType;
  into.experience = progress.experience;
  into.learned = progress.learned;
  return into;
}

/**
 * Whether a settler meets every `needfor*` XP threshold gating a `(target, targetId)` for its tribe. A
 * target with several must clear all of them, and a tribe absent from content thresholds nothing. A
 * fighter trade reads no experience row: {@link fighterTradeOpen} decides it, progression on or off.
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
  if (target === 'job' && isFighterJob(ctx.content, targetId))
    return fighterTradeOpen(ctx.content, subject, targetId);
  if (!professionProgressionEnabled(world)) return true;
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return true;
  const rows = needRowsOf(tribeType.jobRequirements)[target].get(targetId);
  if (rows === undefined) return true;
  for (const req of rows) {
    if (!experienceRequirementMet(ctx, experience, req)) return false;
  }
  return true;
}

/**
 * Whether a settler may take a fighter trade: only from inside its band, the soldier trades or the hero
 * trades, now or earlier, since a trade left behind stays learned. Inside the band the weapon is the
 * rank, so no threshold stands between classes; a civilian enters the soldier band through a barracks
 * term alone. Our rule, after the tribe tables, whose `needforjob` rows for both bands read fight tracks
 * only that band accrues and whose `trainforjob` rows name the barracks course.
 */
function fighterTradeOpen(content: ContentSet, subject: NeedSubject, jobType: number): boolean {
  const inBand = isHeroJob(content, jobType) ? isHeroJob : isSoldierJob;
  return (
    inBand(content, subject.jobType) || (subject.learned?.job.some((held) => inBand(content, held)) ?? false)
  );
}

/** A tribe's `needfor*` rows by target table and target id, in content order, indexed from the first
 *  `indexed` rows of its requirement list. */
interface NeedRows {
  readonly indexed: number;
  readonly job: ReadonlyMap<number, readonly JobRequirement[]>;
  readonly good: ReadonlyMap<number, readonly JobRequirement[]>;
}

/** Keyed by the content-owned requirement list. Re-indexed when the list's length changes, since a fixture
 *  may append rows to a loaded tribe. */
const needRowsByRequirements = new WeakMap<readonly JobRequirement[], NeedRows>();

function needRowsOf(requirements: readonly JobRequirement[]): NeedRows {
  const held = needRowsByRequirements.get(requirements);
  if (held !== undefined && held.indexed === requirements.length) return held;
  const job = new Map<number, JobRequirement[]>();
  const good = new Map<number, JobRequirement[]>();
  for (const req of requirements) {
    if (req.requirement !== 'need') continue;
    const byId = req.target === 'job' ? job : good;
    const list = byId.get(req.targetId);
    if (list === undefined) byId.set(req.targetId, [req]);
    else list.push(req);
  }
  const rows: NeedRows = { indexed: requirements.length, job, good };
  needRowsByRequirements.set(requirements, rows);
  return rows;
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
