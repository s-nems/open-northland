/**
 * HUD design px are the original's asset px (640×480-1024×768 modes); at the largest mode the chrome
 * filled its design px over a 1024×768 screen. A viewport smaller than that times the scale would clip
 * or overlap the chrome, so the viewport bounds the scale from above.
 */
export const REFERENCE_VIEWPORT_WIDTH = 1024;
export const REFERENCE_VIEWPORT_HEIGHT = 768;

/**
 * The display height the world draws 1:1 at. The scale follows the display rather than the window, so
 * resizing or maximizing a window keeps the chrome's size while the window shows more or less of the
 * world (approximation: the original was a 1024×768 fullscreen image every display stretched; 1080
 * lines is the common baseline today).
 */
export const REFERENCE_DISPLAY_HEIGHT = 1080;

/** HUD scale on a {@link REFERENCE_DISPLAY_HEIGHT} display. */
export const UI_SCALE_AT_REFERENCE_DISPLAY = 1.25;

/** The HUD base on a small display: the original's chrome at its own design px, as on its 1024×768. */
export const SMALL_DISPLAY_UI_SCALE = 1;

/** Floor for the HUD scale: below 0.75× the 11 design-px labels drop under ~8 px and stop being legible. */
export const MIN_UI_SCALE = 0.75;

/** The neutral settings factor: the display-derived base applies unmodified. */
export const DEFAULT_UI_SCALE_FACTOR = 1;

/** Player-facing bounds for the relative factor; the settings slider and the stored value obey them. */
export const UI_SCALE_FACTOR_MIN = 0.5;
export const UI_SCALE_FACTOR_MAX = 1.5;
/** Player-facing slider granularity. */
export const UI_SCALE_FACTOR_STEP = 0.05;

/** CSS px; the display's height already carries the operating system's own scaling. */
export interface DisplayView {
  readonly displayHeight: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export function clampUiScaleFactor(factor: number): number {
  return Math.min(UI_SCALE_FACTOR_MAX, Math.max(UI_SCALE_FACTOR_MIN, factor));
}

/**
 * The magnification HUD and world share: the display height over {@link REFERENCE_DISPLAY_HEIGHT}, held
 * at {@link SMALL_DISPLAY_UI_SCALE} for the HUD on a small display, and lowered when the viewport is too
 * small to hold the chrome at that size. Growing both together keeps the chrome's share of the view the
 * same on every display.
 */
export function displayScaleFor(view: DisplayView): number {
  // A display reported shorter than the window holding it (a headless page) is no evidence of one.
  const displayHeight = Math.max(view.displayHeight, view.viewportHeight);
  const fitting =
    Math.min(view.viewportWidth / REFERENCE_VIEWPORT_WIDTH, view.viewportHeight / REFERENCE_VIEWPORT_HEIGHT) /
    UI_SCALE_AT_REFERENCE_DISPLAY;
  const byDisplay = Math.max(
    displayHeight / REFERENCE_DISPLAY_HEIGHT,
    SMALL_DISPLAY_UI_SCALE / UI_SCALE_AT_REFERENCE_DISPLAY,
  );
  return Math.min(byDisplay, fitting);
}

/** Effective HUD scale: the display-derived base times the user's relative factor. */
export function uiScaleFor(view: DisplayView, factor: number = DEFAULT_UI_SCALE_FACTOR): number {
  return Math.max(MIN_UI_SCALE, UI_SCALE_AT_REFERENCE_DISPLAY * displayScaleFor(view) * factor);
}

/** The camera zoom a game opens at. Never below 1:1: a small display shows less world rather than
 *  shrinking the art. */
export function startWorldZoomFor(view: DisplayView): number {
  return Math.max(1, displayScaleFor(view));
}

/** The display the page is shown on, read live, so a window moved to another monitor follows it. */
export function displayViewOf(viewportWidth: number, viewportHeight: number): DisplayView {
  return { displayHeight: window.screen.height, viewportWidth, viewportHeight };
}
