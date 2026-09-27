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
  /** The sim's own stepping time for this frame's ticks, on whichever thread it runs. */
  readonly simMs: number;
  /** This thread's cost of taking in this frame's ticks from a sim on another thread: message
   *  deserialization, mirror apply and index upkeep. 0 for a sim on this thread. */
  readonly receiveMs: number;
  readonly snapMs: number;
  /** Render build and submit plus the rest of the frame's app work. With the sim on this thread
   *  `simMs + snapMs + drawMs = cpuMs`; off it, the frame's mirror apply takes `simMs`'s place. */
  readonly drawMs: number;
}

export interface FrameEma {
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly simMs: number;
  readonly receiveMs: number;
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
  /** Delivered tick-rate multiplier: 1 means 12 ticks/s actually ran. Over the current window once it
   *  has run long enough to judge, else over the last window that did. */
  readonly deliveredSpeed: number;
  /**
   * The last two judged windows each delivered under nine tenths of the steps their frames asked for,
   * whether the loop dropped ticks or a worker held its clock. One slow window does not raise it, and
   * stall frames and paused frames are not judged at all.
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
    /** The window's sim stepping time over its ticks. */
    readonly simMsPerTick: number;
    /** The window's {@link FrameSample.receiveMs} over its ticks. */
    readonly receiveMsPerTick: number;
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

/**
 * A window delivering under this share of its requested steps is short. Tolerates the one tick a
 * window's edge can cost at x1 (11 of 12 is 0.92) while a real shortfall falls well below it.
 */
const SHORTFALL_RATIO = 0.9;

/** Running time a window needs before its delivered speed says anything: a few frames of a fresh
 *  window hold zero or several ticks and read as any speed at all. */
const JUDGE_MIN_RUNNING_MS = RECENT_WINDOW_MS / 2;

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
  private avgReceiveMs = 0;
  private avgSnapMs = 0;
  private avgDrawMs = 0;

  /** Rollover clock: every frame ages the window, so a throttled tab does not freeze it. */
  private recentWallMs = 0;
  private recentRunningMs = 0;
  private recentSteps = 0;
  /** Steps the running frames asked for at their own requested speed, so a mid-window speed change
   *  judges each frame against its own request. */
  private recentExpectedSteps = 0;
  private recentWorstMs = 0;
  private recentDroppedAtStart = 0;
  /** The two most recent closed windows that ran long enough to judge; unjudged ones leave them. */
  private lastJudgedShort = false;
  private priorJudgedShort = false;
  private lastJudgedSpeed: number | null = null;

  private frames = 0;
  private windowMs = 0;
  private windowSteps = 0;
  private windowSimMs = 0;
  private windowReceiveMs = 0;
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
    this.avgReceiveMs = ema(this.avgReceiveMs, sample.receiveMs);
    this.avgSnapMs = ema(this.avgSnapMs, sample.snapMs);
    this.avgDrawMs = ema(this.avgDrawMs, sample.drawMs);
    this.windowSteps += sample.steps;
    this.windowSimMs += sample.simMs;
    this.windowReceiveMs += sample.receiveMs;
    this.recordRecent(sample);
    // Assigned last: a window opening on this frame must start from the previous total, or this
    // frame's drops fall between the two windows.
    this.droppedTotal = sample.droppedTicks;
  }

  private recordRecent(sample: FrameSample): void {
    if (this.recentWallMs >= RECENT_WINDOW_MS) {
      if (this.recentJudged()) {
        this.priorJudgedShort = this.lastJudgedShort;
        this.lastJudgedShort = this.recentShort();
        this.lastJudgedSpeed = this.recentSpeed();
      }
      this.recentWallMs = 0;
      this.recentRunningMs = 0;
      this.recentSteps = 0;
      this.recentExpectedSteps = 0;
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
      this.recentExpectedSteps += (sample.elapsedMs / 1000) * TICKS_PER_SECOND * sample.speed;
    }
  }

  private recentJudged(): boolean {
    return this.recentRunningMs >= JUDGE_MIN_RUNNING_MS;
  }

  private recentShort(): boolean {
    return this.recentSteps < this.recentExpectedSteps * SHORTFALL_RATIO;
  }

  private recentSpeed(): number {
    const seconds = this.recentRunningMs / 1000;
    return seconds === 0 ? 0 : this.recentSteps / seconds / TICKS_PER_SECOND;
  }

  private deliveredSpeed(): number {
    return this.recentJudged() ? this.recentSpeed() : (this.lastJudgedSpeed ?? this.recentSpeed());
  }

  private shortfallHolds(): boolean {
    return this.recentJudged()
      ? this.recentShort() && this.lastJudgedShort
      : this.lastJudgedShort && this.priorJudgedShort;
  }

  /** The delivered speed while a sustained shortfall holds, else null. Allocation-free for a caller
   *  that asks every frame. */
  sustainedShortfallSpeed(): number | null {
    return this.shortfallHolds() ? this.deliveredSpeed() : null;
  }

  /** Opens a fresh measurement window. The EMAs keep their values: they describe "recently", not the
   *  window. */
  reset(): void {
    this.frames = 0;
    this.windowMs = 0;
    this.windowSteps = 0;
    this.windowSimMs = 0;
    this.windowReceiveMs = 0;
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
    const recentDropped = this.droppedTotal - this.recentDroppedAtStart;
    return {
      last: this.last,
      ema: {
        frameMs: this.avgFrameMs,
        cpuMs: this.avgCpuMs,
        simMs: this.avgSimMs,
        receiveMs: this.avgReceiveMs,
        snapMs: this.avgSnapMs,
        drawMs: this.avgDrawMs,
      },
      recent: {
        worstMs: this.recentWorstMs,
        droppedTicks: recentDropped,
        deliveredSpeed: this.deliveredSpeed(),
        sustainedShortfall: this.shortfallHolds(),
      },
      window: {
        frames: this.frames,
        ms: this.windowMs,
        steps: this.windowSteps,
        droppedTicks: this.droppedTotal - this.droppedAtWindowStart,
        deliveredSpeed: windowSeconds === 0 ? 0 : this.windowSteps / windowSeconds / TICKS_PER_SECOND,
        simMsPerTick: this.windowSteps === 0 ? 0 : this.windowSimMs / this.windowSteps,
        receiveMsPerTick: this.windowSteps === 0 ? 0 : this.windowReceiveMs / this.windowSteps,
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
