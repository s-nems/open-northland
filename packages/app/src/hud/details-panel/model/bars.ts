import { ONE } from '@vinland/sim';

/**
 * The details panel's bar/percentage primitives — the gauge model + colour banding + the two clamped
 * 0..100 percent helpers, shared by the settler and building model halves.
 */

/**
 * One stat bar in the Ogólne section: a pinned label + a 0..100 LEVEL + the hover value text. The bars
 * show the original's SATISFACTION (full = content, like the original's coloured bars), not the sim's
 * rising deficit — see {@link import('./settler.js').satisfactionBars}.
 */
export interface PanelBar {
  readonly label: string;
  readonly pct: number;
  /** The cursor-tooltip value for the hovered bar row: raw points for health ("300/1000"),
   *  the satisfaction percent for a need ("75%"). */
  readonly hover: string;
}

/** A bar gauge's colour band: full/high draws green, a draining stat turns orange, a nearly-empty one red. */
export type BarTone = 'ok' | 'warn' | 'critical';
/** Below this satisfaction/health percent a FALLBACK bar turns orange. The banded colours are only the
 *  no-`content/` fallback — with decoded art the gauge colour comes from the original's continuous
 *  `bar_hitpoints`/`bar_standart` level ramps; these band thresholds are our own choice. */
const BAR_WARN_BELOW_PCT = 50;
/** Below this percent a fallback bar turns red. */
const BAR_CRITICAL_BELOW_PCT = 25;

/** The green/orange/red band a 0..100 bar level falls into — the no-`content/` fallback colouring
 *  (`chrome.ts` `BAR_TONE_FILL`; with content the decoded `GuiBarRamp` colours the gauge instead). */
export function barTone(pct: number): BarTone {
  if (pct < BAR_CRITICAL_BELOW_PCT) return 'critical';
  if (pct < BAR_WARN_BELOW_PCT) return 'warn';
  return 'ok';
}

/** Round to an integer percent clamped into the drawable 0..100 bar range. */
export function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function pct(fixed: number | undefined): number {
  return fixed === undefined ? 0 : clampPct((fixed / ONE) * 100);
}

export function pctRatio(elapsed: number | undefined, duration: number | undefined): number {
  if (elapsed === undefined || duration === undefined || duration <= 0) return 0;
  return clampPct((elapsed / duration) * 100);
}
