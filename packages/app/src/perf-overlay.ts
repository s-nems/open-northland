/**
 * A tiny on-canvas performance readout — the human-facing instrument for the render-scale work. It
 * shows a smoothed FPS plus the entity / drawn / pooled counts the retained {@link
 * import('@vinland/render').WorldRenderer} exposes, so a reviewer watching the stress scene can SEE
 * whether a 256×256 map with thousands of bobs holds a frame rate (and whether culling is biting:
 * `drawn` ≪ `entities` when zoomed in, `drawn ≈ entities` when zoomed all the way out).
 *
 * Plain DOM + floats — app-layer I/O, outside the deterministic sim (never affects a tick or the
 * headless test). FPS is derived from the wall-clock frame delta the caller already has, smoothed with
 * an exponential moving average so it reads steadily instead of flickering.
 */

/** The per-frame render stats the overlay displays (the {@link import('@vinland/render').WorldRenderer} readout + the snapshot size). */
export interface PerfInfo {
  /** Total drawable entities in the snapshot this frame (pre-cull). */
  readonly entities: number;
  /** Sprites actually drawn this frame (post-cull). */
  readonly drawn: number;
  /** Entity sprites currently pooled (bounded by the live drawable entity count). */
  readonly pooled: number;
}

export interface PerfOverlayHandle {
  /** Refresh the readout from this frame's wall-clock delta (ms) + render stats. Call once per frame. */
  update(elapsedMs: number, info: PerfInfo): void;
}

const PANEL_STYLE = [
  'position:fixed',
  'left:12px',
  'bottom:12px',
  'box-sizing:border-box',
  'padding:8px 10px',
  'background:rgba(20,16,12,0.9)',
  'color:#b7f0a0',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #4a5a36',
  'border-radius:6px',
  'z-index:50',
  'white-space:pre',
  'pointer-events:none',
].join(';');

/** Weight of the newest frame in the FPS moving average (smaller = smoother, slower to react). */
const FPS_SMOOTHING = 0.1;

/** Mount the perf readout (bottom-left). Returns a live handle to refresh each frame. */
export function mountPerfOverlay(): PerfOverlayHandle {
  const panel = document.createElement('div');
  panel.style.cssText = PANEL_STYLE;
  panel.textContent = 'fps —';
  document.body.append(panel);

  // Exponential moving average of the frame time (ms), seeded lazily on the first real delta.
  let avgMs = 0;
  return {
    update(elapsedMs: number, info: PerfInfo): void {
      if (elapsedMs > 0)
        avgMs = avgMs === 0 ? elapsedMs : avgMs * (1 - FPS_SMOOTHING) + elapsedMs * FPS_SMOOTHING;
      const fps = avgMs > 0 ? Math.round(1000 / avgMs) : 0;
      panel.textContent = `fps ${fps}   entities ${info.entities}   drawn ${info.drawn}   pooled ${info.pooled}`;
    },
  };
}
