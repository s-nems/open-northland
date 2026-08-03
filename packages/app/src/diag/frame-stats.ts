/**
 * The frame-timing fold behind the on-canvas readout and the machine-readable perf handle. Pure and
 * DOM-free so it unit-tests. It reports a distribution as well as averages because an average cannot
 * separate a uniformly slow scene (p50 near p99) from a loaded machine spiking on GC (p50 fine).
 */
import { TICKS_PER_SECOND } from '@open-northland/sim';

/** One frame's raw facts, recorded once per RAF by the frame loop. */
export interface FrameSample {
  readonly elapsedMs: number;
  readonly tick: number;
  /** Sim steps the fixed-timestep loop advanced this frame (0 when paused; >1 when catching up). */
  readonly steps: number;
  /** The fixed timestep's monotonic session total, not a per-frame delta. */
  readonly droppedTicks: number;
  /** The multiplier asked for; `recent.deliveredSpeed` is what the loop delivered. */
  readonly speed: number;
  readonly paused: boolean;
  readonly entities: number;
  readonly drawn: number;
  readonly pooled: number;
  /** CPU time (ms) the loop spent this frame; the remainder of the frame budget is GPU/compositor. */
  readonly cpuMs: number;
  readonly simMs: number;
  readonly snapMs: number;
  /** Render build and submit plus the rest of the frame's app work; `simMs + snapMs + drawMs = cpuMs`. */
  readonly drawMs: number;
}

export interface FrameEma {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly simMs: number;
  readonly snapMs: number;
  readonly drawMs: number;
}

/**
 * Measured over a rolling window rather than smoothed per frame: `steps` is an integer, so at 60 fps
 * and x1 a per-frame ratio only ever reads 0 or 5, never the 1 the loop is delivering.
 */
export interface FrameRecent {
  readonly worstMs: number;
  /** Ticks discarded in the window, not the session total. */
  readonly droppedTicks: number;
  /** Delivered tick-rate multiplier over the window: 1 means 12 ticks/s actually ran. */
  readonly deliveredSpeed: number;
  /**
   * Two consecutive windows dropped work, so the loop is losing ground rather than recovering from one
   * hitch such as a map load.
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
  /** The newest frame, unsmoothed. */
  readonly last: FrameSample | null;
  readonly ema: FrameEma;
  readonly recent: FrameRecent;
  readonly window: {
    readonly frames: number;
    readonly ms: number;
    readonly steps: number;
    /** Ticks dropped since the window opened. */
    readonly droppedTicks: number;
    readonly deliveredSpeed: number;
    readonly frameMs: FrameDistribution;
  };
}

/** Weight of the newest frame in the moving averages. */
const SMOOTHING = 0.1;
/** Window length in wall time, not frames: a frame count would stretch the window on exactly the slow
 *  machine that needs a quick answer. */
const RECENT_WINDOW_MS = 1000;

/**
 * Above this a frame was a blocking load or an unpainted tab rather than a slow frame. Approximation
 * with room to spare: the worst genuinely slow frame observed was about 80 ms.
 */
const STALL_FRAME_MS = 500;

/** Log-spaced frame-time buckets: 1 ms to roughly 7 s at 1.15x growth, fixed size for any session
 *  length. Quantiles are bucket upper edges, so read them as +/- 15%. */
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
    // Assigned last: a window opening on this frame must start from the previous total, or this
    // frame's drops fall between the two windows.
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
    // A stall still counts here: worst frame time is a raw fact.
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

  /** Opens a fresh measurement window. The EMAs keep their values: they describe "recently", not the
   *  window. */
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
