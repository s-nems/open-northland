/**
 * The measuring half both benchmarks share: warm the world, then time every system invocation
 * through `Simulation.setInstrument` across a run cut into windows. The timer lives here, in the app
 * layer, so `performance.now` stays out of `packages/sim/src` (see packages/sim/AGENTS.md).
 *
 * Windows are the point. One median over a developing settlement answers "how much did it cost on
 * average", which is not the question; per-window medians answer "what got worse as it grew".
 */
import { type PerformanceEntry, PerformanceObserver } from 'node:perf_hooks';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { getHeapStatistics } from 'node:v8';
import { type Component, components, type Simulation, systems } from '@open-northland/sim';
import { calibrationMs, loadPerCpu } from './environment.js';
import { type BenchWindow, type GcStat, summarizeSegment } from './report/index.js';

const { Building, Resource, Settler } = components;

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;
const US_PER_MS = 1000;

export interface MeasureOptions {
  readonly warmupTicks: number;
  readonly measuredTicks: number;
  readonly windows: number;
  /** Called as each window closes. A multi-hour run must report progress, not go silent. */
  readonly onWindow?: (window: BenchWindow) => void;
  /** Called after every warm-up and measured step, outside the timed interval. */
  readonly afterTick?: () => void;
}

export interface Measurement {
  /** The sim tick of the first measured step. */
  readonly firstTick: number;
  readonly windows: readonly BenchWindow[];
  readonly perSystem: ReadonlyMap<string, readonly number[]>;
  readonly tickSamples: readonly number[];
  readonly settlersAtStart: number;
  readonly settlersAtEnd: number;
  readonly buildings: number;
  /** The worst load sampled across the run, so a box that got busy midway is not averaged away. */
  readonly loadPerCpu: number | null;
  readonly peakRssMb: number;
  /** Whole-run {@link BenchWindow.cpuMsPerTick} and {@link BenchWindow.allocKbPerTick}. */
  readonly cpuMsPerTick: number;
  readonly allocKbPerTick: number | null;
  readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
}

function count(sim: Simulation, component: Component<unknown>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

/** Settlers whose job is a soldier or hero class, the content's own role table deciding. */
function countFighters(sim: Simulation): number {
  let n = 0;
  for (const entity of sim.world.query(Settler)) {
    if (systems.isFighterJob(sim.content, sim.world.get(entity, Settler).jobType)) n++;
  }
  return n;
}

function rssMb(): number {
  return Math.round(process.memoryUsage.rss() / BYTES_PER_MB);
}

function heapUsedMb(): number {
  return Math.round(process.memoryUsage().heapUsed / BYTES_PER_MB);
}

/**
 * V8's collections, read from `gc` performance entries. Node queues those entries from native code and
 * delivers them only once the event loop turns, so a synchronous run of ticks sees none: the caller
 * yields at each window boundary, and entries are assigned to a window by their start time, not by
 * when they arrived.
 */
class GcLog {
  private readonly pending: PerformanceEntry[] = [];
  private readonly observer = new PerformanceObserver((list) => this.pending.push(...list.getEntries()));

  constructor() {
    this.observer.observe({ entryTypes: ['gc'] });
  }

  /** The collections that started inside `[fromMs, toMs)` of the performance clock. */
  async window(fromMs: number, toMs: number): Promise<GcStat> {
    await nextTurn();
    this.pending.push(...this.observer.takeRecords());
    let count = 0;
    let ms = 0;
    let maxMs = 0;
    const later: PerformanceEntry[] = [];
    for (const entry of this.pending) {
      if (entry.startTime >= toMs) {
        later.push(entry);
        continue;
      }
      if (entry.startTime < fromMs) continue;
      count++;
      ms += entry.duration;
      maxMs = Math.max(maxMs, entry.duration);
    }
    this.pending.splice(0, this.pending.length, ...later);
    return { count, ms, maxMs };
  }

  stop(): void {
    this.observer.disconnect();
  }
}

/** Main-thread CPU and V8 allocation so far: two cheap reads, taken only at window bounds. */
interface WorkSample {
  readonly cpuUs: number;
  /** Null on a runtime whose heap statistics lack the cumulative counter (Node 22 does). */
  readonly allocatedBytes: number | null;
}

function workSample(): WorkSample {
  const cpu = process.threadCpuUsage();
  const allocated: unknown = getHeapStatistics().total_allocated_bytes;
  return { cpuUs: cpu.user + cpu.system, allocatedBytes: typeof allocated === 'number' ? allocated : null };
}

function perTick(from: WorkSample, to: WorkSample, ticks: number): { cpuMs: number; allocKb: number | null } {
  const allocated =
    from.allocatedBytes === null || to.allocatedBytes === null
      ? null
      : to.allocatedBytes - from.allocatedBytes;
  if (ticks === 0) return { cpuMs: 0, allocKb: allocated === null ? null : 0 };
  return {
    cpuMs: (to.cpuUs - from.cpuUs) / US_PER_MS / ticks,
    allocKb: allocated === null ? null : allocated / BYTES_PER_KB / ticks,
  };
}

function worstLoad(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

interface Bound {
  readonly from: number;
  readonly to: number;
}

/** Equal-sized windows over the measured ticks, remainder folded into the last, so the segments tile
 *  the run exactly. More windows than ticks collapses to one window per tick. */
function windowBounds(measuredTicks: number, windows: number): readonly Bound[] {
  const count = Math.max(1, Math.min(windows, measuredTicks));
  const size = Math.floor(measuredTicks / count);
  const bounds: Bound[] = [];
  let from = 0;
  for (let i = 0; i < count; i++) {
    const to = i === count - 1 ? measuredTicks : from + size;
    bounds.push({ from, to });
    from = to;
  }
  return bounds;
}

/**
 * Per-system samples for one window. Slicing by tick index is only valid while every scheduled
 * system runs unconditionally each tick, so a length mismatch is refused rather than reported: a
 * mis-aligned window would silently attribute one system's cost to another's ticks.
 */
function sliceSamples(
  perSystem: ReadonlyMap<string, readonly number[]>,
  bound: Bound,
): ReadonlyMap<string, readonly number[]> {
  const sliced = new Map<string, readonly number[]>();
  for (const [name, samples] of perSystem) {
    if (samples.length !== bound.to) {
      throw new Error(`system '${name}' sampled ${samples.length}x over ${bound.to} measured tick(s)`);
    }
    sliced.set(name, samples.slice(bound.from, bound.to));
  }
  return sliced;
}

export async function measureWindows(sim: Simulation, options: MeasureOptions): Promise<Measurement> {
  const perSystem = new Map<string, number[]>();
  let sampling = false;
  sim.setInstrument((name, run) => {
    // Timed tight around `run`; the bookkeeping below lands outside the interval.
    const start = performance.now();
    run();
    const elapsed = performance.now() - start;
    if (!sampling) return;
    let samples = perSystem.get(name);
    if (samples === undefined) {
      samples = [];
      perSystem.set(name, samples);
    }
    samples.push(elapsed);
  });

  for (let i = 0; i < options.warmupTicks; i++) {
    sim.step();
    options.afterTick?.();
  }
  const settlersAtStart = count(sim, Settler);

  const beforeMs = calibrationMs();
  let load = loadPerCpu();
  let peakRssMb = rssMb();

  const gc = new GcLog();
  sampling = true;
  const firstTick = sim.tick + 1;
  const tickSamples: number[] = [];
  const windows: BenchWindow[] = [];
  let cpuUs = 0;
  let allocatedBytes: number | null = 0;
  for (const [index, bound] of windowBounds(options.measuredTicks, options.windows).entries()) {
    const workStart = workSample();
    const windowStartMs = performance.now();
    for (let i = bound.from; i < bound.to; i++) {
      const start = performance.now();
      sim.step();
      tickSamples.push(performance.now() - start);
      options.afterTick?.();
    }
    const windowEndMs = performance.now();
    const workEnd = workSample();
    cpuUs += workEnd.cpuUs - workStart.cpuUs;
    allocatedBytes =
      allocatedBytes === null || workStart.allocatedBytes === null || workEnd.allocatedBytes === null
        ? null
        : allocatedBytes + workEnd.allocatedBytes - workStart.allocatedBytes;
    const work = perTick(workStart, workEnd, bound.to - bound.from);
    const heap = heapUsedMb();
    const rss = rssMb();
    peakRssMb = Math.max(peakRssMb, rss);
    load = worstLoad(load, loadPerCpu());
    const window: BenchWindow = {
      index,
      fromTick: firstTick + bound.from,
      toTick: firstTick + bound.to - 1,
      ...summarizeSegment(sliceSamples(perSystem, bound), tickSamples.slice(bound.from, bound.to)),
      population: {
        settlers: count(sim, Settler),
        fighters: countFighters(sim),
        buildings: count(sim, Building),
        resourceNodes: count(sim, Resource),
      },
      rssMb: rss,
      heapUsedMb: heap,
      gc: await gc.window(windowStartMs, windowEndMs),
      cpuMsPerTick: work.cpuMs,
      allocKbPerTick: work.allocKb,
    };
    windows.push(window);
    options.onWindow?.(window);
  }
  sampling = false;
  gc.stop();
  // Release the seam: a caller that keeps stepping this sim should not keep paying two clock reads
  // per system per tick for samples nobody collects.
  sim.setInstrument(null);
  const run = perTick({ cpuUs: 0, allocatedBytes: 0 }, { cpuUs, allocatedBytes }, options.measuredTicks);

  return {
    firstTick,
    windows,
    perSystem,
    tickSamples,
    settlersAtStart,
    settlersAtEnd: count(sim, Settler),
    buildings: count(sim, Building),
    loadPerCpu: worstLoad(load, loadPerCpu()),
    peakRssMb,
    cpuMsPerTick: run.cpuMs,
    allocKbPerTick: run.allocKb,
    calibration: { beforeMs, afterMs: calibrationMs() },
  };
}
