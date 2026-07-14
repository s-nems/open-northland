import type { Graphics } from 'pixi.js';
import type { Rect } from '../geometry.js';
import { type BarTone, barTone } from './model/index.js';

/**
 * The details panel's progress/need bar rendering — the recessed-groove gauge and its colour ramp, drawn
 * as pure functions over a passed `Graphics`. All gauge shading strengths are eyeballed against the
 * parchment panel, not sampled from the original (which has no decoded bar-draw code).
 */

/**
 * Fallback flat gauge fills for a checkout without `content/` (no decoded ramp): green = content,
 * orange = draining, red = nearly empty, banded by {@link barTone}. With `content/` present the fill
 * colour comes from the original's decoded `bar_hitpoints` level ramp instead (see `GuiBarRamp`),
 * which sweeps red→orange→yellow-green continuously.
 */
const BAR_TONE_FILL: Readonly<Record<BarTone, number>> = {
  ok: 0x4f9e3c,
  warn: 0xd08a2e,
  critical: 0xb5392b,
};
/** The neutral production-progress fill — a warm amber that sits on the parchment without reading as a
 *  health/need level (eyeballed). */
export const PRODUCTION_BAR_FILL = 0xb8894a;

/** Where the gauge fill's vertical gradient rolls over from the lit top into the shaded bottom
 *  (fraction of the fill height). */
const GAUGE_GRADIENT_KNEE = 0.45;
/** How far the fill's lit top is blended toward white / the shaded bottom toward black. */
const GAUGE_TOP_LIGHTEN = 0.38;
const GAUGE_BOTTOM_DARKEN = 0.34;
/** The one-px specular line along the fill's top edge. */
const GAUGE_SPECULAR_ALPHA = 0.28;
/** How far the fill's leading-edge lip is darkened, so the gauge end reads as a surface. */
const GAUGE_LIP_DARKEN = 0.45;

/** The gauge groove's shared bevel palette — the panel's inner-box dark/light lines, passed in from the
 *  {@link import('./chrome.js').Chrome} kit so the gauge outline matches the rest of the panel framing. */
export interface GaugeBevel {
  readonly dark: number;
  readonly light: number;
}

/** The gauge fill colour at `clamped` (0..100): the decoded ramp's entry at the level index, else the
 *  flat banded fallback (no `content/`). */
export function rampColor(barRamp: readonly number[] | undefined, clamped: number): number {
  if (barRamp === undefined || barRamp.length === 0) return BAR_TONE_FILL[barTone(clamped)];
  const index = Math.min(barRamp.length - 1, Math.round((clamped / 100) * (barRamp.length - 1)));
  return barRamp[index] ?? BAR_TONE_FILL[barTone(clamped)];
}

/** Blend `from` toward `to` by `t` (0..1), per RGB channel — the gauge's gradient math. */
function mixColor(from: number, to: number, t: number): number {
  const ch = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * t) << shift;
  };
  return ch(16) | ch(8) | ch(0);
}

/**
 * The shared bar track+fill draw. Drawn entirely as Graphics, not the grey `bar_disabled` art (whose
 * middle read as a stuck bar and broke down when stretched long for the production row) — the
 * PalettedSprite art can't be tinted per-sprite (see paletted-sprite.ts). The fill is a smooth vertical
 * gradient of `base` in 1-px strips (no gradient textures to leak on the panel's 4 Hz rebuilds).
 */
export function drawGauge(
  g: Graphics,
  r: Rect,
  clamped: number,
  line: number,
  base: number,
  bevel: GaugeBevel,
): void {
  // Track groove: solid dark body, a crisp dark outline, an inner top shadow (inset illusion), and a
  // one-px parchment light catch just under the bottom edge (the emboss the wood around it casts).
  g.rect(r.x, r.y, r.w, r.h).fill(0x160f09);
  g.rect(r.x, r.y, r.w, r.h).stroke({ color: bevel.dark, width: line });
  g.rect(r.x + line, r.y + line, r.w - 2 * line, line).fill({ color: 0x000000, alpha: 0.45 });
  g.rect(r.x, r.y + r.h, r.w, line).fill({ color: bevel.light, alpha: 0.35 });

  const fillW = Math.max(0, Math.round((r.w - line * 2) * (clamped / 100)));
  if (fillW === 0) return;
  const fill: Rect = { x: r.x + line, y: r.y + line, w: fillW, h: Math.max(1, r.h - line * 2) };
  // Vertical gradient: a lit top rolling over the base into a shaded bottom — one strip per px.
  const top = mixColor(base, 0xffffff, GAUGE_TOP_LIGHTEN);
  const bottom = mixColor(base, 0x000000, GAUGE_BOTTOM_DARKEN);
  const steps = Math.max(2, Math.round(fill.h));
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const color =
      t < GAUGE_GRADIENT_KNEE
        ? mixColor(top, base, t / GAUGE_GRADIENT_KNEE)
        : mixColor(base, bottom, (t - GAUGE_GRADIENT_KNEE) / (1 - GAUGE_GRADIENT_KNEE));
    const y0 = fill.y + (fill.h * i) / steps;
    const y1 = fill.y + (fill.h * (i + 1)) / steps;
    g.rect(fill.x, y0, fill.w, y1 - y0 + 0.5).fill(color);
  }
  // A hair of specular along the very top and a darker lip on the fill's leading (right) edge, so the
  // gauge end reads as a surface, not a paint cutoff.
  g.rect(fill.x, fill.y, fill.w, line).fill({ color: 0xffffff, alpha: GAUGE_SPECULAR_ALPHA });
  if (fillW > line * 2) {
    g.rect(fill.x + fill.w - line, fill.y, line, fill.h).fill({
      color: mixColor(base, 0x000000, GAUGE_LIP_DARKEN),
      alpha: 0.9,
    });
  }
}
