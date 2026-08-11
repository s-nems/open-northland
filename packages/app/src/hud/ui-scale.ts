/**
 * HUD design px are the original's asset px (640×480-1024×768 modes); at the largest mode the chrome
 * occupied its design px over 768 screen lines. `viewportHeight / 768` keeps that fraction
 * (approximation), and between the bounds below that leaves the derivation live from 576 to 960
 * canvas lines.
 */
export const REFERENCE_VIEWPORT_HEIGHT = 768;

/** Floor for the HUD scale: below 0.75× the 11 design-px labels drop under ~8 px and stop being legible. */
export const MIN_UI_SCALE = 0.75;

/**
 * Ceiling for the viewport-derived base. The world draws at 1:1 asset px on every viewport, so chrome
 * that kept tracking screen height would swallow the extra view a tall display buys rather than match
 * it (approximation).
 */
export const MAX_UI_SCALE_BASE = 1.25;

/** The neutral settings factor: the viewport-derived base applies unmodified. */
export const DEFAULT_UI_SCALE_FACTOR = 1;

/** Player-facing bounds for the relative factor; the settings slider and the stored value obey them. */
export const UI_SCALE_FACTOR_MIN = 0.5;
export const UI_SCALE_FACTOR_MAX = 1.5;
/** Player-facing slider granularity. */
export const UI_SCALE_FACTOR_STEP = 0.05;

export function clampUiScaleFactor(factor: number): number {
  return Math.min(UI_SCALE_FACTOR_MAX, Math.max(UI_SCALE_FACTOR_MIN, factor));
}

/** Effective HUD scale for a viewport: the capped height-derived base times the user's relative factor. */
export function uiScaleFor(viewportHeight: number, factor: number = DEFAULT_UI_SCALE_FACTOR): number {
  const base = Math.min(MAX_UI_SCALE_BASE, viewportHeight / REFERENCE_VIEWPORT_HEIGHT);
  return Math.max(MIN_UI_SCALE, base * factor);
}
