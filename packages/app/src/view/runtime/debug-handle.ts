/** The machine-readable debug seam both playable entries expose, installed by `startGameView`. */
import type { SpriteSheet, WorldRenderer } from '@open-northland/render';
import { type FixedTimestep, type Simulation, TICKS_PER_SECOND } from '@open-northland/sim';
import type { FrameStats, FrameStatsReport } from '../../diag/frame-stats.js';
import { heapMb } from '../../diag/heap.js';
import type { SystemProfile, SystemProfileRow } from '../../diag/system-profile.js';
import { recordedTraceEvents, type TraceEvent } from '../../diag/trace.js';
import type { CameraController } from '../camera/index.js';
import type { LoopSpeedControl } from '../game-tool-panel.js';

declare global {
  interface Window {
    __opennorthland?: OpenNorthlandDebug;
  }
}

/** How the sample was taken; read these before trusting any millisecond above them. */
export interface PerfSampling {
  /** True while the tab is hidden, where rAF throttles to about 1 Hz and every timing below is fiction. */
  readonly hidden: boolean;
  readonly hardwareConcurrency: number;
  readonly devicePixelRatio: number;
  readonly canvas: { readonly width: number; readonly height: number };
  /** Chrome-only JS heap in whole MB; null where the browser does not expose it. */
  readonly heapMb: number | null;
}

export interface PerfReport {
  /** Format version, so a probe can pin its parsing. */
  readonly version: 1;
  readonly tick: number;
  readonly paused: boolean;
  readonly entities: number;
  readonly drawn: number;
  readonly pooled: number;
  readonly throughput: {
    /** What `?speed=` or the speed button asked for. */
    readonly requestedSpeed: number;
    /** What the loop actually delivered; below the request once the per-frame step cap bites. */
    readonly deliveredSpeed: number;
    readonly recentDeliveredSpeed: number;
    readonly ticksPerSecond: number;
    readonly droppedTicks: number;
    readonly droppedTicksTotal: number;
    readonly maxStepsPerFrame: number;
  };
  readonly frame: {
    readonly fps: number;
    readonly meanMs: number;
    readonly cpuMs: number;
    readonly simMs: number;
    readonly snapMs: number;
    readonly drawMs: number;
    /** Frame budget the loop could not time: GPU and compositor. */
    readonly gpuMs: number;
    readonly recentWorstMs: number;
    /** Bucket upper edges, so read them as +/- 15%. */
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly p99Ms: number;
    readonly maxMs: number;
  };
  readonly window: { readonly ms: number; readonly frames: number; readonly steps: number };
  /** True when `?debug=profile` is on, which inflates every absolute sim millisecond above. */
  readonly profiling: boolean;
  /** Per-system sim cost since the window opened; empty unless profiling. */
  readonly systems: readonly SystemProfileRow[];
  readonly sampling: PerfSampling;
}

export interface OpenNorthlandDebug {
  /** The live instances, read-only: a console mutation bypasses the command pipeline and voids that
   *  session's determinism. */
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet | undefined;
  readonly cameraCtl: CameraController;
  perf(): PerfReport;
  /** Open a fresh measurement window for {@link perf}. */
  resetPerf(): void;
  /** Writes the loop's speed control directly, reaching multipliers the tool panel's button cannot;
   *  the panel glyph does not follow. */
  setSpeed(multiplier: number): void;
  setPaused(paused: boolean): void;
  /** The `?debug=trace` ring (a bounded tail), or null when not recording. */
  trace(): readonly TraceEvent[] | null;
}

export interface PerfReportInputs {
  readonly frame: FrameStatsReport;
  readonly requestedSpeed: number;
  readonly paused: boolean;
  readonly maxStepsPerFrame: number;
  readonly droppedTicksTotal: number;
  readonly profiling: boolean;
  readonly systems: readonly SystemProfileRow[];
  readonly sampling: PerfSampling;
}

/** Pure so the report shape is testable without a browser; `page.evaluate` throws on anything that
 *  does not survive structured cloning. */
export function buildPerfReport(inputs: PerfReportInputs): PerfReport {
  const { frame, sampling } = inputs;
  const last = frame.last;
  const meanMs = frame.ema.frameMs;
  return {
    version: 1,
    tick: last?.tick ?? 0,
    paused: inputs.paused,
    entities: last?.entities ?? 0,
    drawn: last?.drawn ?? 0,
    pooled: last?.pooled ?? 0,
    throughput: {
      requestedSpeed: inputs.requestedSpeed,
      deliveredSpeed: frame.window.deliveredSpeed,
      recentDeliveredSpeed: frame.recent.deliveredSpeed,
      ticksPerSecond: frame.window.deliveredSpeed * TICKS_PER_SECOND,
      droppedTicks: frame.window.droppedTicks,
      droppedTicksTotal: inputs.droppedTicksTotal,
      maxStepsPerFrame: inputs.maxStepsPerFrame,
    },
    frame: {
      fps: meanMs > 0 ? Math.round(1000 / meanMs) : 0,
      meanMs,
      cpuMs: frame.ema.cpuMs,
      simMs: frame.ema.simMs,
      snapMs: frame.ema.snapMs,
      drawMs: frame.ema.drawMs,
      gpuMs: Math.max(0, meanMs - frame.ema.cpuMs),
      recentWorstMs: frame.recent.worstMs,
      p50Ms: frame.window.frameMs.p50Ms,
      p95Ms: frame.window.frameMs.p95Ms,
      p99Ms: frame.window.frameMs.p99Ms,
      maxMs: frame.window.frameMs.maxMs,
    },
    window: { ms: frame.window.ms, frames: frame.window.frames, steps: frame.window.steps },
    profiling: inputs.profiling,
    systems: inputs.systems,
    sampling,
  };
}

export interface DebugHandleDeps {
  readonly sim: Simulation;
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet | undefined;
  readonly cameraCtl: CameraController;
  readonly canvas: HTMLCanvasElement;
  readonly control: LoopSpeedControl;
  readonly timestep: FixedTimestep;
  readonly frameStats: FrameStats;
  /** Null unless `?debug=profile` asked for a running per-system profile. */
  readonly profile: SystemProfile | null;
}

export function installDebugHandle(deps: DebugHandleDeps): void {
  const sampling = (): PerfSampling => ({
    hidden: document.hidden,
    hardwareConcurrency: navigator.hardwareConcurrency,
    devicePixelRatio: window.devicePixelRatio,
    canvas: { width: deps.canvas.width, height: deps.canvas.height },
    heapMb: heapMb(),
  });

  window.__opennorthland = {
    sim: deps.sim,
    renderer: deps.renderer,
    sheet: deps.sheet,
    cameraCtl: deps.cameraCtl,
    perf: () =>
      buildPerfReport({
        frame: deps.frameStats.report(),
        requestedSpeed: deps.control.speed,
        paused: deps.control.paused,
        maxStepsPerFrame: deps.timestep.maxSteps,
        droppedTicksTotal: deps.timestep.droppedTicks,
        profiling: deps.profile !== null,
        systems: deps.profile?.rows() ?? [],
        sampling: sampling(),
      }),
    resetPerf: () => {
      deps.frameStats.reset();
      deps.profile?.reset();
    },
    setSpeed: (multiplier) => {
      deps.control.speed = multiplier;
    },
    setPaused: (paused) => {
      deps.control.paused = paused;
    },
    trace: () => recordedTraceEvents(),
  };
}
