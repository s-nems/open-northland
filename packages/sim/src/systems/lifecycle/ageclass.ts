/**
 * A settler's life stage is encoded as its `jobType`, not a separate field: the first five `jobtypes`
 * records are age/sex classes, pinned to `Data/GameSourceIncludes/logicdefines.inc`
 * (`JOB_TYPE_HUMAN_BABY_FEMALE = 1` .. `JOB_TYPE_HUMAN_WOMAN = 5`, `JOB_TYPE_HUMAN_CIVILIST = 6`) and the
 * matching `Data/logic/jobtypes.ini` records. A settler keeps the sex it was born with across every
 * promotion.
 */

import { Age, Health, Residence, Settler, setSettlerJob } from '../../components/index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Entity, World } from '../../ecs/world.js';
import type { ContentContext, System } from '../context.js';
import { releaseWidowedParentsOf } from '../family/widowhood.js';
// The module, not the readviews barrel: the barrel imports CIVILIST_JOB back from here.
import { settlerHitpoints } from '../readviews/tribes/civilizations.js';

/** The human age-class job ids (`logicdefines.inc` `JOB_TYPE_HUMAN_*`). */
export const BABY_FEMALE = 1;
export const BABY_MALE = 2;
export const CHILD_FEMALE = 3;
export const CHILD_MALE = 4;

/** The adult female role (`JOB_TYPE_HUMAN_WOMAN = 5`) a girl matures into: an adult job the original
 * employs (domestic/`make_love`), not a non-working age class. */
export const WOMAN_JOB = 5;

/** The generic adult man (`JOB_TYPE_HUMAN_CIVILIST = 6`) a boy matures into. Authored: a grown boy is a
 * civilian the player re-trades, not an auto-employed jobless idler. */
export const CIVILIST_JOB = 6;

export function isBaby(jobType: number | null): boolean {
  return jobType === BABY_FEMALE || jobType === BABY_MALE;
}

export function isChild(jobType: number | null): boolean {
  return jobType === CHILD_FEMALE || jobType === CHILD_MALE;
}

/**
 * Whether a `jobType` is one of the stages with no adult trade. `woman` (id 5) is an adult role the
 * original does employ, so it is not one; `null` is a trade-less adult, not a born stage.
 */
export function isNonWorkingAge(jobType: number | null): boolean {
  return isBaby(jobType) || isChild(jobType);
}

/**
 * Growth cadence, observed on the running original: a baby becomes a child at 4 years and an adult at 12,
 * with those 12 years running in 4 minutes of 1x play. No readable rule file carries any of it, and the
 * tick counts below additionally rest on the approximated `TICKS_PER_SECOND`.
 */
const CHILD_AGE_YEARS = 4;
const ADULT_AGE_YEARS = 12;
const CHILDHOOD_SECONDS_AT_1X = 4 * 60;

/** Sim ticks per year of a settler's age: 240, one year every 20 s at 1x. The sim has no other calendar. */
export const TICKS_PER_AGE_YEAR = (CHILDHOOD_SECONDS_AT_1X * TICKS_PER_SECOND) / ADULT_AGE_YEARS;

/** The `Age.ticks` at which a baby becomes a child - an age on the `Age.ticks` axis, not a stage length. */
export const CHILD_AGE_TICKS = CHILD_AGE_YEARS * TICKS_PER_AGE_YEAR;

/** The `Age.ticks` at which a child becomes an adult and stops carrying an {@link Age}. */
export const ADULT_AGE_TICKS = ADULT_AGE_YEARS * TICKS_PER_AGE_YEAR;

/**
 * The `Age.ticks` a settler spawned directly into an age-class job starts with, or null for an adult slug.
 * Matched by job `id` slug because a synthetic fixture's adult job id can collide with an age-class id.
 */
export function spawnAgeTicks(jobId: string | undefined): number | null {
  switch (jobId) {
    case 'baby_female':
    case 'baby_male':
      return 0;
    case 'child_female':
    case 'child_male':
      return CHILD_AGE_TICKS;
    default:
      return null;
  }
}

function isMaleStage(jobType: number | null): boolean {
  return jobType === BABY_MALE || jobType === CHILD_MALE;
}

/**
 * Age each {@link Age}-bearing settler one tick and promote it through the non-working life stages. Only a
 * settler born young carries an `Age`, and reaching adulthood removes it, so this is a no-op for every
 * settler spawned already-adult. Graduates are collected first, so no component is removed mid-query.
 */
export const growthSystem: System = (world, ctx) => {
  const graduated: Entity[] = [];
  for (const e of world.query(Age, Settler)) {
    const age = world.get(e, Age);
    const settler = world.get(e, Settler);
    age.ticks += 1;
    if (age.ticks >= ADULT_AGE_TICKS) {
      setSettlerJob(world, e, isMaleStage(settler.jobType) ? CIVILIST_JOB : WOMAN_JOB);
      graduated.push(e);
      continue;
    }
    const target = ageClassAt(age.ticks, isMaleStage(settler.jobType));
    if (target !== settler.jobType) setSettlerJob(world, e, target);
  }
  for (const e of graduated) {
    world.remove(e, Age);
    // Authored: a grown child moves out, so it stops filling a slot in its parents' family and picks its
    // own home when the player assigns one. Its Age removal also expires a widowed parent's carve-out.
    world.remove(e, Residence);
    releaseWidowedParentsOf(world, e);
    applyAdultHitpoints(world, ctx, e);
  }
};

/**
 * Swap a grown settler's childhood {@link Health} pool for its tribe's adult one, carrying the wound across
 * as a fraction of the new pool (floored at 1 HP); a tribe declaring no pool leaves the settler alone.
 * Approximation: the original's growth-time health handling is not established.
 */
function applyAdultHitpoints(world: World, ctx: ContentContext, e: Entity): void {
  const pool = settlerHitpoints(ctx.content, world.get(e, Settler).tribe);
  const health = world.tryGet(e, Health);
  if (pool <= 0 || health === undefined || health.max === pool) return;
  // A settler killed earlier this tick awaits CleanupSystem's reap; a birthday must not revive it, and
  // `max > 0` keeps the fraction below a real division.
  if (health.hitpoints <= 0 || health.max <= 0) return;
  const scaled = Math.max(1, Math.trunc((health.hitpoints * pool) / health.max));
  world.write(e, Health, (h) => {
    h.hitpoints = scaled;
    h.max = pool;
  });
}

/**
 * The age-class `jobType` a settler that has lived `ticks`, still short of adulthood, should currently
 * hold for the given sex.
 */
function ageClassAt(ticks: number, male: boolean): number {
  if (ticks < CHILD_AGE_TICKS) return male ? BABY_MALE : BABY_FEMALE;
  return male ? CHILD_MALE : CHILD_FEMALE;
}
