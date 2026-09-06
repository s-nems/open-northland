import type { FrameRecent, FrameStatsReport } from '../diag/frame-stats.js';
import { heapMb } from '../diag/heap.js';
import { messages } from '../i18n/index.js';

/**
 * The on-canvas debug readout: one line of sim state, one of frame timing. Formatting only, the fold
 * lives in `diag/frame-stats.ts` where it can be tested.
 */

export interface PerfOverlayHandle {
  /** Call once per frame. */
  update(report: FrameStatsReport): void;
  /** Re-anchor the readout's top-left corner, so it keeps clear of the HUD chrome at a new scale. */
  place(leftPx: number, topPx: number): void;
  dispose(): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'box-sizing:border-box',
  'padding:6px 12px',
  // Lightly translucent so the tool-panel strip and map read through the bar.
  'background:rgba(20,16,12,0.55)',
  'color:#b7f0a0',
  'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid rgba(74,90,54,0.6)',
  'border-radius:6px',
  'z-index:50',
  'white-space:pre',
  'pointer-events:none',
].join(';');

function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? `×${speed}` : `×${speed.toFixed(2)}`;
}

/** Delivered speed is a two-second average, good to about a tenth; more digits would overstate it. */
function formatDelivered(speed: number): string {
  return `×${speed.toFixed(1)}`;
}

/**
 * Shows the delivered speed only on a sustained shortfall: without discarded ticks the accumulator
 * carries every fraction into the next frame and delivered converges on requested exactly.
 */
function formatDeliveredSpeed(requested: number, recent: FrameRecent): string {
  const label = formatSpeed(requested);
  if (!recent.sustainedShortfall) return label;
  const delivered = formatDelivered(recent.deliveredSpeed);
  // An arrow with identical sides claims a shortfall it cannot show; say nothing instead.
  return delivered === formatDelivered(requested) ? label : `${label}→${delivered}`;
}

/** Mount the debug readout pinned top-left, its corner at `(leftPx, topPx)` to clear the tool-panel strip
 *  and the message notes along the top edge. */
export function mountPerfOverlay(leftPx: number, topPx: number): PerfOverlayHandle {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_STYLE;
  panel.style.left = `${leftPx}px`;
  panel.style.top = `${topPx}px`;
  panel.textContent = `${messages().performance.fps} -`;
  document.body.append(panel);

  return {
    update(report: FrameStatsReport): void {
      const last = report.last;
      if (last === null) return;
      const copy = messages().performance;
      const { ema, recent } = report;

      const rate = last.paused ? copy.paused : formatDeliveredSpeed(last.speed, recent);
      // The rolling window's count, not the session total, so a recovered stall leaves the readout.
      const dropped = recent.sustainedShortfall ? `  ${copy.dropped} ${recent.droppedTicks}` : '';
      const simState = `${copy.tick} ${last.tick}  ${rate}  ${copy.steps} ${last.steps}${dropped}   ${copy.entities} ${last.entities}  ${copy.drawn} ${last.drawn}  ${copy.pooled} ${last.pooled}`;

      const fps = ema.frameMs > 0 ? Math.round(1000 / ema.frameMs) : 0;
      // The frame budget splits into CPU (what the loop timed) and GPU/compositor (the rest).
      const gpu = Math.max(0, ema.frameMs - ema.cpuMs);
      const split = ` (${copy.sim} ${ema.simMs.toFixed(1)} ${copy.snapshot} ${ema.snapMs.toFixed(1)} ${copy.draw} ${ema.drawMs.toFixed(1)})`;
      let perf =
        `${copy.fps} ${fps}  ${copy.cpu} ${ema.cpuMs.toFixed(1)}${split}` +
        `  ${copy.gpu} ${gpu.toFixed(1)}  ${copy.worst} ${recent.worstMs.toFixed(0)}ms`;
      const heap = heapMb();
      if (heap !== null) perf += `  ${copy.heap} ${heap}MB`;

      panel.textContent = `${simState}\n${perf}`;
    },
    place(leftPx, topPx): void {
      panel.style.left = `${leftPx}px`;
      panel.style.top = `${topPx}px`;
    },
    dispose: () => panel.remove(),
  };
}
