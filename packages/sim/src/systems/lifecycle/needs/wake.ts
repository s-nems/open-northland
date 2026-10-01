import type { ContentSet } from '@open-northland/data';
import { Person, SettlerNeeds, type SettlerNeedsView } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { ChangeFeed, Entity, World } from '../../../ecs/world.js';
import { DRAIN_CLASS_MEMBERSHIP, DRAIN_CLASS_VALUES, drainClassOf } from './drain-class.js';
import { nextBandTick } from './levels.js';
import { NEED_CRITICAL_THRESHOLD } from './scale.js';
import { woundedPersonsOf } from './wounded.js';

const NEVER = Number.POSITIVE_INFINITY;

/** Whether a seat's refill could write `needs`: a bar it tops up stands at or past the critical mark. */
function atCritical(needs: SettlerNeedsView): boolean {
  return needs.hunger >= NEED_CRITICAL_THRESHOLD || needs.fatigue >= NEED_CRITICAL_THRESHOLD;
}

function mark(set: Set<Entity>, e: Entity, member: boolean): void {
  if (member) set.add(e);
  else set.delete(e);
}

/**
 * The persons the needs pass must visit, so it scales with the bars and drains that move rather than
 * every person: those whose drain class a watched write touched, those whose bar reaches a band
 * threshold this tick, the starving, the wounded, and on a refill tick those at the critical mark.
 * Every other person's pass would be a no-op. Derived from the stores and rebuilt by a full pass after
 * a restore, a skipped tick, a content swap or a feed overflow; never saved.
 */
export class NeedsWake {
  private readonly classFeed: ChangeFeed;
  private readonly barsFeed: ChangeFeed;
  /** Entities by the tick of their next band crossing; an entry whose {@link dueOf} moved is stale. */
  private readonly buckets = new Map<number, Entity[]>();
  private readonly spareBuckets: Entity[][] = [];
  private readonly dueOf = new Map<Entity, number>();
  /** Stored hunger at ONE: the hitpoint step bites these every tick. */
  private readonly starving = new Set<Entity>();
  private readonly critical = new Set<Entity>();
  /** This tick's visits, listed once each through {@link listedOn}; reused, so a steady pass allocates
   *  nothing. */
  private readonly visits: Entity[] = [];
  private readonly listedOn = new Map<Entity, number>();
  private listingTick = 0;
  /** The tick of the last pass this list covers, or null when the next pass visits every person. */
  private passedTick: number | null = null;
  private content: ContentSet | null = null;
  /** The first pass a rescheduled bar can still be raised by. */
  private fromTick = 0;
  private readonly visit = (e: Entity): void => {
    if (this.listedOn.get(e) === this.listingTick || !this.world.has(e, Person)) return;
    this.listedOn.set(e, this.listingTick);
    this.visits.push(e);
  };
  private readonly rescheduleEntity = (e: Entity): void => this.reschedule(e);
  /** A visited entity whose band tick the pass did not move past it, such as one it left unwritten. */
  private readonly rescheduleSettled = (e: Entity): void => {
    if ((this.dueOf.get(e) ?? NEVER) < this.fromTick) this.reschedule(e);
  };

  constructor(private readonly world: World) {
    this.classFeed = world.watchChanges(DRAIN_CLASS_MEMBERSHIP, DRAIN_CLASS_VALUES);
    this.barsFeed = world.watchChanges([SettlerNeeds], [SettlerNeeds]);
  }

  /** The persons the pass of `tick` visits, or null when it must visit every person. */
  take(tick: number, content: ContentSet, refilling: boolean): readonly Entity[] | null {
    this.visits.length = 0;
    this.listingTick = tick;
    if (this.passedTick !== tick - 1 || content !== this.content) return null;
    if (this.classFeed.pending && this.classFeed.drain(this.visit)) return null;
    this.fromTick = tick;
    if (this.barsFeed.pending && this.barsFeed.drain(this.rescheduleEntity)) return null;
    const bucket = this.buckets.get(tick);
    if (bucket !== undefined) {
      for (let i = 0; i < bucket.length; i++) {
        const e = bucket[i];
        if (e !== undefined && this.dueOf.get(e) === tick) this.visit(e);
      }
      this.buckets.delete(tick);
      bucket.length = 0;
      this.spareBuckets.push(bucket);
    }
    this.starving.forEach(this.visit);
    eachOf(woundedPersonsOf(this.world), this.visit);
    if (refilling) this.critical.forEach(this.visit);
    return this.visits;
  }

  /** Bring the list up to the bars the pass of `tick` left, after a pass over every person if `everyone`. */
  settle(tick: number, content: ContentSet, everyone: boolean): void {
    this.fromTick = tick + 1;
    if (everyone) {
      this.rebuild(content);
    } else if (this.barsFeed.pending && this.barsFeed.drain(this.rescheduleEntity)) {
      this.rebuild(content);
    } else {
      eachOf(this.visits, this.rescheduleSettled);
    }
    this.passedTick = tick;
  }

  /** Forget the list while needs are off, so the next pass with them on visits every person. */
  invalidate(): void {
    this.passedTick = null;
  }

  private rebuild(content: ContentSet): void {
    this.content = content;
    this.buckets.clear();
    this.dueOf.clear();
    this.starving.clear();
    this.critical.clear();
    this.listedOn.clear();
    this.classFeed.drain(noop);
    this.barsFeed.drain(noop);
    for (const e of this.world.query(SettlerNeeds)) this.reschedule(e);
  }

  private reschedule(e: Entity): void {
    const needs = this.world.tryGet(e, SettlerNeeds);
    if (needs === undefined) {
      this.dueOf.delete(e);
      this.listedOn.delete(e);
      this.starving.delete(e);
      this.critical.delete(e);
      return;
    }
    mark(this.starving, e, needs.hunger === ONE);
    mark(this.critical, e, atCritical(needs));
    const due = nextBandTick(needs, this.fromTick);
    if (due === this.dueOf.get(e)) return;
    if (due === NEVER) {
      this.dueOf.delete(e);
      return;
    }
    this.dueOf.set(e, due);
    let bucket = this.buckets.get(due);
    if (bucket === undefined) {
      bucket = this.spareBuckets.pop() ?? [];
      this.buckets.set(due, bucket);
    }
    bucket.push(e);
  }

  verify(): string[] {
    const { passedTick, content } = this;
    if (passedTick === null || content === null) return [];
    const pending = new Set<Entity>();
    const note = (e: Entity): void => {
      pending.add(e);
    };
    if (this.classFeed.peek(note) || this.barsFeed.peek(note)) return [];
    let due = 0;
    let marks = 0;
    let drains = 0;
    for (const e of this.world.query(SettlerNeeds)) {
      if (pending.has(e)) continue;
      const needs = this.world.get(e, SettlerNeeds);
      const expected = nextBandTick(needs, passedTick + 1);
      const held = this.dueOf.get(e) ?? NEVER;
      if (held !== expected || (held !== NEVER && !this.buckets.get(held)?.includes(e))) due++;
      if (this.starving.has(e) !== (needs.hunger === ONE) || this.critical.has(e) !== atCritical(needs))
        marks++;
      if (this.world.has(e, Person) && needs.drain !== drainClassOf(this.world, content, e)) drains++;
    }
    for (const e of this.dueOf.keys()) if (!pending.has(e) && !this.world.has(e, SettlerNeeds)) due++;
    const problems: string[] = [];
    if (due > 0) problems.push(`needsWake: ${due} band tick(s) diverge from the stored bars`);
    if (marks > 0)
      problems.push(`needsWake: ${marks} starving or critical mark(s) diverge from the stored bars`);
    if (drains > 0) problems.push(`needsWake: ${drains} drain(s) diverge from the drain class`);
    return problems;
  }
}

function noop(): void {}

/** `for...of` over an array allocates an iterator result per element on this path; an index does not. */
function eachOf(list: readonly Entity[], visit: (e: Entity) => void): void {
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e !== undefined) visit(e);
  }
}

const held = new WeakMap<World, NeedsWake>();

export function needsWakeOf(world: World): NeedsWake {
  let wake = held.get(world);
  if (wake === undefined) {
    const created = new NeedsWake(world);
    world.registerCacheVerifier('needsWake', () => created.verify());
    held.set(world, created);
    wake = created;
  }
  return wake;
}
