import type { ContentSet } from '@open-northland/data';
import { AtomicClock, CurrentAtomic, Person, Settler } from '../../../components/index.js';
import type { ChangeFeed } from '../../../ecs/change-feed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { ContentContext } from '../../context.js';
import { nextAtomicEventTick } from './next-event.js';

/** What {@link AtomicSchedule.next} returns once the pass has nothing left; entity ids start at 1. */
export const NO_ATOMIC = 0 as Entity;

/** Entries the pass buffers start with; they double when a tick's atomics would not fit. */
const INITIAL_PASS_CAPACITY = 256;

/**
 * Which running atomics the executor visits on a tick: those filed under it as their next event
 * ({@link nextAtomicEventTick}), and those whose record, clock or settler identity changed since they
 * were last visited. A pass hands them out in the `CurrentAtomic` store's insertion order, as a walk of
 * the whole store would, including an atomic that starts while the pass runs. Derived from the stores
 * alone: a fresh schedule, as after a load or a content swap, visits every atomic once and files it from
 * there.
 */
class AtomicSchedule {
  private readonly due = new Map<number, Entity[]>();
  /** The tick of the last pass; any other predecessor makes the next pass walk the whole store. */
  private through: number | undefined;
  private tick = 0;
  /** The content the filed ticks were read off. */
  private ctx: ContentContext | undefined;
  /** This pass's atomics, their first {@link count} slots, ascending by {@link seqs}. */
  private entities = new Int32Array(INITIAL_PASS_CAPACITY);
  private seqs = new Float64Array(INITIAL_PASS_CAPACITY);
  private order = new Uint32Array(INITIAL_PASS_CAPACITY);
  private count = 0;
  private at = 0;
  /** Atomics that changed ahead of the walk while it ran, ascending by sequence; rarely any. */
  private readonly lateEntities: Entity[] = [];
  private readonly lateSeqs: number[] = [];
  private lateAt = 0;
  private current = NO_ATOMIC;
  private currentSeq = -1;

  constructor(
    private readonly world: World,
    private readonly feed: ChangeFeed,
  ) {}

  /** Start the pass of `tick` over `content`. */
  begin(tick: number, content: ContentSet): void {
    const world = this.world;
    if (this.ctx?.content !== content) {
      this.ctx = { content };
      this.through = undefined;
    }
    this.tick = tick;
    this.count = 0;
    this.at = 0;
    this.lateEntities.length = 0;
    this.lateSeqs.length = 0;
    this.lateAt = 0;
    this.current = NO_ATOMIC;
    this.currentSeq = -1;
    const lost = this.feed.drain((e) => this.collect(e));
    if (lost || this.through !== tick - 1) {
      this.due.clear();
      this.count = 0;
      for (const e of world.query(CurrentAtomic)) this.collect(e);
    } else {
      const filed = this.due.get(tick);
      if (filed !== undefined) {
        for (let i = 0; i < filed.length; i++) this.collect(filed[i] as Entity);
        this.due.delete(tick);
      }
    }
    this.through = tick;
    const { order, seqs, count } = this;
    for (let i = 0; i < count; i++) order[i] = i;
    order.subarray(0, count).sort((a, b) => (seqs[a] as number) - (seqs[b] as number));
  }

  /** The next atomic to advance, or {@link NO_ATOMIC} when the pass is over. */
  next(): Entity {
    if (this.current !== NO_ATOMIC && this.feed.pending) this.admitChanges();
    const world = this.world;
    for (;;) {
      const main = this.at < this.count ? (this.seqs[this.order[this.at] as number] as number) : Infinity;
      const late = this.lateAt < this.lateSeqs.length ? (this.lateSeqs[this.lateAt] as number) : Infinity;
      if (main === Infinity && late === Infinity) {
        this.current = NO_ATOMIC;
        return NO_ATOMIC;
      }
      let e: Entity;
      let seq: number;
      if (main <= late) {
        e = this.entities[this.order[this.at++] as number] as Entity;
        seq = main;
      } else {
        e = this.lateEntities[this.lateAt++] as Entity;
        seq = late;
      }
      // An atomic filed twice, already walked past, or ended since it was collected.
      if (seq <= this.currentSeq || world.insertionSeqOf(e, CurrentAtomic) !== seq) continue;
      this.current = e;
      this.currentSeq = seq;
      return e;
    }
  }

  /** File the atomic `e` just advanced, if it runs on, under the tick of its next event. */
  settle(e: Entity): void {
    const { world, ctx } = this;
    if (ctx === undefined) return;
    // An atomic started anew in its own visit comes back through the feed.
    if (world.insertionSeqOf(e, CurrentAtomic) !== this.currentSeq) return;
    const clock = world.get(e, AtomicClock);
    if (!('startedAt' in clock)) {
      this.file(e, this.tick + 1);
      return;
    }
    const elapsed = this.tick - clock.startedAt;
    const next = nextAtomicEventTick(world, ctx, e, world.get(e, CurrentAtomic), elapsed);
    this.file(e, this.tick + next - elapsed);
  }

  /** Take in what the visit just made changed: an atomic ahead of the walk joins this pass, one behind it
   *  waits for the next tick, and the visited one is filed by {@link settle}. */
  private admitChanges(): void {
    const world = this.world;
    const lost = this.feed.drain((e) => {
      const seq = world.insertionSeqOf(e, CurrentAtomic);
      if (seq === undefined || seq === this.currentSeq) return;
      if (seq > this.currentSeq) this.admitLate(e, seq);
      else this.file(e, this.tick + 1);
    });
    if (!lost) return;
    // The changes are unknown: walk the rest of the store now and the whole of it next tick.
    this.through = undefined;
    for (const e of world.query(CurrentAtomic)) {
      const seq = world.insertionSeqOf(e, CurrentAtomic);
      if (seq !== undefined && seq > this.currentSeq) this.admitLate(e, seq);
    }
  }

  private admitLate(e: Entity, seq: number): void {
    const seqs = this.lateSeqs;
    let i = seqs.length;
    while (i > this.lateAt && (seqs[i - 1] as number) > seq) i--;
    seqs.splice(i, 0, seq);
    this.lateEntities.splice(i, 0, e);
  }

  private collect(e: Entity): void {
    const seq = this.world.insertionSeqOf(e, CurrentAtomic);
    if (seq === undefined) return;
    if (this.count === this.entities.length) this.grow();
    this.entities[this.count] = e;
    this.seqs[this.count] = seq;
    this.count += 1;
  }

  private grow(): void {
    const capacity = this.entities.length * 2;
    const entities = new Int32Array(capacity);
    entities.set(this.entities);
    this.entities = entities;
    const seqs = new Float64Array(capacity);
    seqs.set(this.seqs);
    this.seqs = seqs;
    this.order = new Uint32Array(capacity);
  }

  /** The `verifyCaches` tripwire: an atomic with no change pending is filed by its next event's tick. */
  verify(): string[] {
    const { world, ctx, through } = this;
    if (ctx === undefined || through === undefined) return [];
    const pending = new Set<Entity>();
    if (this.feed.peek((e) => pending.add(e))) return [];
    const filed = new Map<Entity, number>();
    for (const [tick, list] of this.due) {
      for (const e of list) filed.set(e, Math.min(tick, filed.get(e) ?? Number.POSITIVE_INFINITY));
    }
    const violations: string[] = [];
    for (const e of world.query(CurrentAtomic)) {
      if (pending.has(e)) continue;
      const clock = world.get(e, AtomicClock);
      const elapsed = 'startedAt' in clock ? through - clock.startedAt : undefined;
      const next =
        elapsed === undefined
          ? through + 1
          : through + nextAtomicEventTick(world, ctx, e, world.get(e, CurrentAtomic), elapsed) - elapsed;
      if ((filed.get(e) ?? Number.POSITIVE_INFINITY) > next) {
        violations.push(`atomicSchedule: the atomic of ${e} is filed past its next event, tick ${next}`);
      }
    }
    return violations;
  }

  private file(e: Entity, tick: number): void {
    const list = this.due.get(tick);
    if (list === undefined) this.due.set(tick, [e]);
    else list.push(e);
  }
}

const schedules = new WeakMap<World, AtomicSchedule>();

/** `world`'s atomic schedule. */
export function atomicSchedule(world: World): AtomicSchedule {
  let schedule = schedules.get(world);
  if (schedule === undefined) {
    // What the next event reads: the record, its clock, the identity that picks the clip, and whether
    // the settler is a person.
    const stores = [CurrentAtomic, AtomicClock, Settler, Person];
    schedule = new AtomicSchedule(world, world.watchChanges(stores, [CurrentAtomic, AtomicClock, Settler]));
    schedules.set(world, schedule);
    world.registerCacheVerifier('atomicSchedule', () => schedules.get(world)?.verify() ?? []);
  }
  return schedule;
}
