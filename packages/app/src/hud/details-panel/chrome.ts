import type { Container, Graphics, Texture } from 'pixi.js';
import { HOVER_ALPHA, HOVER_TINT, tileBitmap, WINDOW_BORDER } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import { createFrameBorderKit } from './frame-border.js';
import { drawGauge, rampColor } from './gauge.js';
import { createTextKit, type TextKit } from './text.js';

/**
 * The details panel's original-art drawing kit, created per rebuild over that rebuild's layer containers.
 * Every piece degrades to a flat parchment Graphics look when `content/` is absent.
 */

/** Inner content-box bevel lines - eyeballed against the original's preview framing, not sampled. */
const INNER_BOX_DARK = 0x1c130b;
const INNER_BOX_LIGHT = 0x7a6244;
/** Flat fallback for the section card body without `content/`: the grey-blue the `bg_selected` marble
 *  averages to through the `bg_normal` element palette (decoded #3c4043). */
const CARD_FILL = 0x3c4043;

/** The panel's draw layers, back to front: `back` bitmap fills, `g` flat fills, `front` sprites,
 *  `text`. */
export interface PanelLayers {
  readonly g: Graphics;
  readonly back: Container;
  readonly front: Container;
  readonly text: Container;
}

export interface Chrome extends TextKit {
  /** A section window: the tiled grey-blue card fill + the rope-strip border with knot corners. */
  window(r: Rect): void;
  /** The rust headline strip with centered light title-size text. */
  headline(r: Rect, title: string): void;
  /** A section button (tiled button fill, hover/disabled states, centered label). */
  button(hit: { readonly rect: Rect; readonly enabled: boolean }, label: string, hovered: boolean): void;
  /** A health bar, its fill colour from the decoded `bar_hitpoints` ramp at the current level. */
  bar(r: Rect, pct: number): void;
}

export function createChrome(
  assets: DetailsPanelAssets,
  scale: number,
  layers: PanelLayers,
  /**
   * The off-screen bake texture's size, which the `PalettedSprite` meshes project native px into. Every
   * mesh renders upright (`flipY`) so the panel bakes without a whole-texture Y-flip, which its
   * Pixi-native Graphics could not share.
   */
  resolution: { readonly w: number; readonly h: number },
): Chrome {
  const { art, bitmaps } = assets;
  const { g } = layers;

  const { textAt, textCentered } = createTextKit(layers.text, assets.uiFont.family, scale);
  const { frameBorder } = createFrameBorderKit({ art, front: layers.front, scale, resolution });

  const tile = (texture: Texture | undefined, r: Rect, target: Container = layers.back): boolean =>
    tileBitmap(target, texture, r, scale);

  // Named to avoid shadowing the global `window` inside this closure.
  const windowBox = (r: Rect): void => {
    if (!tile(bitmaps.card, r)) {
      g.rect(r.x, r.y, r.w, r.h).fill(CARD_FILL);
    }
    if (art !== null) frameBorder(r);
    else g.rect(r.x, r.y, r.w, r.h).stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });
  };

  const headline = (r: Rect, title: string): void => {
    const inset = Math.max(1, Math.round(scale));
    const strip: Rect = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - inset };
    if (!tile(bitmaps.headline, strip)) {
      g.rect(strip.x, strip.y, strip.w, strip.h).fill({ color: 0x2d1d13, alpha: 0.72 });
    }
    // Dark edging under the strip separates it from the wood body (the original's outlined title bar).
    g.rect(strip.x, strip.y, strip.w, strip.h).stroke({ color: INNER_BOX_DARK, width: inset });
    // Fit to the strip so a long personalized name (first + patronymic) shrinks rather than overflowing.
    textCentered(title, strip, 'white', 'title', strip.w - 2 * inset);
  };

  const button = (
    hit: { readonly rect: Rect; readonly enabled: boolean },
    label: string,
    hovered: boolean,
  ): void => {
    const r = hit.rect;
    const fill = hovered && hit.enabled ? bitmaps.buttonHilite : hit.enabled ? bitmaps.button : bitmaps.bg;
    const onBitmap = tile(fill, r);
    if (!onBitmap) {
      g.rect(r.x, r.y, r.w, r.h).fill(hit.enabled ? 0x4a2b1d : 0x2c2119);
    }
    // Thin light edging around each button plate (the original's pale button outline, eyeballed).
    g.rect(r.x, r.y, r.w, r.h).stroke({ color: INNER_BOX_LIGHT, width: Math.max(1, scale) });
    if (!hit.enabled) {
      // Approximation: the original has no disabled house buttons to copy the darkening from.
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x000000, alpha: 0.22 });
    }
    // Button labels take the section-title size: the original draws both in one face (1024×768 screenshots).
    textCentered(label, r, hit.enabled ? 'white' : 'dimmed', 'title');
    if (hovered && hit.enabled && !onBitmap) {
      g.rect(r.x, r.y, r.w, r.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
  };

  const bar = (r: Rect, pct: number): void => {
    const clamped = Math.max(0, Math.min(100, pct));
    const line = Math.max(1, Math.round(scale));
    const base = rampColor(assets.barRamp, clamped);
    drawGauge(g, r, clamped, line, base, { dark: INNER_BOX_DARK, light: INNER_BOX_LIGHT });
  };

  return {
    textAt,
    textCentered,
    window: windowBox,
    headline,
    button,
    bar,
  };
}
