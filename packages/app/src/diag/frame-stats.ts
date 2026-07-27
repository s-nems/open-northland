/**
 * The frame-timing fold behind both the on-canvas readout and the machine-readable perf handle. Pure
 * and DOM-free so it unit-tests: the overlay it used to live inside can only be checked by eye.
 *
 * The distribution is the part that earns its keep. An average alone cannot tell "this scene is
 * uniformly slow" (p50 close to p99) from "this machine is loaded or GC is spiking" (p50 fine, p99 far
 * above it), and reading the second as the first is how a measurement session goes wrong.
 */
import { MS_PER_TICK, TICKS_PER_SECOND } from '@open-northland/sim';

/** One frame's raw facts, recorded once per RAF by the frame loop. */
export interface FrameSample {
  readonly elapsedMs: number;
  readonly tick: number;
  /** Sim steps the fixed-timestep loop advanced this frame (0 when paused; >1 when catching up). */
  readonly steps: number;
  /** The fixed timestep's MONOTONIC session total, not a per-frame delta. */
  readonly droppedTicks: number;
  readonly speed: number;
  readonly paused: boolean;
  readonly entities: number;
  readonly drawn: number;
  readonly pooled: number;
  /** CPU time (ms) the loop spent this frame; the remainder of the frame budget is GPU/compositor. */
  readonly cpuMs: number;
  readonly simMs: number;
  readonly snapMs: number;
  /** Render build + submit and the rest of the frame's app work. The three sum to {@link cpuMs}. */
  readonly drawMs: number;
}

/** Smoothed milliseconds, which is what a readout can be looked at steadily. */
export interface FrameEma {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly simMs: number;
  readonly snapMs: number;
  readonly drawMs: number;
  /** Recent DELIVERED tick-rate multiplier: 1 means 12 ticks/s actually ran. */
  readonly deliveredSpeed: number;
}

export interface FrameDistribution {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

export interface FrameStatsReport {
  /** The newest frame, unsmoothed. Null before the first record. */
  readonly last: FrameSample | null;
  readonly ema: FrameEma;
  /** Worst frame in the current rolling window, which an average hides. */
  readonly recentWorstMs: number;
  readonly window: {
    readonly frames: number;
    readonly ms: number;
    readonly steps: number;
    /** Ticks dropped since the window opened, derived from the monotonic session total. */
    readonly droppedTicks: number;
    /** Average delivered multiplier over the window: the honest answer to "what speed am I getting". */
    readonly deliveredSpeed: number;
    readonly frameMs: FrameDistribution;
  };
}

/** Weight of the newest frame in the moving averages (smaller = smoother, slower to react). */
const SMOOTHING = 0.1;
/** Frames the worst-frame tracker holds before resetting, so the spike readout reflects the recent
 *  window rather than the whole session. */
const WORST_WINDOW_FRAMES = 120;

/** Log-spaced frame-time buckets: 1 ms to roughly 7 s at 1.15x growth. Fixed size, so a session of any
 *  length costs the same 64 numbers. Quantiles are bucket upper edges - read them as +/- 15%. */
const BUCKET_COUNT = 64;
const BUCKET_BASE_MS = 1;
const BUCKET_GROWTH = 1.15;

function bucketUpperEdgeMs(index: number): number {
  return BUCKET_BASE_MS * BUCKET_GROWTH ** (index + 1);
}

function bucketOf(ms: number): number {
  if (ms <= BUCKET_BASE_MS) return 0;
  const index = Math.ceil(Math.log(ms / BUCKET_BASE_MS) / Math.log(BUCKET_GROWTH)) - 1;
  return Math.min(BUCKET_COUNT - 1, Math.max(0, index));
}

function ema(average: number, sample: number): number {
  return average === 0 ? sample : average * (1 - SMOOTHING) + sample * SMOOTHING;
}

export class FrameStats {
  private last: FrameSample | null = null;
  private avgFrameMs = 0;
  private avgCpuMs = 0;
  private avgSimMs = 0;
  private avgSnapMs = 0;
  private avgDrawMs = 0;
  private avgDeliveredSpeed = 0;
  private worstMs = 0;
  private worstCount = 0;

  private frames = 0;
  private windowMs = 0;
  private windowSteps = 0;
  private windowMaxMs = 0;
  private droppedAtWindowStart = 0;
  private droppedTotal = 0;
  private readonly buckets = new Array<number>(BUCKET_COUNT).fill(0);

  record(sample: FrameSample): void {
    this.last = sample;
    this.droppedTotal = sample.droppedTicks;

    if (sample.elapsedMs > 0) {
      this.avgFrameMs = ema(this.avgFrameMs, sample.elapsedMs);
      this.frames++;
      this.windowMs += sample.elapsedMs;
      const bucket = bucketOf(sample.elapsedMs);
      this.buckets[bucket] = (this.buckets[bucket] ?? 0) + 1;
      this.windowMaxMs = Math.max(this.windowMaxMs, sample.elapsedMs);
    }
    this.avgCpuMs = ema(this.avgCpuMs, sample.cpuMs);
    this.avgSimMs = ema(this.avgSimMs, sample.simMs);
    this.avgSnapMs = ema(this.avgSnapMs, sample.snapMs);
    this.avgDrawMs = ema(this.avgDrawMs, sample.drawMs);
    // A paused loop delivers nothing by design; folding its zeros in would read as a stalled sim.
    if (!sample.paused && sample.elapsedMs > 0) {
      this.avgDeliveredSpeed = ema(this.avgDeliveredSpeed, (sample.steps * MS_PER_TICK) / sample.elapsedMs);
    }
    this.windowSteps += sample.steps;

    if (sample.elapsedMs > this.worstMs) this.worstMs = sample.elapsedMs;
    if (++this.worstCount >= WORST_WINDOW_FRAMES) {
      this.worstMs = sample.elapsedMs;
      this.worstCount = 0;
    }
  }

  /** Open a fresh measurement window. The EMAs keep their values: they describe "recently", not the
   *  window, and resetting them would blank the readout for a second every time an agent measures. */
  reset(): void {
    this.frames = 0;
    this.windowMs = 0;
    this.windowSteps = 0;
    this.windowMaxMs = 0;
    this.droppedAtWindowStart = this.droppedTotal;
    this.buckets.fill(0);
  }

  private quantileMs(fraction: number): number {
    const total = this.buckets.reduce((sum, n) => sum + n, 0);
    if (total === 0) return 0;
    const target = fraction * total;
    let seen = 0;
    for (const [index, count] of this.buckets.entries()) {
      seen += count;
      if (seen >= target) return bucketUpperEdgeMs(index);
    }
    return this.windowMaxMs;
  }

  report(): FrameStatsReport {
    const windowSeconds = this.windowMs / 1000;
    return {
      last: this.last,
      ema: {
        frameMs: this.avgFrameMs,
        cpuMs: this.avgCpuMs,
        simMs: this.avgSimMs,
        snapMs: this.avgSnapMs,
        drawMs: this.avgDrawMs,
        deliveredSpeed: this.avgDeliveredSpeed,
      },
      recentWorstMs: this.worstMs,
      window: {
        frames: this.frames,
        ms: this.windowMs,
        steps: this.windowSteps,
        droppedTicks: this.droppedTotal - this.droppedAtWindowStart,
        deliveredSpeed: windowSeconds === 0 ? 0 : this.windowSteps / windowSeconds / TICKS_PER_SECOND,
        frameMs: {
          p50Ms: this.quantileMs(0.5),
          p95Ms: this.quantileMs(0.95),
          p99Ms: this.quantileMs(0.99),
          maxMs: this.windowMaxMs,
        },
      },
    };
  }
}
