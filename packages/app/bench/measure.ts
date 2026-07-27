/**
 * The measuring half both benchmarks share: warm the world, then time every system invocation
 * through `Simulation.setInstrument` across a run cut into windows. The timer lives here, in the app
 * layer, so `performance.now` stays out of `packages/sim/src` (see packages/sim/AGENTS.md).
 *
 * Windows are the point. One median over a developing settlement answers "how much did it cost on
 * average", which is not the question; per-window medians answer "what got worse as it grew".
 */
import { type Component, components, type Simulation } from '@open-northland/sim';
import { calibrationMs, loadPerCpu } from './environment.js';
import { type BenchWindow, summarizeSegment } from './report/index.js';

const { Building, Resource, Settler } = components;

const BYTES_PER_MB = 1024 * 1024;

export interface MeasureOptions {
  readonly warmupTicks: number;
  readonly measuredTicks: number;
  readonly windows: number;
  /** Called as each window closes. A multi-hour run must report progress, not go silent. */
  readonly onWindow?: (window: BenchWindow) => void;
}

export interface Measurement {
  readonly windows: readonly BenchWindow[];
  readonly perSystem: ReadonlyMap<string, readonly number[]>;
  readonly tickSamples: readonly number[];
  readonly settlersAtStart: number;
  readonly settlersAtEnd: number;
  readonly buildings: number;
  /** The worst load sampled across the run, so a box that got busy midway is not averaged away. */
  readonly loadPerCpu: number | null;
  readonly peakRssMb: number;
  readonly calibration: { readonly beforeMs: number; readonly afterMs: number };
}

function count(sim: Simulation, component: Component<unknown>): number {
  let n = 0;
  for (const _ of sim.world.query(component)) n++;
  return n;
}

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / BYTES_PER_MB);
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

export function measureWindows(sim: Simulation, options: MeasureOptions): Measurement {
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

  for (let i = 0; i < options.warmupTicks; i++) sim.step();
  const settlersAtStart = count(sim, Settler);

  const beforeMs = calibrationMs();
  let load = loadPerCpu();
  let peakRssMb = rssMb();

  sampling = true;
  const firstTick = sim.tick + 1;
  const tickSamples: number[] = [];
  const windows: BenchWindow[] = [];
  for (const [index, bound] of windowBounds(options.measuredTicks, options.windows).entries()) {
    for (let i = bound.from; i < bound.to; i++) {
      const start = performance.now();
      sim.step();
      tickSamples.push(performance.now() - start);
    }
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
        buildings: count(sim, Building),
        resourceNodes: count(sim, Resource),
      },
      rssMb: rss,
    };
    windows.push(window);
    options.onWindow?.(window);
  }
  sampling = false;
  // Release the seam: a caller that keeps stepping this sim should not keep paying two clock reads
  // per system per tick for samples nobody collects.
  sim.setInstrument(null);

  return {
    windows,
    perSystem,
    tickSamples,
    settlersAtStart,
    settlersAtEnd: count(sim, Settler),
    buildings: count(sim, Building),
    loadPerCpu: worstLoad(load, loadPerCpu()),
    peakRssMb,
    calibration: { beforeMs, afterMs: calibrationMs() },
  };
}
