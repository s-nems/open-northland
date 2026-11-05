import { deserialize, serialize } from 'node:v8';
import {
  cloneEvents,
  cloneReadView,
  deltaChanges,
  diffSnapshots,
  MirrorTruth,
  type SignpostReachView,
  type SimEvent,
  type Simulation,
  type SnapshotDelta,
  SnapshotDeltaStream,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { changedFacts, WorldFactsReader } from '../src/session/worker/facts.js';
import type { FromWorker, TickBatch, TickRecord, WorldFacts } from '../src/session/worker/protocol.js';
import { type AppFrameIndexReader, FRAME_INDEX_READERS } from '../src/view/projections/frame-indexes.js';
import { DeltaBreakdown } from './mirror-breakdown.js';
import { percentile } from './report/index.js';

const BYTES_PER_KB = 1024;
const US_PER_MS = 1000;
/** The seat whose HUD totals the indexed mirror reads: the totals keep every player's figures, so any
 *  seat registers the same upkeep. */
const HUD_SEAT = 0;
/** The longest batch a parity run draws: a worker delivers up to a few ticks per frame. */
const PARITY_MAX_TICKS_PER_DELTA = 7;
const NO_EVENTS: readonly SimEvent[] = [];

export interface MirrorProbeOptions {
  /** Ticks per delta, the batching a worker does when several ticks reach one frame. */
  readonly ticksPerDelta: number;
  /** Carry the `debug=diag` truth digest and time the mirror side's check. */
  readonly digest: boolean;
  /** Time each frame index reader on a mirror of its own. */
  readonly split: boolean;
  /** Draw each delta's span from 1 to {@link PARITY_MAX_TICKS_PER_DELTA} ticks and check the indexes
   *  against a fresh walk after every delta instead of once per window. */
  readonly parity: boolean;
  /** Tally what the deltas are made of per component (`mirror-breakdown.ts`), outside the timings. */
  readonly breakdown: boolean;
}

/** A mirror that reads `readers` after every delta, as the runtime's frame does, with its apply
 *  samples; the reads stay outside the timed apply. */
class TimedMirror {
  readonly mirror = new SnapshotMirror();
  applyUs: number[] = [];

  constructor(
    readonly name: string,
    private readonly readers: readonly AppFrameIndexReader[],
    private readonly signpostReach: (player: number) => SignpostReachView | null,
  ) {}

  apply(delta: SnapshotDelta): void {
    const t0 = performance.now();
    this.mirror.apply(delta);
    const t1 = performance.now();
    // A rebuild drops every index and the reads after it walk the list again, so it is not sampled.
    if (!delta.rebuild) this.applyUs.push((t1 - t0) * US_PER_MS);
    // A reader settles what its index derives on read, such as the HUD reach or a home's families.
    for (const reader of this.readers) reader.read(this.mirror.snapshot(), HUD_SEAT, this.signpostReach);
  }

  verify(): void {
    const differences = this.mirror.verifyIndexes();
    if (differences.length > 0) {
      throw new Error(`${this.name} mirror at tick ${this.mirror.tick}: ${differences.join('; ')}`);
    }
  }
}

/**
 * The cost of the snapshot delta path a worker host pays per posted batch, done as `serve.ts` does it:
 * taking the delta off a stream that carries no events, cloning the events of a tick held back for a
 * later batch, reading and diffing the world facts, the structured clone `postMessage` makes of the
 * whole batch message (the worker's serialize and the main thread's deserialize), and applying the
 * delta to a bare mirror and to one holding the runtime frame's indexes, whose difference is the main
 * thread's index upkeep. Sampled outside the timed tick, so the tick table stays the sim's.
 */
export class MirrorProbe {
  private readonly deltas;
  private readonly bare: TimedMirror;
  private readonly indexed: TimedMirror;
  private readonly split: readonly TimedMirror[];
  private ticksSinceDelta = 0;
  private deltaCount = 0;
  private ticksThisDelta: number;
  /** A parity run's batch draw; any fixed sequence covers the spans. */
  private batchSeed = 1;
  private takeUs: number[] = [];
  private eventsUs: number[] = [];
  private factsUs: number[] = [];
  /** The tick records the batch in the making carries, as `TickOutbox` holds them. */
  private records: TickRecord[] = [];
  /** The event cloning of the ticks the batch in the making holds. */
  private heldEventsUs = 0;
  private readonly facts: WorldFactsReader;
  private lastFacts: WorldFacts;
  private serializeUs: number[] = [];
  private deserializeUs: number[] = [];
  private truthUs: number[] = [];
  private readonly truth: MirrorTruth | null;
  private readonly breakdown: DeltaBreakdown | null;
  private touched: number[] = [];
  private components: number[] = [];
  private kilobytes: number[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly options: MirrorProbeOptions,
  ) {
    // Without the events, as the worker opens it: each tick record carries its own.
    this.deltas = new SnapshotDeltaStream(
      {
        world: sim.world,
        get tick() {
          return sim.tick;
        },
        events: { current: () => NO_EVENTS },
      },
      { digest: options.digest },
    );
    this.facts = new WorldFactsReader(sim);
    this.lastFacts = this.facts.read();
    this.truth = options.digest ? new MirrorTruth() : null;
    this.breakdown = options.breakdown ? new DeltaBreakdown() : null;
    // The seat's reach as the host answers it: the same view until the sim's reach changes.
    const reach = (player: number): SignpostReachView | null => sim.signpostReach(player);
    this.bare = new TimedMirror('bare', [], reach);
    this.indexed = new TimedMirror('indexed', FRAME_INDEX_READERS, reach);
    this.split = options.split
      ? [
          new TimedMirror('control', [], reach),
          ...FRAME_INDEX_READERS.map((r) => new TimedMirror(r.name, [r], reach)),
        ]
      : [];
    this.ticksThisDelta = this.nextBatch();
  }

  /** Call after every step. */
  tick(): void {
    this.ticksSinceDelta++;
    const posts = this.ticksSinceDelta >= this.ticksThisDelta;
    const events = this.sim.events.current();
    const t0 = performance.now();
    // A single-tick batch posts its live list, which the post clones; a longer one was held while the
    // runtime applied the previous batch, so each of its ticks, the last included, outlived its step.
    this.records.push({
      tick: this.sim.tick,
      events: this.ticksThisDelta === 1 ? events : cloneEvents(events),
      simMs: 0,
      diagnostics: null,
    });
    this.heldEventsUs += (performance.now() - t0) * US_PER_MS;
    if (posts) this.deliver();
  }

  /** Take, carry and apply the delta of the ticks since the last one. */
  private deliver(): void {
    this.ticksSinceDelta = 0;
    this.ticksThisDelta = this.nextBatch();
    const ticks = this.records;
    this.records = [];
    const last = ticks[ticks.length - 1];
    const t0 = performance.now();
    const delta = this.deltas.next();
    const t1 = performance.now();
    if (delta === null || last === undefined) return;
    const facts = this.facts.read();
    const changed = changedFacts(this.lastFacts, facts);
    this.lastFacts = facts;
    const tFacts = performance.now();
    const batch: TickBatch = {
      delta: { ...delta, events: last.events },
      ticks,
      facts: changed,
      fog: null,
      droppedTicks: 0,
      spans: null,
      leadTicks: ticks.length,
    };
    const message: FromWorker<unknown> = { kind: 'ticks', batch };
    const bytes = serialize(message);
    const t2 = performance.now();
    const received = receivedDelta(bytes);
    const t3 = performance.now();
    if (this.breakdown !== null && this.bare.mirror.tick !== null) {
      this.breakdown.add(receivedDelta(bytes), this.bare.mirror.snapshot());
    }
    // Each mirror applies a copy of its own, as fresh from the deserializer as the runtime's, in an order
    // that rotates per delta: a mirror applying first runs measurably slower.
    const mirrors = [this.bare, this.indexed, ...this.split];
    for (let i = 0; i < mirrors.length; i++) {
      const mirror = mirrors[(i + this.deltaCount) % mirrors.length];
      mirror?.apply(mirror === this.bare ? received : receivedDelta(bytes));
    }
    this.deltaCount++;
    if (this.options.parity) this.indexed.verify();
    if (this.truth !== null) {
      const t4 = performance.now();
      const mismatch = this.truth.check(received, this.bare.mirror.snapshot());
      this.truthUs.push((performance.now() - t4) * US_PER_MS);
      if (mismatch !== null)
        throw new Error(`mirror digest parted from the world: ${JSON.stringify(mismatch)}`);
    }
    this.takeUs.push((t1 - t0) * US_PER_MS);
    this.eventsUs.push(this.heldEventsUs);
    this.heldEventsUs = 0;
    this.factsUs.push((tFacts - t1) * US_PER_MS);
    this.serializeUs.push((t2 - tFacts) * US_PER_MS);
    this.deserializeUs.push((t3 - t2) * US_PER_MS);
    this.touched.push(delta.changeOf.length + delta.removed.length);
    const changes = deltaChanges(delta);
    let components = 0;
    for (const at of delta.changeOf) {
      const change = changes[at];
      components += (change?.written.length ?? 0) + (change?.removed.length ?? 0);
    }
    this.components.push(components);
    this.kilobytes.push(bytes.byteLength / BYTES_PER_KB);
  }

  /** The report lines for the window that just closed, resetting the samples; throws when the mirror
   *  and the live snapshot disagree or an index differs from a fresh walk. */
  windowLines(): string[] {
    // A batch the window cut short delivers now, so the mirror compares at the live tick.
    if (this.ticksSinceDelta > 0) this.deliver();
    const live = liveSnapshot(this.sim);
    const mirrored = this.bare.mirror.snapshot();
    const diff = diffSnapshots(mirrored, live);
    if (
      mirrored.tick !== live.tick ||
      diff.added.length + diff.removed.length + diff.changed.length > 0 ||
      JSON.stringify(mirrored.events) !== JSON.stringify(live.events)
    ) {
      throw new Error(
        `mirror diverged from the live snapshot at tick ${this.sim.tick}: ${diff.added.length} added, ` +
          `${diff.removed.length} removed, ${diff.changed.length} changed`,
      );
    }
    this.indexed.verify();
    const t0 = performance.now();
    structuredClone(live);
    const fullCloneMs = performance.now() - t0;
    const batch = this.options.parity
      ? `1-${PARITY_MAX_TICKS_PER_DELTA}, parity checked per delta`
      : `${this.options.ticksPerDelta}`;
    const lines = [
      `  mirror  entities ${live.entities.length}  ticks/delta ${batch}  ` +
        `changed/delta p50 ${percentile(this.touched, 50).toFixed(0)} p95 ${percentile(this.touched, 95).toFixed(0)}  ` +
        `components/delta p50 ${percentile(this.components, 50).toFixed(0)} ` +
        `p95 ${percentile(this.components, 95).toFixed(0)}  delta KB p50 ${percentile(this.kilobytes, 50).toFixed(1)} ` +
        `p95 ${percentile(this.kilobytes, 95).toFixed(1)}  take µs ${us(this.takeUs)}  ` +
        `events µs ${us(this.eventsUs)}  facts µs ${us(this.factsUs)}  ` +
        `serialize µs ${us(this.serializeUs)}  worker seam µs ${us(this.seamUs())}  ` +
        `deserialize µs ${us(this.deserializeUs)}  ` +
        `apply bare µs ${us(this.bare.applyUs)}  with the frame's indexes µs ${us(this.indexed.applyUs)}  ` +
        `upkeep p50 µs ${upkeepUs(this.indexed.applyUs, this.bare.applyUs).toFixed(0)}  ` +
        (this.truth === null ? '' : `truth µs ${us(this.truthUs)}  `) +
        `full snapshot structured clone, off the per-tick path, ${fullCloneMs.toFixed(0)} ms`,
    ];
    const [control, ...readers] = this.split;
    if (control !== undefined) {
      const parts = readers.map((m) => `${m.name} ${upkeepUs(m.applyUs, control.applyUs).toFixed(0)}`);
      lines.push(
        `  mirror upkeep per reader, p50 µs over a bare apply of the same delta: ${parts.join(', ')}`,
      );
    }
    if (this.breakdown !== null) lines.push(...this.breakdown.lines());
    for (const mirror of [this.bare, this.indexed, ...this.split]) mirror.applyUs = [];
    this.takeUs = [];
    this.eventsUs = [];
    this.factsUs = [];
    this.serializeUs = [];
    this.deserializeUs = [];
    this.truthUs = [];
    this.touched = [];
    this.components = [];
    this.kilobytes = [];
    return lines;
  }

  /** Per batch, everything the worker spends on it beyond the step: take, events, facts, serialize. */
  private seamUs(): number[] {
    return this.takeUs.map(
      (take, i) => take + (this.eventsUs[i] ?? 0) + (this.factsUs[i] ?? 0) + (this.serializeUs[i] ?? 0),
    );
  }

  private nextBatch(): number {
    if (!this.options.parity) return this.options.ticksPerDelta;
    // A 32-bit xorshift: reproducible spans without a seeded library.
    let x = this.batchSeed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.batchSeed = x >>> 0;
    return (this.batchSeed % PARITY_MAX_TICKS_PER_DELTA) + 1;
  }
}

function receivedDelta(bytes: Buffer): SnapshotDelta {
  const message = deserialize(bytes) as FromWorker<unknown>;
  if (message.kind !== 'ticks') throw new Error(`the probe posted a ${message.kind} message`);
  return message.batch.delta;
}

/** The live world's read view cloned straight off its component stores, sharing no encoder with the
 *  delta path and leaving the clone cache `Simulation.snapshot()` fills empty. */
function liveSnapshot(sim: Simulation): WorldSnapshot {
  const entities = sim.world.canonicalEntities().map((id) => {
    const components: Record<string, unknown> = {};
    sim.world.forEachComponent(
      id,
      (name, value, _revision, component) => {
        components[name] = cloneReadView(value, component.simOnlyFields);
      },
      true,
    );
    return { id, components };
  });
  return { tick: sim.tick, entities, events: cloneEvents(sim.events.current()) };
}

function us(samples: readonly number[]): string {
  return `p50 ${percentile(samples, 50).toFixed(0)} p95 ${percentile(samples, 95).toFixed(0)}`;
}

/** The median of the per-delta differences, so a collection pause in one delta skews neither side. */
function upkeepUs(withIndexes: readonly number[], bare: readonly number[]): number {
  return percentile(
    withIndexes.map((us, i) => us - (bare[i] ?? us)),
    50,
  );
}
