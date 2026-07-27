import { messages } from '../i18n/index.js';

/**
 * The on-canvas debug readout — the human-facing instrument for render-scale + sim work. Pinned top-left
 * (beside the tool-panel strip; the build menu drops below it so the two never collide), lightly
 * translucent. Two lines: sim state (tick / speed / steps / entity·drawn·pooled counts — a spiking
 * `steps` means the sim is falling behind wall-clock, `drawn ≪ entities` means culling is biting) and
 * perf (smoothed FPS, the CPU `sim`/`snap`/`draw` split, GPU/compositor remainder, worst recent frame,
 * Chrome-only JS heap). Per-field detail lives on {@link PerfInfo}.
 *
 * Plain DOM + floats — app-layer I/O, outside the deterministic sim. Times are smoothed with an EMA so
 * they read steadily; the tick / steps / counts are shown raw (exact per-frame facts, not estimates).
 * The `sim`/`snap`/`draw` split is the breakdown `packages/render/AGENTS.md` says to measure before
 * blaming the GPU — a slow scene is usually the sim, not the draw.
 */

/** The per-frame sim + render stats the readout displays. */
export interface PerfInfo {
  /** The sim tick this frame (the snapshot's tick). */
  readonly tick: number;
  /** Sim steps the fixed-timestep loop advanced this frame (0 when paused; >1 when catching up). */
  readonly steps: number;
  /** Wall-clock tick-rate multiplier from the game-speed control (×1/×2/×3, or a fractional `?speed=`). */
  readonly speed: number;
  /** The multiplier the loop actually ran this frame. Below {@link speed} once the fixed timestep's
   *  per-frame cap bites, which it does on a heavy world long before a high `?speed=` is reachable. */
  readonly deliveredSpeed: number;
  /** Ticks the cap has discarded this session. Non-zero means the requested speed is not being met. */
  readonly droppedTicks: number;
  /** Whether the loop is paused (freezes the tick + steps). */
  readonly paused: boolean;
  /** Total drawable entities in the snapshot this frame (pre-cull). */
  readonly entities: number;
  /** Sprites actually drawn this frame (post-cull). */
  readonly drawn: number;
  /** Entity sprites currently pooled (bounded by the live drawable entity count). */
  readonly pooled: number;
  /** CPU time (ms) the loop spent this frame in sim + snapshot + render-build (everything it can time);
   *  the remainder of the frame budget is GPU/compositor. Optional — omit to hide the split. */
  readonly cpuMs?: number;
  /** The CPU split (ms): the sim step(s) this frame. */
  readonly simMs?: number;
  /** The CPU split (ms): the `snapshot()` clone. */
  readonly snapMs?: number;
  /** The CPU split (ms): the render build + submit (and the rest of the frame's app work). Sum of the
   *  three ≈ {@link cpuMs}. */
  readonly drawMs?: number;
}

export interface PerfOverlayHandle {
  /** Refresh the readout from this frame's wall-clock delta (ms) + stats. Call once per frame. */
  update(elapsedMs: number, info: PerfInfo): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'top:12px',
  'box-sizing:border-box',
  'padding:6px 12px',
  // Lightly translucent so the tool-panel strip / map read through the debug bar underneath it.
  'background:rgba(20,16,12,0.55)',
  'color:#b7f0a0',
  'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(74,90,54,0.6)',
  'border-radius:6px',
  'z-index:50',
  'white-space:pre',
  'pointer-events:none',
].join(';');

/** Weight of the newest frame in the moving averages (smaller = smoother, slower to react). */
const SMOOTHING = 0.1;
/** How many frames the worst-frame tracker holds before resetting — so the spike readout reflects the
 *  recent window, not the whole session. */
const WORST_WINDOW_FRAMES = 120;

/** `×2`, `×0.50`, … — integer speeds stay terse; a fractional `?speed=` shows two decimals. */
function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? `×${speed}` : `×${speed.toFixed(2)}`;
}

/** Relative shortfall below which requested and delivered speed are treated as the same number. Frame
 *  timing jitters either side of the request even when the loop is comfortably keeping up. */
const SPEED_SHORTFALL_TOLERANCE = 0.05;

/**
 * `×2` while the loop keeps up, `×10→×4.2` once it cannot. A healthy session reads exactly as it did
 * before this split existed; the arrow only appears when the requested speed is not being delivered.
 */
function formatDeliveredSpeed(requested: number, delivered: number): string {
  // No sample yet (the opening frames, or a paused loop): report what was asked for, not a zero.
  if (delivered <= 0) return formatSpeed(requested);
  const shortfall = requested > 0 ? (requested - delivered) / requested : 0;
  if (shortfall <= SPEED_SHORTFALL_TOLERANCE) return formatSpeed(requested);
  return `${formatSpeed(requested)}→${formatSpeed(Number(delivered.toFixed(1)))}`;
}

/**
 * The JS heap in whole MB, or `null` where the browser doesn't expose it. `performance.memory` is a
 * non-standard Chrome-only field (undefined in Firefox/Safari and headless software-GL runs), so it is
 * read defensively and simply omitted when absent — a leak/GC signal for the one browser that has it.
 */
function heapMb(): number | null {
  const mem = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  if (mem === undefined || typeof mem.usedJSHeapSize !== 'number') return null;
  return Math.round(mem.usedJSHeapSize / (1024 * 1024));
}

/**
 * Mount the debug readout, pinned top-left with its left edge at `leftPx` (the caller passes the
 * tool-panel strip's right edge so the bar clears the strip). Returns a live handle to refresh each frame.
 */
export function mountPerfOverlay(leftPx = 12): PerfOverlayHandle {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_STYLE;
  panel.style.left = `${leftPx}px`;
  panel.textContent = `${messages().performance.fps} —`;
  document.body.append(panel);

  // Exponential moving averages (ms), seeded lazily on the first real sample.
  let avgMs = 0;
  let avgCpu = 0;
  let avgSim = 0;
  let avgSnap = 0;
  let avgDraw = 0;
  let avgDelivered = 0;
  // Worst (longest) frame in the current window — catches periodic GC/compositor spikes an average hides.
  let worstMs = 0;
  let worstCount = 0;
  const ema = (avg: number, sample: number): number =>
    avg === 0 ? sample : avg * (1 - SMOOTHING) + sample * SMOOTHING;

  return {
    update(elapsedMs: number, info: PerfInfo): void {
      if (elapsedMs > 0) avgMs = ema(avgMs, elapsedMs);
      const fps = avgMs > 0 ? Math.round(1000 / avgMs) : 0;
      if (elapsedMs > worstMs) worstMs = elapsedMs;
      if (++worstCount >= WORST_WINDOW_FRAMES) {
        worstMs = elapsedMs;
        worstCount = 0;
      }

      const copy = messages().performance;
      if (!info.paused) avgDelivered = ema(avgDelivered, info.deliveredSpeed);
      const rate = info.paused ? copy.paused : formatDeliveredSpeed(info.speed, avgDelivered);
      // Shown only once the loop has actually discarded work, so a healthy session reads as before.
      const dropped = info.droppedTicks > 0 ? `  ${copy.dropped} ${info.droppedTicks}` : '';
      const simState = `${copy.tick} ${info.tick}  ${rate}  ${copy.steps} ${info.steps}${dropped}   ${copy.entities} ${info.entities}  ${copy.drawn} ${info.drawn}  ${copy.pooled} ${info.pooled}`;

      let perf = `${copy.fps} ${fps}`;
      if (info.cpuMs !== undefined) {
        avgCpu = ema(avgCpu, info.cpuMs);
        // The frame budget splits into CPU (what the loop timed) and GPU/compositor (the rest).
        const gpu = Math.max(0, avgMs - avgCpu);
        let split = '';
        if (info.simMs !== undefined && info.snapMs !== undefined && info.drawMs !== undefined) {
          avgSim = ema(avgSim, info.simMs);
          avgSnap = ema(avgSnap, info.snapMs);
          avgDraw = ema(avgDraw, info.drawMs);
          split = ` (${copy.sim} ${avgSim.toFixed(1)} ${copy.snapshot} ${avgSnap.toFixed(1)} ${copy.draw} ${avgDraw.toFixed(1)})`;
        }
        perf += `  ${copy.cpu} ${avgCpu.toFixed(1)}${split}  ${copy.gpu} ${gpu.toFixed(1)}  ${copy.worst} ${worstMs.toFixed(0)}ms`;
      }
      const heap = heapMb();
      if (heap !== null) perf += `  ${copy.heap} ${heap}MB`;

      panel.textContent = `${simState}\n${perf}`;
    },
  };
}
