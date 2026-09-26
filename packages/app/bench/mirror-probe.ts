import { type Simulation, SnapshotMirror } from '@open-northland/sim';
import { percentile } from './report/index.js';

const BYTES_PER_KB = 1024;
const US_PER_MS = 1000;

/**
 * The per-tick cost of the snapshot delta path a worker host pays: taking the delta, the structured
 * clone `postMessage` would make, and applying it to a mirror, beside the delta's size. Sampled outside
 * the timed tick, so the tick table stays the sim's. At each window's end it checks the mirror against
 * the live snapshot and clones a full snapshot once for the comparison the delta replaces.
 */
export class MirrorProbe {
  private readonly deltas;
  private readonly mirror = new SnapshotMirror();
  private takeUs: number[] = [];
  private cloneUs: number[] = [];
  private applyUs: number[] = [];
  private touched: number[] = [];
  private kilobytes: number[] = [];

  constructor(private readonly sim: Simulation) {
    this.deltas = sim.snapshotDeltas();
  }

  /** Call after every step. */
  tick(): void {
    const t0 = performance.now();
    const delta = this.deltas.next();
    const t1 = performance.now();
    if (delta === null) return;
    const cloned = structuredClone(delta);
    const t2 = performance.now();
    this.mirror.apply(cloned);
    const t3 = performance.now();
    this.takeUs.push((t1 - t0) * US_PER_MS);
    this.cloneUs.push((t2 - t1) * US_PER_MS);
    this.applyUs.push((t3 - t2) * US_PER_MS);
    this.touched.push(delta.touched.length + delta.removed.length);
    this.kilobytes.push(JSON.stringify(delta).length / BYTES_PER_KB);
  }

  /** One report line for the window that just closed, resetting the samples; throws when the mirror
   *  and the live snapshot disagree. */
  windowLine(): string {
    const live = this.sim.snapshot();
    if (JSON.stringify(this.mirror.snapshot()) !== JSON.stringify(live)) {
      throw new Error(`mirror diverged from the live snapshot at tick ${this.sim.tick}`);
    }
    const t0 = performance.now();
    structuredClone(live);
    const fullCloneMs = performance.now() - t0;
    const line =
      `  mirror  entities ${live.entities.length}  changed/tick p50 ${percentile(this.touched, 50).toFixed(0)} ` +
      `p95 ${percentile(this.touched, 95).toFixed(0)}  delta JSON KB p50 ${percentile(this.kilobytes, 50).toFixed(1)} ` +
      `p95 ${percentile(this.kilobytes, 95).toFixed(1)}  take µs ${us(this.takeUs)}  clone µs ${us(this.cloneUs)}  ` +
      `apply µs ${us(this.applyUs)}  full snapshot clone ${fullCloneMs.toFixed(0)} ms`;
    this.takeUs = [];
    this.cloneUs = [];
    this.applyUs = [];
    this.touched = [];
    this.kilobytes = [];
    return line;
  }
}

function us(samples: readonly number[]): string {
  return `p50 ${percentile(samples, 50).toFixed(0)} p95 ${percentile(samples, 95).toFixed(0)}`;
}
