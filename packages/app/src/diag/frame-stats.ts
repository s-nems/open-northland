/**
 * The frame-timing fold behind both the on-canvas readout and the machine-readable perf handle. Pure
 * and DOM-free so it unit-tests: the overlay it used to live inside can only be checked by eye.
 *
 * The distribution is the part that earns its keep. An average alone cannot tell "this scene is
 * uniformly slow" (p50 close to p99) from "this machine is loaded or GC is spiking" (p50 fine, p99 far
 * above it), and reading the second as the first is how a measurement session goes wrong.
 */
import { TICKS_PER_SECOND } from '@open-northland/sim';

/** One frame's raw facts, recorded once per RAF by the frame loop. */
export interface FrameSample {
  readonly elapsedMs: number;
  readonly tick: number;
  /** Sim steps the fixed-timestep loop advanced this frame (0 when paused; >1 when catching up). */
  readonly steps: number;
  /** The fixed timestep's MONOTONIC session total, not a per-frame delta. */
  readonly droppedTicks: number;
  /** The multiplier ASKED for. What the loop delivered is `recent.deliveredSpeed`. */
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
}

/**
 * The rolling window a live readout should quote. Everything here is measured over the last
 * {@link RECENT_WINDOW_FRAMES} frames rather than smoothed per frame, because `steps` is an integer:
 * at 60 fps and x1 the loop runs one tick every fifth frame, so a per-frame ratio only ever reads 0 or
 * 5 and no amount of smoothing settles it on the 1 the loop is actually delivering.
 */
export interface FrameRecent {
  /** Worst frame in the window, which an average hides. */
  readonly worstMs: number;
  /** Ticks the loop discarded in the window. */
  readonly droppedTicks: number;
  /** Delivered tick-rate multiplier over the window: 1 means 12 ticks/s actually ran. */
  readonly deliveredSpeed: number;
  /**
   * The loop discarded work in this window AND in the one before it, so it is losing ground rather
   * than recovering from one hitch. Loading a map costs a few ticks on every session; reporting that
   * as a shortfall would tell every player their machine cannot keep up, seconds after it already has.
   */
  readonly sustainedShortfall: boolean;
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
  readonly recent: FrameRecent;
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
/** How long the rolling window holds before starting over, so a spike or a stall leaves the readout
 *  again once it stops happening. Wall time, not a frame count: a frame budget would make the window
 *  eight seconds long on the struggling machine that most needs a quick answer, and under one on a
 *  144 Hz display that needs none. */
const RECENT_WINDOW_MS = 1000;

/**
 * A frame this long was not a rendered frame: a blocking map load, or a tab the browser stopped
 * painting. The loop rightly discards the wall-clock it missed, but that is not the sim failing to keep
 * up. Approximation with room to spare: the worst genuinely slow frame observed on the heaviest map at
 * x10 was about 80 ms.
 */
const STALL_FRAME_MS = 500;

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

  /** Rollover clock: every frame ages the window, so a throttled tab does not freeze it. */
  private recentWallMs = 0;
  private recentRunningMs = 0;
  private recentSteps = 0;
  private recentWorstMs = 0;
  private recentDroppedAtStart = 0;
  private previousWindowDropped = 0;

  private frames = 0;
  private windowMs = 0;
  private windowSteps = 0;
  private windowMaxMs = 0;
  private droppedAtWindowStart = 0;
  private droppedTotal = 0;
  private readonly buckets = new Array<number>(BUCKET_COUNT).fill(0);

  record(sample: FrameSample): void {
    this.last = sample;

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
    this.windowSteps += sample.steps;
    this.recordRecent(sample);
    // Last: a rolling window opening on this frame must start from the PREVIOUS total, or this frame's
    // drops fall between the two windows and the readout blinks clean while the loop is still dropping.
    this.droppedTotal = sample.droppedTicks;
  }

  private recordRecent(sample: FrameSample): void {
    if (this.recentWallMs >= RECENT_WINDOW_MS) {
      this.previousWindowDropped = this.droppedTotal - this.recentDroppedAtStart;
      this.recentWallMs = 0;
      this.recentRunningMs = 0;
      this.recentSteps = 0;
      this.recentWorstMs = 0;
      this.recentDroppedAtStart = this.droppedTotal;
    }
    this.recentWallMs += sample.elapsedMs;
    // Still the worst frame, which is a raw fact about frame time and reported as one.
    this.recentWorstMs = Math.max(this.recentWorstMs, sample.elapsedMs);
    if (sample.elapsedMs >= STALL_FRAME_MS) {
      // This frame's own total, not the previous one: everything discarded up to here is excluded.
      this.recentDroppedAtStart = sample.droppedTicks;
      return;
    }
    // A paused loop delivers nothing by design; counting its frames would read as a stalled sim.
    if (!sample.paused) {
      this.recentRunningMs += sample.elapsedMs;
      this.recentSteps += sample.steps;
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
    const recentSeconds = this.recentRunningMs / 1000;
    const recentDropped = this.droppedTotal - this.recentDroppedAtStart;
    return {
      last: this.last,
      ema: {
        frameMs: this.avgFrameMs,
        cpuMs: this.avgCpuMs,
        simMs: this.avgSimMs,
        snapMs: this.avgSnapMs,
        drawMs: this.avgDrawMs,
      },
      recent: {
        worstMs: this.recentWorstMs,
        droppedTicks: recentDropped,
        deliveredSpeed: recentSeconds === 0 ? 0 : this.recentSteps / recentSeconds / TICKS_PER_SECOND,
        sustainedShortfall: recentDropped > 0 && this.previousWindowDropped > 0,
      },
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
