/**
 * The on-canvas debug readout — the human-facing instrument for the render-scale + sim work. Pinned to
 * the top-LEFT of the screen (beside the tool-panel strip's top; the build menu drops BELOW it, from the
 * buildings button, so the two never collide), lightly translucent so the strip reads through it, it
 * stacks two lines:
 *
 *  - **sim state:** the `tick` (the one field worth keeping from the removed always-on stocks HUD), the
 *    game-speed multiplier (or `paused`), how many sim `steps` the fixed-timestep loop advanced THIS
 *    frame (a spiking count means the sim is falling behind wall-clock), and the entity / drawn / pooled
 *    counts the retained {@link import('@vinland/render').WorldRenderer} exposes (culling is biting when
 *    `drawn` ≪ `entities` zoomed in; `drawn ≈ entities` zoomed out).
 *  - **perf:** a smoothed FPS, the CPU cost split into `sim` / `snap` / `draw` (the exact breakdown
 *    `packages/render/AGENTS.md` says to measure before blaming the GPU — a slow scene is usually the
 *    sim, not the draw), the leftover `gpu`/compositor time, the worst recent frame, and (Chrome only)
 *    the JS heap so a leak or GC sawtooth is visible.
 *
 * Plain DOM + floats — app-layer I/O, outside the deterministic sim (never affects a tick or the
 * headless test). Times are smoothed with an exponential moving average so they read steadily instead of
 * flickering; the tick / steps / counts are shown raw (they are exact per-frame facts, not estimates).
 */

/** The per-frame sim + render stats the readout displays. */
export interface PerfInfo {
  /** The sim tick this frame (the snapshot's tick) — kept from the old stocks HUD, the one useful field. */
  readonly tick: number;
  /** Sim steps the fixed-timestep loop advanced this frame (0 when paused; >1 when catching up). */
  readonly steps: number;
  /** Wall-clock tick-rate multiplier from the game-speed control (×1/×2/×3, or a fractional `?speed=`). */
  readonly speed: number;
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
  panel.textContent = 'fps —';
  document.body.append(panel);

  // Exponential moving averages (ms), seeded lazily on the first real sample.
  let avgMs = 0;
  let avgCpu = 0;
  let avgSim = 0;
  let avgSnap = 0;
  let avgDraw = 0;
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

      const rate = info.paused ? 'paused' : formatSpeed(info.speed);
      const simState = `tick ${info.tick}  ${rate}  steps ${info.steps}   ent ${info.entities}  drawn ${info.drawn}  pooled ${info.pooled}`;

      let perf = `fps ${fps}`;
      if (info.cpuMs !== undefined) {
        avgCpu = ema(avgCpu, info.cpuMs);
        // The frame budget splits into CPU (what the loop timed) and GPU/compositor (the rest).
        const gpu = Math.max(0, avgMs - avgCpu);
        let split = '';
        if (info.simMs !== undefined && info.snapMs !== undefined && info.drawMs !== undefined) {
          avgSim = ema(avgSim, info.simMs);
          avgSnap = ema(avgSnap, info.snapMs);
          avgDraw = ema(avgDraw, info.drawMs);
          split = ` (sim ${avgSim.toFixed(1)} snap ${avgSnap.toFixed(1)} draw ${avgDraw.toFixed(1)})`;
        }
        perf += `  cpu ${avgCpu.toFixed(1)}${split}  gpu ${gpu.toFixed(1)}  worst ${worstMs.toFixed(0)}ms`;
      }
      const heap = heapMb();
      if (heap !== null) perf += `  heap ${heap}MB`;

      panel.textContent = `${simState}\n${perf}`;
    },
  };
}
