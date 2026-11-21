import type { Profiler } from 'node:inspector';
import {
  type CpuCapture,
  type Frame,
  framesOf,
  type ProfileSummary,
  subtreeCost,
  summarizeCpuSelf,
} from './profile.js';
import { formatLocation, resolveLocation } from './profile-location.js';

/**
 * Which functions filled the slowest single ticks of a CPU-profiled run. The whole-run tables average
 * a spike away, and the per-system slowest-tick list stops at the system; this cuts the sample stream
 * at each slow tick's bounds and summarizes only the samples inside.
 */

const US_PER_MS = 1000;
/** The path stops where the heaviest callee holds less of the tick than this: below it the time has
 *  fanned out and no single stack explains the tick. */
const PATH_MIN_SHARE = 0.1;
const ANONYMOUS = '(anonymous)';
/** A gap between two samples counts as running time up to this, ten sampling intervals. V8 samples
 *  native code too, so a longer gap is the scheduler holding the thread or the sampler back. */
const RUNNING_GAP_CAP_US = 1000;

/** One measured step on the performance clock. */
export interface TickSpan {
  readonly tick: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/** The measured steps of a run: its first sim tick, and each step's duration and start on the
 *  performance clock. */
export interface TickTimings {
  readonly firstTick: number;
  readonly tickSamples: Float64Array;
  readonly tickStartsMs: Float64Array;
}

export interface PathFrame {
  readonly name: string;
  readonly location: string;
  /** Sampled inside this tick under this frame, callees included. */
  readonly totalMs: number;
}

export interface TickSpike {
  readonly tick: number;
  readonly measuredMs: number;
  /** Its `sampled` is close to `measuredMs` when the two clocks are aligned; a gap means the samples
   *  are misplaced. */
  readonly summary: ProfileSummary;
  readonly samples: number;
  /** The sampled time with each gap counted up to ten sampling intervals: what the tick costs on a
   *  quiet machine. */
  readonly runningMs: number;
  /** The longest time between two samples in the tick. Far above the sampling interval, the thread
   *  was not running: the scheduler preempted it, or V8 could not interrupt native code. */
  readonly longestGapMs: number;
  /** From the outermost frame down the heaviest callee at each level. */
  readonly path: readonly PathFrame[];
}

/** How much of a tick the thread demonstrably ran: its sample deltas, each counted up to
 *  {@link RUNNING_GAP_CAP_US}. */
function runningUsPerTick(capture: CpuCapture, measurement: TickTimings): Float64Array {
  const { profile, stoppedAtMs } = capture;
  const { tickSamples, tickStartsMs } = measurement;
  const running = new Float64Array(tickSamples.length);
  const { samples, timeDeltas } = profile;
  if (samples === undefined || timeDeltas === undefined) return running;
  let atMs = stoppedAtMs + (profile.startTime - profile.endTime) / US_PER_MS;
  let tick = 0;
  for (const i of samples.keys()) {
    const delta = timeDeltas[i] ?? 0;
    atMs += delta / US_PER_MS;
    while (tick < running.length && (tickStartsMs[tick] ?? 0) + (tickSamples[tick] ?? 0) <= atMs) tick++;
    if (tick === running.length) break;
    if (atMs >= (tickStartsMs[tick] ?? 0))
      running[tick] = (running[tick] ?? 0) + Math.min(delta, RUNNING_GAP_CAP_US);
  }
  return running;
}

/**
 * The `count` ticks the profiled thread ran longest in, longest first, ties to the earlier tick. Ranked
 * by running time and not by the measured one, so a tick the scheduler stalled on a busy machine does
 * not push out the ticks that are slow on every run.
 */
export function busiestTickSpans(
  capture: CpuCapture,
  measurement: TickTimings,
  count: number,
): readonly TickSpan[] {
  const { firstTick, tickSamples, tickStartsMs } = measurement;
  const running = runningUsPerTick(capture, measurement);
  return [...running.keys()]
    .sort((a, b) => (running[b] ?? 0) - (running[a] ?? 0) || a - b)
    .slice(0, count)
    .map((i) => ({ tick: firstTick + i, startMs: tickStartsMs[i] ?? 0, durationMs: tickSamples[i] ?? 0 }));
}

interface TickSamples {
  readonly selfUs: ReadonlyMap<number, number>;
  readonly count: number;
  readonly runningUs: number;
  readonly longestGapUs: number;
}

/** The samples stamped inside `[fromUs, toUs)` of the profile clock, as self microseconds per node. */
function samplesInside(profile: Profiler.Profile, fromUs: number, toUs: number): TickSamples {
  const selfUs = new Map<number, number>();
  let count = 0;
  let runningUs = 0;
  let longestGapUs = 0;
  const { samples, timeDeltas } = profile;
  if (samples === undefined || timeDeltas === undefined) return { selfUs, count, runningUs, longestGapUs };
  let at = profile.startTime;
  for (const [i, id] of samples.entries()) {
    const delta = timeDeltas[i] ?? 0;
    at += delta;
    if (at >= toUs) break;
    if (at < fromUs) continue;
    selfUs.set(id, (selfUs.get(id) ?? 0) + delta);
    count++;
    runningUs += Math.min(delta, RUNNING_GAP_CAP_US);
    longestGapUs = Math.max(longestGapUs, delta);
  }
  return { selfUs, count, runningUs, longestGapUs };
}

function heaviestPath(
  frames: ReadonlyMap<number, Frame>,
  self: ReadonlyMap<number, number>,
): readonly PathFrame[] {
  const totals = subtreeCost(frames, self);
  const total = (id: number): number => totals.get(id) ?? 0;
  const heaviest = (ids: readonly number[]): number | undefined =>
    ids.reduce<number | undefined>(
      (best, id) => (best === undefined || total(id) > total(best) ? id : best),
      undefined,
    );
  const roots = [...frames.values()].filter((f) => f.parent === null).map((f) => f.node.id);
  const floor = roots.reduce((sum, id) => sum + total(id), 0) * PATH_MIN_SHARE;

  const path: PathFrame[] = [];
  // V8's synthetic root is every stack's first frame, so the path starts below it.
  let next = heaviest(roots.flatMap((id) => frames.get(id)?.node.children ?? []));
  while (next !== undefined && total(next) > 0 && total(next) >= floor) {
    const node = frames.get(next)?.node;
    if (node === undefined) break;
    const { functionName, url, lineNumber, columnNumber } = node.callFrame;
    path.push({
      name: functionName === '' ? ANONYMOUS : functionName,
      location: formatLocation(resolveLocation(url, lineNumber, columnNumber)),
      totalMs: total(next) / US_PER_MS,
    });
    next = heaviest(node.children ?? []);
  }
  return path;
}

/** Attribute the capture's samples to each span, in the spans' order. */
export function tickSpikes(capture: CpuCapture, spans: readonly TickSpan[]): readonly TickSpike[] {
  const { profile, stoppedAtMs } = capture;
  const frames = framesOf(profile.nodes);
  const profileUs = (performanceMs: number): number =>
    profile.endTime + (performanceMs - stoppedAtMs) * US_PER_MS;
  return spans.map((span) => {
    const inside = samplesInside(profile, profileUs(span.startMs), profileUs(span.startMs + span.durationMs));
    return {
      tick: span.tick,
      measuredMs: span.durationMs,
      summary: summarizeCpuSelf(profile.nodes, inside.selfUs),
      samples: inside.count,
      runningMs: inside.runningUs / US_PER_MS,
      longestGapMs: inside.longestGapUs / US_PER_MS,
      path: heaviestPath(frames, inside.selfUs),
    };
  });
}
