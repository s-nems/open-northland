import { deserialize, serialize } from 'node:v8';
import {
  diffSnapshots,
  MirrorTruth,
  type Simulation,
  type SnapshotDelta,
  SnapshotMirror,
} from '@open-northland/sim';
import { percentile } from './report/index.js';

const BYTES_PER_KB = 1024;
const US_PER_MS = 1000;

/**
 * The cost of the snapshot delta path a worker host pays per posted delta: taking it, the structured
 * clone `postMessage` makes (V8's serializer, split into the worker's serialize and the main thread's
 * deserialize), and applying it to a mirror, beside its serialized size. `ticksPerDelta` takes one delta
 * every that many ticks, the batching a worker does when several ticks reach one frame. Sampled outside
 * the timed tick, so the tick table stays the sim's. At each window's end it checks the mirror against
 * the live snapshot and clones a full snapshot once for the comparison the delta replaces. The runtime's
 * readers register their indexes on the mirror lazily, so this mirror holds none, and its apply figure
 * leaves out the per-delta index upkeep the runtime also pays. With `digest`, the deltas carry the
 * `debug=diag` truth digest, so the take figure includes its fold, and the mirror side's check is
 * sampled as `truth`.
 */
export class MirrorProbe {
  private readonly deltas;
  private readonly mirror = new SnapshotMirror();
  private ticksSinceDelta = 0;
  private takeUs: number[] = [];
  private serializeUs: number[] = [];
  private deserializeUs: number[] = [];
  private applyUs: number[] = [];
  private truthUs: number[] = [];
  private readonly truth: MirrorTruth | null;
  private touched: number[] = [];
  private components: number[] = [];
  private kilobytes: number[] = [];

  constructor(
    private readonly sim: Simulation,
    private readonly ticksPerDelta: number,
    digest: boolean,
  ) {
    this.deltas = sim.snapshotDeltas({ digest });
    this.truth = digest ? new MirrorTruth() : null;
  }

  /** Call after every step. */
  tick(): void {
    this.ticksSinceDelta++;
    if (this.ticksSinceDelta < this.ticksPerDelta) return;
    this.ticksSinceDelta = 0;
    const t0 = performance.now();
    const delta = this.deltas.next();
    const t1 = performance.now();
    if (delta === null) return;
    const bytes = serialize(delta);
    const t2 = performance.now();
    const received = deserialize(bytes) as SnapshotDelta;
    const t3 = performance.now();
    this.mirror.apply(received);
    const t4 = performance.now();
    if (this.truth !== null) {
      const mismatch = this.truth.check(received, this.mirror.snapshot());
      this.truthUs.push((performance.now() - t4) * US_PER_MS);
      if (mismatch !== null)
        throw new Error(`mirror digest parted from the world: ${JSON.stringify(mismatch)}`);
    }
    this.takeUs.push((t1 - t0) * US_PER_MS);
    this.serializeUs.push((t2 - t1) * US_PER_MS);
    this.deserializeUs.push((t3 - t2) * US_PER_MS);
    this.applyUs.push((t4 - t3) * US_PER_MS);
    this.touched.push(delta.touched.length + delta.removed.length);
    let components = 0;
    for (const entry of delta.touched)
      components += Object.keys(entry.components).length + entry.removed.length;
    this.components.push(components);
    this.kilobytes.push(bytes.byteLength / BYTES_PER_KB);
  }

  /** One report line for the window that just closed, resetting the samples; throws when the mirror
   *  and the live snapshot disagree. */
  windowLine(): string {
    const live = this.sim.snapshot();
    const mirrored = this.mirror.snapshot();
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
    const t0 = performance.now();
    structuredClone(live);
    const fullCloneMs = performance.now() - t0;
    const line =
      `  mirror  entities ${live.entities.length}  ticks/delta ${this.ticksPerDelta}  ` +
      `changed/delta p50 ${percentile(this.touched, 50).toFixed(0)} p95 ${percentile(this.touched, 95).toFixed(0)}  ` +
      `components/delta p50 ${percentile(this.components, 50).toFixed(0)} ` +
      `p95 ${percentile(this.components, 95).toFixed(0)}  delta KB p50 ${percentile(this.kilobytes, 50).toFixed(1)} ` +
      `p95 ${percentile(this.kilobytes, 95).toFixed(1)}  take µs ${us(this.takeUs)}  ` +
      `serialize µs ${us(this.serializeUs)}  deserialize µs ${us(this.deserializeUs)}  ` +
      `apply only, no indexes µs ${us(this.applyUs)}  ` +
      (this.truth === null ? '' : `truth µs ${us(this.truthUs)}  `) +
      `full snapshot clone ${fullCloneMs.toFixed(0)} ms`;
    this.takeUs = [];
    this.serializeUs = [];
    this.deserializeUs = [];
    this.applyUs = [];
    this.truthUs = [];
    this.touched = [];
    this.components = [];
    this.kilobytes = [];
    return line;
  }
}

function us(samples: readonly number[]): string {
  return `p50 ${percentile(samples, 50).toFixed(0)} p95 ${percentile(samples, 95).toFixed(0)}`;
}
