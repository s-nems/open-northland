/**
 * A settler's life stage is encoded as its `jobType`, not a separate field: the first five `jobtypes`
 * records are age/sex classes, pinned to `Data/GameSourceIncludes/logicdefines.inc`
 * (`JOB_TYPE_HUMAN_BABY_FEMALE = 1` .. `JOB_TYPE_HUMAN_WOMAN = 5`, `JOB_TYPE_HUMAN_CIVILIST = 6`) and the
 * matching `Data/logic/jobtypes.ini` records. A settler keeps the sex it was born with across every
 * promotion.
 */

import {
  Age,
  Health,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  MissionBehaviour,
  Person,
  Residence,
  Settler,
  setSettlerJob,
} from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { parentsByChild, releaseWidowedParentsOf, settleWidowhood } from '../family/widowhood.js';

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

function isBaby(jobType: number | null): boolean {
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
 * Original behavior: every human's age counter starts at 0 and gains one per game tick while it is not
 * ageless. A baby turns child once the counter reaches 1441 and a child turns adult at 2881, one stage per
 * tick; a child placed by the map starts at 0 too. No readable rule file carries these numbers.
 */
export const CHILD_AGE_TICKS = 1441;
export const ADULT_AGE_TICKS = 2881;

/** The age counter's ticks per year the original's selection panel shows a growing settler's age in. */
export const TICKS_PER_AGE_YEAR = 270;

/** A settler's life stage, the distinction the original draws over `JobType`. */
export type AgeClass = 'adult' | 'baby' | 'child';

/**
 * The life stage a job row names. Matched by job `id` slug rather than the `logicdefines.inc`
 * `JOB_TYPE_HUMAN_*` ids because a synthetic fixture's adult job id can collide with an age-class id.
 */
export function ageClassOfJobId(jobId: string | undefined): AgeClass {
  switch (jobId) {
    case 'baby_female':
    case 'baby_male':
      return 'baby';
    case 'child_female':
    case 'child_male':
      return 'child';
    default:
      return 'adult';
  }
}

function isMaleStage(jobType: number | null): boolean {
  return jobType === BABY_MALE || jobType === CHILD_MALE;
}

/** The age in ticks `age` stands at once the growth pass of `tick` has run, the reading for a snapshot of
 *  `tick`. An age no pass has counted yet still reads as stored. */
export function ageTicksAt(
  age: { readonly ticks: number; readonly asOf: number | null },
  tick: number,
): number {
  return age.asOf === null ? age.ticks : age.ticks + (tick - age.asOf);
}

/** Count the growth pass of `tick` into `e`'s age and return it. Only the first pass after the age was set
 *  writes the component; every later one is derived from that anchor. */
function countGrowthPass(world: World, e: Entity, tick: number): number {
  const age = world.get(e, Age);
  if (age.asOf !== null) return ageTicksAt(age, tick);
  const counted = world.mut(e, Age);
  counted.ticks += 1;
  counted.asOf = tick;
  return counted.ticks;
}

/** Stop `e`'s age at what it was before the pass of `tick`: an unanchored age no longer advances, and the
 *  pass that finds the ageless bit cleared anchors it again. */
function holdAge(world: World, e: Entity, tick: number): void {
  const age = world.get(e, Age);
  if (age.asOf === null) return;
  const held = world.mut(e, Age);
  held.ticks = ageTicksAt(age, tick - 1);
  held.asOf = null;
}

/**
 * Age each {@link Age}-bearing settler one tick and promote it through the non-working life stages. Only a
 * settler born young carries an `Age`, and reaching adulthood removes it, so this is a no-op for every
 * settler spawned already-adult. Graduates are collected first, so no component is removed mid-query.
 *
 * A pass reads only the settlers {@link GrowthSchedule} names; for any other the pass is a no-op.
 */
export const growthSystem: System = (world, ctx) => {
  const schedule = growthScheduleOf(world);
  const visits = schedule.take(world, ctx.tick);
  const graduated: Entity[] = [];
  for (const e of visits ?? world.query(Age, Person)) {
    // Original behavior: a human with the ageless bit adds nothing to its age.
    if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.AGELESS)) {
      holdAge(world, e, ctx.tick);
      continue;
    }
    const ticks = countGrowthPass(world, e, ctx.tick);
    const jobType = world.get(e, Settler).jobType;
    const line = nextStageAge(jobType);
    if (line === null) continue;
    if (ticks < line) {
      schedule.wakeAt(e, ctx.tick + (line - ticks));
      continue;
    }
    const male = isMaleStage(jobType);
    if (isChild(jobType)) {
      setSettlerJob(world, e, male ? CIVILIST_JOB : WOMAN_JOB);
      graduated.push(e);
      continue;
    }
    setSettlerJob(world, e, male ? CHILD_MALE : CHILD_FEMALE);
    schedule.wakeAt(e, ctx.tick + Math.max(1, ADULT_AGE_TICKS - ticks));
  }
  const parents = graduated.length > 1 ? parentsByChild(world, graduated) : undefined;
  for (const e of graduated) {
    // A child killed earlier this tick still crosses the age line before CleanupSystem reaps it, and a
    // corpse has no birthday to announce.
    if ((world.tryGet(e, Health)?.hitpoints ?? 1) > 0) ctx.events.emit({ kind: 'settlerGrewUp', entity: e });
    world.remove(e, Age);
    // Authored: a grown child moves out instead of counting as a second family against its parents'
    // `homeSize`. The Age removal above also expires a widowed parent's carve-out.
    world.remove(e, Residence);
    if (parents === undefined) releaseWidowedParentsOf(world, e);
    else for (const parent of parents.get(e) ?? []) settleWidowhood(world, parent);
  }
  schedule.settle(ctx.tick);
};

/** The `Age.ticks` at which a settler of `jobType` moves up a stage, or null for a job no age promotes. */
function nextStageAge(jobType: number | null): number | null {
  if (isBaby(jobType)) return CHILD_AGE_TICKS;
  return isChild(jobType) ? ADULT_AGE_TICKS : null;
}

/**
 * The growing settlers a pass must read: those whose Age, Person, Settler or behaviour mask changed since
 * the last pass, and those reaching a stage line this tick. Between those a settler's age class holds and
 * its stored Age needs no write, so the pass would change nothing for it.
 */
class GrowthSchedule {
  private readonly feed: ChangeFeed;
  private readonly due = new Map<number, Entity[]>();
  private readonly dueOf = new Map<Entity, number>();
  /** The tick of the last pass this schedule covers, or null when the next pass reads everyone. */
  private passedTick: number | null = null;
  private readonly visits: Entity[] = [];
  private readonly pending = new Set<Entity>();
  private readonly note = (e: Entity): void => {
    this.pending.add(e);
  };

  constructor(world: World) {
    this.feed = world.watchChanges(
      [Age, Person, Settler, MissionBehaviour],
      [Age, Settler, MissionBehaviour],
    );
  }

  /** The settlers the pass of `tick` reads in the {@link Age} query's order, or null for all of them. */
  take(world: World, tick: number): readonly Entity[] | null {
    this.pending.clear();
    this.visits.length = 0;
    if (this.passedTick !== tick - 1 || (this.feed.pending && this.feed.drain(this.note))) {
      // The pass reads everyone and schedules each afresh.
      this.due.clear();
      this.dueOf.clear();
      return null;
    }
    const bucket = this.due.get(tick);
    if (bucket !== undefined) {
      for (const e of bucket) if (this.dueOf.get(e) === tick) this.pending.add(e);
      this.due.delete(tick);
    }
    for (const e of this.pending) {
      this.dueOf.delete(e);
      if (!world.has(e, Age) || !world.has(e, Person)) this.pending.delete(e);
    }
    if (this.pending.size === 1) this.visits.push(...this.pending);
    else if (this.pending.size > 1) {
      for (const e of world.query(Age, Person)) if (this.pending.has(e)) this.visits.push(e);
    }
    return this.visits;
  }

  wakeAt(e: Entity, tick: number): void {
    this.dueOf.set(e, tick);
    const bucket = this.due.get(tick);
    if (bucket === undefined) this.due.set(tick, [e]);
    else bucket.push(e);
  }

  /** Report a growing settler the next pass would skip although its age class is due or off. */
  verify(world: World): string[] {
    const passed = this.passedTick;
    if (passed === null) return [];
    const written = new Set<Entity>();
    if (this.feed.peek((e) => written.add(e))) return [];
    let stale = 0;
    for (const e of world.query(Age, Person)) {
      if (written.has(e)) continue;
      if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.AGELESS)) {
        if (world.get(e, Age).asOf !== null) stale++;
        continue;
      }
      const line = nextStageAge(world.get(e, Settler).jobType);
      if (line === null) continue;
      const ticks = ageTicksAt(world.get(e, Age), passed + 1);
      const due = this.dueOf.get(e);
      const expected = passed + Math.max(1, line - ticks + 1);
      if (world.get(e, Age).asOf === null || due === undefined || due !== expected) stale++;
    }
    return stale === 0 ? [] : [`growthSchedule: ${stale} children are not scheduled at their next stage`];
  }

  /** Close the pass of `tick`: its own writes are already scheduled, so the feed forgets them. */
  settle(tick: number): void {
    if (this.feed.drain(noop)) {
      this.passedTick = null;
      return;
    }
    this.passedTick = tick;
  }
}

const noop = (): void => {};

const schedules = new WeakMap<World, GrowthSchedule>();

function growthScheduleOf(world: World): GrowthSchedule {
  let schedule = schedules.get(world);
  if (schedule === undefined) {
    const created = new GrowthSchedule(world);
    world.registerCacheVerifier('growthSchedule', () => created.verify(world));
    schedules.set(world, created);
    schedule = created;
  }
  return schedule;
}
