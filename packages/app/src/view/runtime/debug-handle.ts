/** The machine-readable debug seam both playable entries expose, installed by `startGameView`. */
import type { SessionDriver } from '@open-northland/lockstep';
import type { SpriteSheet, WorldRenderer } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import type { FrameStats, FrameStatsReport } from '../../diag/frame-stats.js';
import { heapMb } from '../../diag/heap.js';
import type { SystemProfileRow } from '../../diag/system-profile.js';
import { recordedTraceEvents, type TraceEvent } from '../../diag/trace.js';
import type { ProfileSource, SessionHost } from '../../session/index.js';
import type { CameraController } from '../camera/index.js';
import type { NetReadout } from './net-readout.js';

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
  readonly version: 2;
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
    /** The sim's stepping time per frame, on whichever thread it runs. */
    readonly simMs: number;
    /** This thread's cost per frame of taking in ticks from a sim on another thread; 0 inline. */
    readonly receiveMs: number;
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
  readonly window: {
    readonly ms: number;
    readonly frames: number;
    readonly steps: number;
    readonly simMsPerTick: number;
    readonly receiveMsPerTick: number;
    /** Tick messages a frame took in from a sim on another thread; 0 inline. */
    readonly batchesPerFrame: number;
    /** The most ticks a sim on another thread stepped past the drawn tick; 0 inline. */
    readonly maxLeadTicks: number;
    /** Exact window means per frame on this thread; `worldMsPerFrame` is the world renderer's share
     *  of `drawMsPerFrame`, the rest of it HUD, minimap, overlays and audio. */
    readonly cpuMsPerFrame: number;
    readonly receiveMsPerFrame: number;
    readonly drawMsPerFrame: number;
    readonly worldMsPerFrame: number;
    readonly maxCpuMs: number;
  };
  /** True when `?debug=profile` is on, which inflates every absolute sim millisecond above. */
  readonly profiling: boolean;
  /** Per-system sim cost since the window opened; empty unless profiling. */
  readonly systems: readonly SystemProfileRow[];
  readonly sampling: PerfSampling;
  /** The connection figures of a relayed session; absent in a local one. */
  readonly net?: NetReadout;
}

export interface OpenNorthlandDebug {
  /** The world as the runtime reads it; the probes await `run`, which steps a paused session, and
   *  `hashState`. */
  readonly host: SessionHost;
  /** Live instances, read-only: the runtime owns their state, and no replay or bundle reproduces a
   *  console mutation of them. */
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet | undefined;
  readonly cameraCtl: CameraController;
  /** Asynchronous because the per-system rows are kept where the sim runs. */
  perf(): Promise<PerfReport>;
  /** Open a fresh measurement window for {@link perf}. */
  resetPerf(): void;
  /** Sets the session's speed directly, reaching multipliers the tool panel's button cannot; the panel
   *  glyph does not follow, and a multiplier of zero or less is refused - `setPaused` stops the clock. */
  setSpeed(multiplier: number): void;
  /** Resolves once the host shows the tick the clock stopped or started on. */
  setPaused(paused: boolean): Promise<void>;
  /** The `?debug=trace` ring (a bounded tail), or null when not recording. */
  trace(): readonly TraceEvent[] | null;
  /** A spectator's seat picker: watch `seat`'s fog and figures, or the whole map for null. Null outside
   *  a spectated session. */
  readonly watchSeat: ((seat: number | null) => void) | null;
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
  readonly net?: NetReadout | null;
}

/** Pure so the report shape is testable without a browser; `page.evaluate` throws on anything that
 *  does not survive structured cloning. */
export function buildPerfReport(inputs: PerfReportInputs): PerfReport {
  const { frame, sampling } = inputs;
  const last = frame.last;
  const meanMs = frame.ema.frameMs;
  return {
    version: 2,
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
      receiveMs: frame.ema.receiveMs,
      snapMs: frame.ema.snapMs,
      drawMs: frame.ema.drawMs,
      gpuMs: Math.max(0, meanMs - frame.ema.cpuMs),
      recentWorstMs: frame.recent.worstMs,
      p50Ms: frame.window.frameMs.p50Ms,
      p95Ms: frame.window.frameMs.p95Ms,
      p99Ms: frame.window.frameMs.p99Ms,
      maxMs: frame.window.frameMs.maxMs,
    },
    window: {
      ms: frame.window.ms,
      frames: frame.window.frames,
      steps: frame.window.steps,
      simMsPerTick: frame.window.simMsPerTick,
      receiveMsPerTick: frame.window.receiveMsPerTick,
      batchesPerFrame: frame.window.batchesPerFrame,
      maxLeadTicks: frame.window.maxLeadTicks,
      cpuMsPerFrame: frame.window.cpuMsPerFrame,
      receiveMsPerFrame: frame.window.receiveMsPerFrame,
      drawMsPerFrame: frame.window.drawMsPerFrame,
      worldMsPerFrame: frame.window.worldMsPerFrame,
      maxCpuMs: frame.window.maxCpuMs,
    },
    profiling: inputs.profiling,
    systems: inputs.systems,
    sampling,
    ...(inputs.net !== undefined && inputs.net !== null ? { net: inputs.net } : {}),
  };
}

export interface DebugHandleDeps {
  readonly host: SessionHost;
  readonly renderer: WorldRenderer;
  readonly sheet: SpriteSheet | undefined;
  readonly cameraCtl: CameraController;
  readonly canvas: HTMLCanvasElement;
  readonly driver: SessionDriver;
  readonly netReadout: () => NetReadout | null;
  readonly frameStats: FrameStats;
  /** Null unless `?debug=profile` asked for a running per-system profile. */
  readonly profile: ProfileSource | null;
  readonly watchSeat: ((seat: number | null) => void) | null;
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
    host: deps.host,
    renderer: deps.renderer,
    sheet: deps.sheet,
    cameraCtl: deps.cameraCtl,
    perf: async () => {
      // The frame figures are read before the rows' round trip, so they describe the moment asked.
      const inputs = {
        frame: deps.frameStats.report(),
        requestedSpeed: deps.driver.speed,
        paused: deps.driver.paused,
        maxStepsPerFrame: deps.driver.maxStepsPerFrame,
        droppedTicksTotal: deps.driver.droppedTicks,
        profiling: deps.profile !== null,
        sampling: sampling(),
        net: deps.netReadout(),
      };
      return buildPerfReport({ ...inputs, systems: (await deps.profile?.rows()) ?? [] });
    },
    resetPerf: () => {
      deps.frameStats.reset();
      deps.profile?.reset();
    },
    setSpeed: (multiplier) => deps.driver.setSpeed(multiplier),
    setPaused: (paused) => {
      deps.driver.setPaused(paused);
      return deps.host.settled();
    },
    trace: () => recordedTraceEvents(),
    watchSeat: deps.watchSeat,
  };
}
