import type { FrameRecent, FrameStatsReport } from '../diag/frame-stats.js';
import { heapMb } from '../diag/heap.js';
import { messages } from '../i18n/index.js';
import type { NetReadout } from './runtime/net-readout.js';

/**
 * The on-canvas debug readout: one line of sim state, one of frame timing, and in a relayed session
 * one of connection figures. Formatting only, the fold lives in `diag/frame-stats.ts` where it can
 * be tested.
 */

export interface PerfOverlayHandle {
  /** Call once per frame; a hidden readout neither folds the stats nor formats anything. */
  update(report: () => FrameStatsReport, net: () => NetReadout | null): void;
  /** Re-anchor the readout along the bottom edge between the minimap and the details panel. */
  place(leftPx: number, rightPx: number, bottomPx: number): void;
  setVisible(visible: boolean): void;
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
  // Clipped rather than wrapped, so a narrow window loses the tail of a line instead of covering the panel.
  'overflow:hidden',
  'white-space:pre',
  'pointer-events:none',
].join(';');

export function formatSpeed(speed: number): string {
  return Number.isInteger(speed) ? `×${speed}` : `×${speed.toFixed(2)}`;
}

/** Delivered speed averages a second or less, good to about a tenth; more digits would overstate it. */
export function formatDelivered(speed: number): string {
  return `×${speed.toFixed(1)}`;
}

/** Shows the delivered speed only on a sustained shortfall: a window's edge moves a healthy loop's
 *  figure by a tick either way, which is not worth an arrow. */
function formatDeliveredSpeed(requested: number, recent: FrameRecent): string {
  const label = formatSpeed(requested);
  if (!recent.sustainedShortfall) return label;
  const delivered = formatDelivered(recent.deliveredSpeed);
  // An arrow with identical sides claims a shortfall it cannot show; say nothing instead.
  return delivered === formatDelivered(requested) ? label : `${label}→${delivered}`;
}

function formatMs(ms: number | null): string {
  return ms === null ? '-' : `${ms.toFixed(0)}ms`;
}

export function formatNetReadout(net: NetReadout): string {
  const copy = messages().performance;
  const delay =
    net.delayTicks === null
      ? '-'
      : `${net.delayTicks} (${net.delayMs === null ? '-' : `${net.delayMs.toFixed(0)}ms`})`;
  const link = net.connected ? '' : `  ${copy.reconnecting}`;
  return (
    `${copy.roundTrip} ${formatMs(net.roundTripMs)}  ${copy.delay} ${delay}` +
    `  ${copy.clickToApply} ${formatMs(net.clickToApplyMs)}  ${copy.buffer} ${net.bufferedTicks}${link}`
  );
}

/** Mount the debug readout hidden along the bottom edge, spanning from `leftPx` (clear of the minimap)
 *  to `rightPx` from the right edge (clear of the details panel), `bottomPx` up. */
export function mountPerfOverlay(leftPx: number, rightPx: number, bottomPx: number): PerfOverlayHandle {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_STYLE;
  panel.style.left = `${leftPx}px`;
  panel.style.right = `${rightPx}px`;
  panel.style.bottom = `${bottomPx}px`;
  panel.style.display = 'none';
  panel.textContent = `${messages().performance.fps} -`;
  document.body.append(panel);
  let visible = false;

  return {
    update(readReport, readNet): void {
      if (!visible) return;
      const report = readReport();
      const last = report.last;
      if (last === null) return;
      const copy = messages().performance;
      const { ema, recent } = report;
      const net = readNet();

      const rate = last.paused ? copy.paused : formatDeliveredSpeed(last.speed, recent);
      // The rolling window's count, not the session total, so a recovered stall leaves the readout. A
      // worker that holds its clock falls short without dropping, so a zero says nothing.
      const dropped =
        recent.sustainedShortfall && recent.droppedTicks > 0
          ? `  ${copy.dropped} ${recent.droppedTicks}`
          : '';
      const simState = `${copy.tick} ${last.tick}  ${rate}  ${copy.steps} ${last.steps}${dropped}   ${copy.entities} ${last.entities}  ${copy.drawn} ${last.drawn}  ${copy.pooled} ${last.pooled}`;

      const fps = ema.frameMs > 0 ? Math.round(1000 / ema.frameMs) : 0;
      // The frame budget splits into CPU (what the loop timed) and GPU/compositor (the rest).
      const gpu = Math.max(0, ema.frameMs - ema.cpuMs);
      // Receive shows only when the sim runs on another thread, the one case it costs anything.
      const receive = ema.receiveMs > 0 ? ` ${copy.receive} ${ema.receiveMs.toFixed(1)}` : '';
      const split = ` (${copy.sim} ${ema.simMs.toFixed(1)}${receive} ${copy.snapshot} ${ema.snapMs.toFixed(1)} ${copy.draw} ${ema.drawMs.toFixed(1)})`;
      let perf =
        `${copy.fps} ${fps}  ${copy.cpu} ${ema.cpuMs.toFixed(1)}${split}` +
        `  ${copy.gpu} ${gpu.toFixed(1)}  ${copy.worst} ${recent.worstMs.toFixed(0)}ms`;
      const heap = heapMb();
      if (heap !== null) perf += `  ${copy.heap} ${heap}MB`;

      panel.textContent =
        net === null ? `${simState}\n${perf}` : `${simState}\n${perf}\n${formatNetReadout(net)}`;
    },
    place(leftPx, rightPx, bottomPx): void {
      panel.style.left = `${leftPx}px`;
      panel.style.right = `${rightPx}px`;
      panel.style.bottom = `${bottomPx}px`;
    },
    setVisible(next): void {
      visible = next;
      panel.style.display = next ? '' : 'none';
    },
    dispose: () => panel.remove(),
  };
}
