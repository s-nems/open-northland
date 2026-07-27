import type { FrameStatsReport } from '../diag/frame-stats.js';
import { heapMb } from '../diag/heap.js';
import { messages } from '../i18n/index.js';

/**
 * The on-canvas debug readout — the human-facing instrument for render-scale + sim work. Pinned top-left
 * (beside the tool-panel strip; the build menu drops below it so the two never collide), lightly
 * translucent. Two lines: sim state (tick / speed / steps / entity·drawn·pooled counts — a spiking
 * `steps` means the sim is falling behind wall-clock, `drawn ≪ entities` means culling is biting) and
 * perf (smoothed FPS, the CPU `sim`/`snap`/`draw` split, GPU/compositor remainder, worst recent frame,
 * Chrome-only JS heap).
 *
 * Formatting only: the fold lives in `diag/frame-stats.ts`, which is where it can be tested. The
 * `sim`/`snap`/`draw` split is the breakdown `packages/render/AGENTS.md` says to measure before blaming
 * the GPU — a slow scene is usually the sim, not the draw.
 */

export interface PerfOverlayHandle {
  /** Refresh the readout from the frame fold. Call once per frame. */
  update(report: FrameStatsReport): void;
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
 * Mount the debug readout, pinned top-left with its left edge at `leftPx` (the caller passes the
 * tool-panel strip's right edge so the bar clears the strip). Returns a live handle to refresh each frame.
 */
export function mountPerfOverlay(leftPx = 12): PerfOverlayHandle {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_STYLE;
  panel.style.left = `${leftPx}px`;
  panel.textContent = `${messages().performance.fps} —`;
  document.body.append(panel);

  return {
    update(report: FrameStatsReport): void {
      const last = report.last;
      if (last === null) return;
      const copy = messages().performance;
      const { ema } = report;

      const rate = last.paused ? copy.paused : formatDeliveredSpeed(last.speed, ema.deliveredSpeed);
      // Shown only once the loop has actually discarded work, so a healthy session reads as before.
      const dropped = last.droppedTicks > 0 ? `  ${copy.dropped} ${last.droppedTicks}` : '';
      const simState = `${copy.tick} ${last.tick}  ${rate}  ${copy.steps} ${last.steps}${dropped}   ${copy.entities} ${last.entities}  ${copy.drawn} ${last.drawn}  ${copy.pooled} ${last.pooled}`;

      const fps = ema.frameMs > 0 ? Math.round(1000 / ema.frameMs) : 0;
      // The frame budget splits into CPU (what the loop timed) and GPU/compositor (the rest).
      const gpu = Math.max(0, ema.frameMs - ema.cpuMs);
      const split = ` (${copy.sim} ${ema.simMs.toFixed(1)} ${copy.snapshot} ${ema.snapMs.toFixed(1)} ${copy.draw} ${ema.drawMs.toFixed(1)})`;
      let perf =
        `${copy.fps} ${fps}  ${copy.cpu} ${ema.cpuMs.toFixed(1)}${split}` +
        `  ${copy.gpu} ${gpu.toFixed(1)}  ${copy.worst} ${report.recentWorstMs.toFixed(0)}ms`;
      const heap = heapMb();
      if (heap !== null) perf += `  ${copy.heap} ${heap}MB`;

      panel.textContent = `${simState}\n${perf}`;
    },
  };
}
