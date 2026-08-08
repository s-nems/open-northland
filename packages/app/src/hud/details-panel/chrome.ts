import type { GuiColorKey } from '@open-northland/render';
import { type Container, type Graphics, Sprite, type Texture } from 'pixi.js';
import { GENERIC_GOOD_ICON, type GoodIcon, makeGoodSprite } from '../../content/goods-gfx.js';
import { makeGuiSprite } from '../../content/gui-art.js';
import type { GuiPaletteName } from '../../content/gui-gfx.js';
import { HOVER_ALPHA, HOVER_TINT, tileBitmap, WINDOW_BORDER } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import { createFrameBorderKit } from './frame-border.js';
import { drawGauge, PRODUCTION_BAR_FILL, rampColor } from './gauge.js';
import { createGlyphKit, type GlyphKit } from './glyphs.js';
import { createTextKit, type TextKit } from './text.js';

/**
 * The details panel's original-art drawing kit, created per rebuild over that rebuild's layer containers.
 * Every piece degrades to a flat parchment Graphics look when `content/` is absent.
 */

/** The selected-row underline colour, sampled off the original's 1024×768 screenshots (avg #d8fb55). */
const SELECTED_LIME = 0xd8fb55;
/** Inner content-box bevel lines - eyeballed against the original's preview framing, not sampled. */
const INNER_BOX_DARK = 0x1c130b;
const INNER_BOX_LIGHT = 0x7a6244;
/** Flat fallback for the section card body without `content/`: the grey-blue the `bg_selected` marble
 *  averages to through the `bg_normal` element palette (decoded #3c4043). */
const CARD_FILL = 0x3c4043;
/** Warm wood tint of an occupied equipment slot (eyeballed, not sampled). */
const SLOT_FILL = 0x4a2b1d;
/** Round-button wood fills, matching the rectangular button and tab plates' no-bitmap fallback. */
const ROUND_BUTTON_FILL = 0x4a2b1d;
const ROUND_BUTTON_ACTIVE_FILL = 0x6b4426;

/** The panel's draw layers, back to front: `back` bitmap fills, `g` flat fills and glyph shapes,
 *  `front` sprites and icons, `text`. */
export interface PanelLayers {
  readonly g: Graphics;
  readonly back: Container;
  readonly front: Container;
  readonly text: Container;
}

export interface Chrome extends TextKit, GlyphKit {
  /** Tile a `bg*.pcx` bitmap over `r`; false when the bitmap is missing (caller draws a flat fill). */
  tile(texture: Texture | undefined, r: Rect, target?: Container): boolean;
  /** A GUI-sheet sprite centered in `r` at its native size. */
  guiCentered(gfx: number, r: Rect, colorKey?: GuiColorKey, palette?: GuiPaletteName): void;
  /** A recoloured per-good resource icon (the good's `ls_goods` pile frame), fitted centered into `r`;
   *  a good with no bound icon draws the generic one, and no-op when the goods art is absent. */
  goodIcon(goodId: string, r: Rect): void;
  /** A section window: the tiled grey-blue card fill + the rope-strip border with knot corners. */
  window(r: Rect): void;
  /** An inner content box (the preview): thin dark bevel frame, no rope - the original's inner framing. */
  innerBox(r: Rect): void;
  /** A round equipment-slot socket: a recessed rimmed circle, warm-tinted when `filled`, dark when empty. */
  slotSocket(r: Rect, filled: boolean): void;
  /** The rust headline strip with centered light title-size text. */
  headline(r: Rect, title: string): void;
  /** The original's yellow-green strip marking a selected row. */
  selectedUnderline(r: Rect): void;
  /** A translucent dark overlay over `r`, receding an inactive or greyed element. */
  scrim(r: Rect, alpha: number): void;
  /** A general-section button (tiled button fill, hover/disabled states, centered label). */
  button(hit: { readonly rect: Rect; readonly enabled: boolean }, label: string, hovered: boolean): void;
  /** A small round wooden button, brightened when `active` and darkened when disabled; the caller
   *  overlays the face centered in `r`. */
  roundButton(r: Rect, enabled: boolean, active: boolean): void;
  /** A category-tab plate: the tiled wooden button fill, brighter when `active`; the caller draws the
   *  tab's representative good icon onto it. */
  tabButton(r: Rect, active: boolean): void;
  /** A progress/need bar. `'progress'` is the neutral production look; `'gauge'` takes its fill colour
   *  from the decoded `bar_hitpoints` ramp at the current level. */
  bar(r: Rect, pct: number, style?: 'progress' | 'gauge'): void;
  /** A stock amount's recessed numeric field: a subtle dark inset on the wood. */
  stockField(r: Rect): void;
  /** The selected building's own world bob, fitted into `r`; false when no preview art is bound. */
  buildingPreview(typeId: number, r: Rect): boolean;
}

export function createChrome(
  assets: DetailsPanelAssets,
  scale: number,
  layers: PanelLayers,
  /**
   * The off-screen bake texture's size, which the `PalettedSprite` meshes project native px into. Every
   * mesh renders upright (`flipY`) so the panel bakes without a whole-texture Y-flip, which its
   * Pixi-native content (Graphics, the preview Sprite) could not share.
   */
  resolution: { readonly w: number; readonly h: number },
): Chrome {
  const { art, bitmaps } = assets;
  const { g } = layers;

  const { textAt, textCentered, textLeftMiddle, textRight } = createTextKit(
    layers.text,
    assets.uiFont.family,
    scale,
  );
  const { frameBorder } = createFrameBorderKit({ art, front: layers.front, scale, resolution });
  const glyphs = createGlyphKit({ g, scale, bevelDark: INNER_BOX_DARK });

  const tile = (texture: Texture | undefined, r: Rect, target: Container = layers.back): boolean =>
    tileBitmap(target, texture, r, scale);

  const guiCentered = (
    gfx: number,
    r: Rect,
    colorKey: GuiColorKey = 'magenta',
    palette?: GuiPaletteName,
  ): void => {
    if (art === null) return;
    const made =
      palette === undefined
        ? makeGuiSprite(art, gfx, { defaultPalette: 'context', colorKey })
        : makeGuiSprite(art, gfx, { defaultPalette: palette, colorKey, palette });
    if (made === null) return;
    made.sprite.flipY = true;
    layers.front.addChild(made.sprite);
    const { w, h } = resolution;
    const x = Math.round(r.x + r.w / 2 - (made.frame.offsetX + made.frame.width / 2) * scale);
    const y = Math.round(r.y + r.h / 2 - (made.frame.offsetY + made.frame.height / 2) * scale);
    made.sprite.place(x, y, scale, w, h);
  };

  const placeGoodIcon = (icon: GoodIcon, r: Rect): void => {
    if (assets.goods === null) return;
    const made = makeGoodSprite(assets.goods, icon);
    if (made === null) return;
    made.sprite.flipY = true;
    layers.front.addChild(made.sprite);
    const { w, h } = resolution;
    // The state-1 pile frames vary in native size (~12-26 px); shrink each into the icon box, never
    // upscaling past the panel scale, so a big pile doesn't overrun the amount plate.
    const fit = Math.min(1, r.w / (made.frame.width * scale), r.h / (made.frame.height * scale));
    const drawScale = scale * fit;
    const x = Math.round(r.x + r.w / 2 - (made.frame.offsetX + made.frame.width / 2) * drawScale);
    const y = Math.round(r.y + r.h / 2 - (made.frame.offsetY + made.frame.height / 2) * drawScale);
    made.sprite.place(x, y, drawScale, w, h);
  };

  const goodIcon = (goodId: string, r: Rect): void =>
    placeGoodIcon(assets.goods?.icon(goodId) ?? GENERIC_GOOD_ICON, r);

  // Named to avoid shadowing the global `window` inside this closure.
  const windowBox = (r: Rect): void => {
    if (!tile(bitmaps.card, r)) {
      g.rect(r.x, r.y, r.w, r.h).fill(CARD_FILL);
    }
    if (art !== null) frameBorder(r);
    else g.rect(r.x, r.y, r.w, r.h).stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });
  };

  const innerBox = (r: Rect): void => {
    const line = Math.max(1, Math.round(scale));
    g.rect(r.x, r.y, r.w, r.h).stroke({ color: INNER_BOX_DARK, width: line });
    g.rect(r.x + line, r.y + line, r.w - 2 * line, r.h - 2 * line).stroke({
      color: INNER_BOX_LIGHT,
      width: line,
    });
  };

  const slotSocket = (r: Rect, filled: boolean): void => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rad = Math.min(r.w, r.h) / 2;
    const line = Math.max(1, Math.round(scale));
    g.circle(cx, cy, rad).fill(
      filled ? { color: SLOT_FILL, alpha: 0.85 } : { color: INNER_BOX_DARK, alpha: 0.55 },
    );
    g.circle(cx, cy, rad).stroke({ color: INNER_BOX_DARK, width: line });
    g.circle(cx, cy, Math.max(1, rad - line)).stroke({ color: INNER_BOX_LIGHT, width: line, alpha: 0.7 });
  };

  const roundButton = (r: Rect, enabled: boolean, active: boolean): void => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const rad = Math.min(r.w, r.h) / 2;
    const line = Math.max(1, Math.round(scale));
    const fill = active && enabled ? ROUND_BUTTON_ACTIVE_FILL : ROUND_BUTTON_FILL;
    g.circle(cx, cy, rad).fill({ color: fill, alpha: enabled ? 0.95 : 0.5 });
    g.circle(cx, cy, rad).stroke({ color: INNER_BOX_DARK, width: line });
    // A brighter inner rim reads the disc as raised (a button), not recessed (the equip well).
    g.circle(cx, cy, Math.max(1, rad - line)).stroke({ color: INNER_BOX_LIGHT, width: line, alpha: 0.9 });
    if (!enabled) g.circle(cx, cy, rad).fill({ color: 0x000000, alpha: 0.28 });
    else if (active) g.circle(cx, cy, rad).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
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

  const selectedUnderline = (r: Rect): void => {
    // Flat Graphics, not a bitmap: no shipped bitmap/palette pairing reproduces this lime.
    g.rect(r.x, r.y, r.w, r.h).fill(SELECTED_LIME);
  };

  const scrim = (r: Rect, alpha: number): void => {
    g.rect(r.x, r.y, r.w, r.h).fill({ color: INNER_BOX_DARK, alpha });
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

  const tabButton = (r: Rect, active: boolean): void => {
    // The same wooden tile the section buttons use, so a tab reads as a raised button, not a flat plate.
    const fill = active ? bitmaps.buttonHilite : bitmaps.button;
    if (!tile(fill, r)) g.rect(r.x, r.y, r.w, r.h).fill(active ? 0x6b4426 : 0x4a3320);
    const line = Math.max(1, Math.round(scale));
    g.rect(r.x, r.y, r.w - line, line).fill({ color: INNER_BOX_LIGHT, alpha: 0.9 }); // top bevel
    g.rect(r.x, r.y, line, r.h - line).fill({ color: INNER_BOX_LIGHT, alpha: 0.9 }); // left bevel
    g.rect(r.x, r.y + r.h - line, r.w, line).fill({ color: 0x000000, alpha: 0.4 }); // bottom shadow
    g.rect(r.x + r.w - line, r.y, line, r.h).fill({ color: 0x000000, alpha: 0.4 }); // right shadow
    if (!active) g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x000000, alpha: 0.12 });
  };

  const bar = (r: Rect, pct: number, style: 'progress' | 'gauge' = 'progress'): void => {
    const clamped = Math.max(0, Math.min(100, pct));
    const line = Math.max(1, Math.round(scale));
    const base = style === 'gauge' ? rampColor(assets.barRamp, clamped) : PRODUCTION_BAR_FILL;
    drawGauge(g, r, clamped, line, base, { dark: INNER_BOX_DARK, light: INNER_BOX_LIGHT });
  };

  /** Flat Graphics rather than the grey `bar_disabled` frame, which reads as an opaque plate. */
  const stockField = (r: Rect): void => {
    const line = Math.max(1, Math.round(scale));
    g.rect(r.x, r.y, r.w, r.h).fill({ color: INNER_BOX_DARK, alpha: 0.42 });
    g.moveTo(r.x, r.y + r.h)
      .lineTo(r.x, r.y)
      .lineTo(r.x + r.w, r.y)
      .stroke({ color: INNER_BOX_DARK, width: line, alpha: 0.7 });
    g.moveTo(r.x + r.w, r.y)
      .lineTo(r.x + r.w, r.y + r.h)
      .lineTo(r.x, r.y + r.h)
      .stroke({ color: INNER_BOX_LIGHT, width: line, alpha: 0.5 });
  };

  const buildingPreview = (typeId: number, r: Rect): boolean => {
    const preview = assets.previews.get(typeId);
    if (preview === undefined) return false;
    const sprite = new Sprite(preview.texture);
    const fit = Math.min(r.w / preview.width, r.h / preview.height);
    sprite.width = Math.max(1, Math.round(preview.width * fit));
    sprite.height = Math.max(1, Math.round(preview.height * fit));
    sprite.position.set(
      Math.round(r.x + (r.w - sprite.width) / 2),
      Math.round(r.y + (r.h - sprite.height) / 2),
    );
    layers.front.addChild(sprite);
    return true;
  };

  return {
    ...glyphs,
    textAt,
    textCentered,
    textLeftMiddle,
    textRight,
    tile,
    guiCentered,
    goodIcon,
    window: windowBox,
    innerBox,
    slotSocket,
    roundButton,
    headline,
    selectedUnderline,
    scrim,
    button,
    tabButton,
    bar,
    stockField,
    buildingPreview,
  };
}
