import { type GuiColorKey, PalettedSprite } from '@vinland/render';
import { type Application, type Container, type Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { FontColorName } from '../../content/font-gfx.js';
import { GENERIC_GOOD_ICON, makeGoodSprite } from '../../content/goods-gfx.js';
import { makeGuiSprite } from '../../content/gui-art.js';
import { GUI_FRAME } from '../../content/gui-atlas-map.js';
import { type GuiPaletteName, guiPaletteRow } from '../../content/gui-gfx.js';
import { UI_TEXT_FILL } from '../../content/ui-font.js';
import { HOVER_ALPHA, HOVER_TINT, tileBitmap, WINDOW_BORDER, WINDOW_FILL } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import type { ButtonHit } from './layout.js';
import { type BarTone, barTone } from './model.js';

/**
 * The details panel's original-art drawing kit. A `Chrome` is created per rebuild over the panel's fresh
 * layer containers and draws window fills (the original 300×300 `bg*.pcx` bitmaps, drawn TILED — our
 * choice, not decompiled behavior: OpenVikings only loads these bitmaps, their draw sites aren't ported,
 * and tiling avoids squashing the texture), the rope-and-knot window borders (edge strips TILED along
 * their length — stretching smears the rope pattern — with the knot corners at native size), headline
 * strips, buttons, bars, text, and the building preview.
 * Every piece degrades to the flat parchment Graphics look when `content/` is absent (`assets.art ===
 * null`, bitmaps `undefined`). The bitmap `Texture`s come pre-minted from `assets.ts`, so a rebuild mints
 * no bitmap-texture wrappers (they'd leak resize listeners on the shared source); the per-line Pixi `Text`
 * objects ARE minted per rebuild, but the bake disposes them (and their text textures) with the offscreen
 * root each rebuild (see `panel.ts` / `supersample.ts`).
 *
 * Text draws in the bundled vector serif (`content/ui-font.ts`, always present), NOT the original bitmap
 * `.fnt`: a larger `title` size for headlines/buttons/the building name, a `body` size for everything else.
 * Lines are placed by Pixi `Text` anchors (top-left / centred / right) rather than the bitmap face's
 * baseline metrics.
 */

/** Which of the two panel text sizes a call draws at. */
export type FontVariant = 'body' | 'title';

/**
 * The vector text sizes in NATIVE (pre-scale) px: `title` for headlines/buttons/the building name, `body`
 * for rows. Multiplied by the chrome scale (the bake oversample) at draw time. Calibrated against the
 * original's font-10 body / font-12 title cap heights, then nudged for the serif's smaller x-height.
 */
const FONT_PX: Readonly<Record<FontVariant, number>> = { body: 11, title: 13 };
/**
 * A `Text` top-anchors at its line-box top, which sits this fraction of the font size ABOVE the visible cap
 * tops (measured for Tinos: `fontBoundingBoxAscent − actualBoundingBoxAscent ≈ 0.22 em`). Top-anchored
 * placements ({@link textAt}/{@link textRight}) subtract it so a caller's `y` means the visible glyph top —
 * the same contract the old bitmap path gave via its baseline metrics, so row text keeps its `ROW_TEXT_PAD`.
 */
const CAP_TOP_RATIO = 0.22;
/**
 * A tiny vertical nudge (native px) added when centring a line in a rect: Pixi measures a `Text` by its
 * full ascent+descent line box, so the visible caps sit a hair high — this drops them to the optical centre.
 */
const CENTER_BIAS = 0.5;

/** The window-border rope strips' decoded native thickness (128×3 / 3×128 atlas rects). */
const FRAME_EDGE = 3;
/**
 * The knot corners' decoded native size — must track atlas frames 0–3 (7×7 bottom pair / 10×10 top
 * pair); if the step-3 pass reassigns those frames, update these with them.
 */
const CORNER_TOP = 10;
const CORNER_BOTTOM = 7;
/** The selected-name underline colour, sampled off the original's 1024×768 screenshots (avg #d8fb55). */
const SELECTED_LIME = 0xd8fb55;
/** Inner content-box bevel lines — eyeballed against the original's preview framing, not sampled. */
const INNER_BOX_DARK = 0x1c130b;
const INNER_BOX_LIGHT = 0x7a6244;
/** Warm wood tint of an occupied equipment slot (eyeballed, not sampled). */
const SLOT_FILL = 0x4a2b1d;
/**
 * Fallback flat gauge fills for a checkout WITHOUT `content/` (no decoded ramp): green = content,
 * orange = draining, red = nearly empty, banded by {@link barTone}. With `content/` present the fill
 * colour comes from the ORIGINAL's decoded `bar_hitpoints` level ramp instead (see `GuiBarRamp`),
 * which sweeps red→orange→yellow-green continuously.
 */
const BAR_TONE_FILL: Readonly<Record<BarTone, number>> = {
  ok: 0x4f9e3c,
  warn: 0xd08a2e,
  critical: 0xb5392b,
};

/** Where the gauge fill's vertical gradient rolls over from the lit top into the shaded bottom
 *  (fraction of the fill height). All four gauge-shading strengths are eyeballed against the
 *  parchment panel, not sampled from the original (which has no decoded bar-draw code). */
const GAUGE_GRADIENT_KNEE = 0.45;
/** How far the fill's lit top is blended toward white / the shaded bottom toward black. */
const GAUGE_TOP_LIGHTEN = 0.38;
const GAUGE_BOTTOM_DARKEN = 0.34;
/** The one-px specular line along the fill's top edge. */
const GAUGE_SPECULAR_ALPHA = 0.28;
/** How far the fill's leading-edge lip is darkened, so the gauge end reads as a surface. */
const GAUGE_LIP_DARKEN = 0.45;

/** Draw order inside the panel: flat fills, bitmap fills, frame sprites/icons, then text. */
export interface PanelLayers {
  readonly g: Graphics;
  readonly back: Container;
  readonly front: Container;
  readonly text: Container;
}

export interface Chrome {
  /** Draw a line of text with its top-left at `(x, y)`. */
  textAt(text: string, x: number, y: number, color: FontColorName, variant?: FontVariant): void;
  /** Center a line of text in `r` (both axes). `maxWidth` (in `r`'s px) shrinks an over-long line to fit
   *  the box instead of overflowing it — the seam for long personalized names in the section headline. */
  textCentered(text: string, r: Rect, color: FontColorName, variant?: FontVariant, maxWidth?: number): void;
  /** Left-anchor a line of text at `x`, vertically centred on `centerY` — a left-aligned value that must
   *  still sit on a field's centre line (the stock amount in its plate). */
  textLeftMiddle(text: string, x: number, centerY: number, color: FontColorName, variant?: FontVariant): void;
  /** Right-align a line of text's end at `rightX` (top at `y`). */
  textRight(text: string, rightX: number, y: number, color: FontColorName, variant?: FontVariant): void;
  /** Tile a `bg*.pcx` bitmap over `r`; false when the bitmap is missing (caller draws a flat fill). */
  tile(texture: Texture | undefined, r: Rect, target?: Container): boolean;
  /** A GUI-sheet sprite centered in `r` at its native size. */
  guiCentered(gfx: number, r: Rect, colorKey?: GuiColorKey, palette?: GuiPaletteName): void;
  /** A recoloured per-good resource icon (the good's `ls_goods` pile frame), fitted centered into `r`.
   *  No-op when the good has no bound icon (non-map goods) or the goods art is absent. */
  goodIcon(goodId: string, r: Rect): void;
  /** A GUI-sheet sprite stretched over `r` (bar fills, plates). */
  guiStretched(
    gfx: number,
    r: Rect,
    palette: GuiPaletteName,
    colorKey: GuiColorKey,
    target: Container,
  ): boolean;
  /** A section window: tiled wood fill + the rope-strip border with knot corners. */
  window(r: Rect): void;
  /** An inner content box (the preview): thin dark bevel frame, no rope — the original's inner framing. */
  innerBox(r: Rect): void;
  /** A round equipment-slot socket (the original's equip wells): a recessed rimmed circle, warm-tinted
   *  when `filled` (so an occupied slot reads even for a good with no bound icon), dark when empty. */
  slotSocket(r: Rect, filled: boolean): void;
  /** The rust headline strip with centered light title-size text. */
  headline(r: Rect, title: string): void;
  /** The yellow-green selected-strip under the building name line. */
  selectedUnderline(r: Rect): void;
  /** A translucent dark overlay over `r` — used to recede an inactive/greyed element (e.g. an unselected tab). */
  scrim(r: Rect, alpha: number): void;
  /** A general-section button (tiled button fill, hover/disabled states, centered label). */
  button(hit: ButtonHit, label: string, hovered: boolean): void;
  /** A category-tab plate: the tiled wooden button fill + light edge, brighter when `active` and dimmed
   *  otherwise — the frame a stock-tab's representative good icon is drawn onto (no label). */
  tabButton(r: Rect, active: boolean): void;
  /** A progress/need bar. `'progress'` (the default) is the neutral production look: the original
   *  `bar_disabled` frame filled with `bar_standart` art. `'gauge'` is a STAT GAUGE: a recessed dark
   *  track (no grey art remainder) whose fill takes the decoded `bar_hitpoints` ramp's colour at the
   *  current level (red when empty → green when full), falling back to flat {@link BAR_TONE_FILL}
   *  bands without `content/`. */
  bar(r: Rect, pct: number, style?: 'progress' | 'gauge'): void;
  /** A stock amount's recessed numeric field: a subtle dark inset on the wood (NOT the grey bar frame). */
  stockField(r: Rect): void;
  /** The selected building's own world bob, fitted into `r`; false when no preview art is bound. */
  buildingPreview(typeId: number, r: Rect): boolean;
}

export function createChrome(
  assets: DetailsPanelAssets,
  app: Application,
  scale: number,
  layers: PanelLayers,
  /**
   * The projection resolution the {@link PalettedSprite} meshes map native px into. Omitted for a direct
   * on-canvas draw (the meshes project into `app.screen`); the supersample path passes the off-screen
   * texture's size so the meshes rasterize into that target instead (see `panel.ts`).
   */
  resolution?: { readonly w: number; readonly h: number },
): Chrome {
  const { art, bitmaps } = assets;
  const { g } = layers;
  const screen = () => resolution ?? { w: app.screen.width, h: app.screen.height };
  // In texture mode (a resolution override), every PalettedSprite must render upright into the bottom-up
  // render texture so the panel can bake WITHOUT a whole-texture Y-flip its Pixi-native content (Graphics,
  // the preview Sprite) can't share. See panel.ts / PalettedSprite.flipY.
  const flipY = resolution !== undefined;

  /**
   * A placed line of vector text. The `Text` renders at `FONT_PX * scale` (so the bake's oversample keeps
   * it sharp) and is anchored per call — Pixi centres/right-aligns by its own measured bounds, so no
   * bitmap-baseline math is needed. It is Pixi-native content (like the Graphics/preview), so it bakes
   * upright with no `flipY`.
   */
  const makeText = (text: string, color: FontColorName, variant: FontVariant): Text => {
    const t = new Text({
      text,
      style: {
        fontFamily: assets.uiFont.family,
        fontSize: FONT_PX[variant] * scale,
        fill: UI_TEXT_FILL[color],
      },
    });
    layers.text.addChild(t);
    return t;
  };

  const textAt = (
    text: string,
    x: number,
    y: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0, 0);
    t.position.set(Math.round(x), Math.round(y - CAP_TOP_RATIO * FONT_PX[variant] * scale));
  };

  const textCentered = (
    text: string,
    r: Rect,
    color: FontColorName,
    variant: FontVariant = 'body',
    maxWidth?: number,
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0.5, 0.5);
    // Shrink a line that would overflow (a long patronymic name in the headline). Scaling the whole node
    // around its centre anchor keeps it centred; short lines are left at their native size.
    if (maxWidth !== undefined && t.width > maxWidth) t.scale.set(maxWidth / t.width);
    t.position.set(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2 + CENTER_BIAS * scale));
  };

  const textLeftMiddle = (
    text: string,
    x: number,
    centerY: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(0, 0.5);
    t.position.set(Math.round(x), Math.round(centerY + CENTER_BIAS * scale));
  };

  const textRight = (
    text: string,
    rightX: number,
    y: number,
    color: FontColorName,
    variant: FontVariant = 'body',
  ): void => {
    const t = makeText(text, color, variant);
    t.anchor.set(1, 0);
    t.position.set(Math.round(rightX), Math.round(y - CAP_TOP_RATIO * FONT_PX[variant] * scale));
  };

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
    made.sprite.flipY = flipY;
    layers.front.addChild(made.sprite);
    const { w, h } = screen();
    const x = Math.round(r.x + r.w / 2 - (made.frame.offsetX + made.frame.width / 2) * scale);
    const y = Math.round(r.y + r.h / 2 - (made.frame.offsetY + made.frame.height / 2) * scale);
    made.sprite.place(x, y, scale, w, h);
  };

  const goodIcon = (goodId: string, r: Rect): void => {
    if (assets.goods === null) return;
    // A good with no `ls_goods` art (potions/amulets/fruit) falls back to the neutral generic icon, so the
    // Magazyn never shows a blank slot — the same fallback the in-world dropped pile uses (goods-gfx).
    const icon = assets.goods.icon(goodId) ?? GENERIC_GOOD_ICON;
    const made = makeGoodSprite(assets.goods, icon);
    if (made === null) return;
    made.sprite.flipY = flipY;
    layers.front.addChild(made.sprite);
    const { w, h } = screen();
    // The state-1 pile frames vary in native size (~12–26 px); fit each into the icon box (shrink only,
    // never upscale past the panel scale) so a big pile doesn't overrun the amount plate — the original's
    // row icons are compact, each its own natural size.
    const fit = Math.min(1, r.w / (made.frame.width * scale), r.h / (made.frame.height * scale));
    const drawScale = scale * fit;
    const x = Math.round(r.x + r.w / 2 - (made.frame.offsetX + made.frame.width / 2) * drawScale);
    const y = Math.round(r.y + r.h / 2 - (made.frame.offsetY + made.frame.height / 2) * drawScale);
    made.sprite.place(x, y, drawScale, w, h);
  };

  const guiStretched = (
    gfx: number,
    r: Rect,
    palette: GuiPaletteName,
    colorKey: GuiColorKey,
    target: Container,
  ): boolean => {
    if (art === null) return false;
    const made = makeGuiSprite(art, gfx, { defaultPalette: palette, colorKey, palette });
    if (made === null) return false;
    made.sprite.flipY = flipY;
    target.addChild(made.sprite);
    const { w, h } = screen();
    made.sprite.stretchToRect(
      Math.round(r.x),
      Math.round(r.y),
      Math.max(1, Math.round(r.w)),
      Math.max(1, Math.round(r.h)),
      w,
      h,
    );
    return true;
  };

  /**
   * A border piece placed at an exact screen rect through the `frame` palette. Corners draw at native
   * size; edge strips pass a CLIPPED sub-frame so the rope pattern tiles instead of stretching.
   */
  const framePiece = (gfx: number, r: Rect, clipNative?: { w: number; h: number }): void => {
    if (art === null) return;
    const frame = art.layer.atlas.frames.get(gfx);
    if (frame === undefined) return;
    const sprite = new PalettedSprite(art.lut, art.colours);
    const sub =
      clipNative === undefined
        ? { ...frame, offsetX: 0, offsetY: 0 }
        : { x: frame.x, y: frame.y, width: clipNative.w, height: clipNative.h, offsetX: 0, offsetY: 0 };
    sprite.setFrame(art.layer.source, sub, art.layer.atlas.width, art.layer.atlas.height);
    sprite.player = guiPaletteRow('frame');
    sprite.colorKey = 'magenta';
    sprite.flipY = flipY;
    layers.front.addChild(sprite);
    const { w, h } = screen();
    sprite.stretchToRect(
      Math.round(r.x),
      Math.round(r.y),
      Math.max(1, Math.round(r.w)),
      Math.max(1, Math.round(r.h)),
      w,
      h,
    );
  };

  /** Tile an edge strip along its length (thickness stretches to `r`, the rope pattern repeats). */
  const frameStrip = (gfx: number, r: Rect, vertical: boolean): void => {
    if (art === null) return;
    const frame = art.layer.atlas.frames.get(gfx);
    if (frame === undefined) return;
    const stepNative = vertical ? frame.height : frame.width;
    const len = vertical ? r.h : r.w;
    let covered = 0;
    while (covered < len) {
      const remainNative = Math.min(stepNative, Math.max(1, Math.ceil((len - covered) / scale)));
      const pieceLen = Math.min(remainNative * scale, len - covered);
      framePiece(
        gfx,
        vertical
          ? { x: r.x, y: r.y + covered, w: r.w, h: pieceLen }
          : { x: r.x + covered, y: r.y, w: pieceLen, h: r.h },
        vertical ? { w: frame.width, h: remainNative } : { w: remainNative, h: frame.height },
      );
      covered += pieceLen;
    }
  };

  /**
   * The rope-and-knot window border. Frame ids: rope strips 5–8, knot corners 0–3 (10×10 top pair,
   * 7×7 bottom pair) — corner placement and strip orientation are montage-calibrated guesses pending
   * the plan's step-3 human pass over the sheet.
   */
  const frameBorder = (r: Rect): void => {
    const e = Math.max(1, Math.round(FRAME_EDGE * scale));
    const ct = Math.round(CORNER_TOP * scale);
    const cb = Math.round(CORNER_BOTTOM * scale);
    frameStrip(GUI_FRAME.window_border_top, { x: r.x + ct, y: r.y, w: r.w - ct * 2, h: e }, false);
    frameStrip(
      GUI_FRAME.window_border_bottom,
      { x: r.x + cb, y: r.y + r.h - e, w: r.w - cb * 2, h: e },
      false,
    );
    frameStrip(GUI_FRAME.window_border_left, { x: r.x, y: r.y + ct, w: e, h: r.h - ct - cb }, true);
    frameStrip(
      GUI_FRAME.window_border_right,
      { x: r.x + r.w - e, y: r.y + ct, w: e, h: r.h - ct - cb },
      true,
    );
    framePiece(GUI_FRAME.knot_corner_tl, { x: r.x, y: r.y, w: ct, h: ct });
    framePiece(GUI_FRAME.knot_corner_tr, { x: r.x + r.w - ct, y: r.y, w: ct, h: ct });
    framePiece(GUI_FRAME.knot_corner_bl, { x: r.x, y: r.y + r.h - cb, w: cb, h: cb });
    framePiece(GUI_FRAME.knot_corner_br, { x: r.x + r.w - cb, y: r.y + r.h - cb, w: cb, h: cb });
  };

  // Named to avoid shadowing the global `window` inside this closure.
  const windowBox = (r: Rect): void => {
    if (!tile(bitmaps.bg, r)) {
      g.rect(r.x, r.y, r.w, r.h).fill(WINDOW_FILL);
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
    // A round recessed well like the original's equip sockets: a warm wood tint marks an occupied slot
    // (so it reads even when the good has no bound icon), a dark inset an empty one, rimmed with the same
    // dark/light bevel the inner box uses.
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

  const headline = (r: Rect, title: string): void => {
    const inset = Math.max(1, Math.round(scale));
    const strip: Rect = { x: r.x + inset, y: r.y + inset, w: r.w - 2 * inset, h: r.h - inset };
    if (!tile(bitmaps.headline, strip)) {
      g.rect(strip.x, strip.y, strip.w, strip.h).fill({ color: 0x2d1d13, alpha: 0.72 });
    }
    // Dark edging under the strip separates it from the wood body (the original's outlined title bar).
    g.rect(strip.x, strip.y, strip.w, strip.h).stroke({ color: INNER_BOX_DARK, width: inset });
    // Light (gold-cream) centered title-size text on the rust headline strip — the original's title look.
    // Fit to the strip so a long personalized name (first + patronymic) shrinks rather than overflowing.
    textCentered(title, strip, 'white', 'title', strip.w - 2 * inset);
  };

  const selectedUnderline = (r: Rect): void => {
    // Flat lime strip — colour sampled off the 1024×768 original's name underline (avg #d8fb55);
    // no shipped bitmap/palette pairing reproduces it (`bg_selected` expands grey through every palette).
    g.rect(r.x, r.y, r.w, r.h).fill(SELECTED_LIME);
  };

  const scrim = (r: Rect, alpha: number): void => {
    g.rect(r.x, r.y, r.w, r.h).fill({ color: INNER_BOX_DARK, alpha });
  };

  const button = (hit: ButtonHit, label: string, hovered: boolean): void => {
    const r = hit.rect;
    const fill = hovered && hit.enabled ? bitmaps.buttonHilite : hit.enabled ? bitmaps.button : bitmaps.bg;
    const onBitmap = tile(fill, r);
    if (!onBitmap) {
      g.rect(r.x, r.y, r.w, r.h).fill(hit.enabled ? 0x4a2b1d : 0x2c2119);
    }
    // Thin light edging around each button plate (the original's pale button outline, eyeballed).
    g.rect(r.x, r.y, r.w, r.h).stroke({ color: INNER_BOX_LIGHT, width: Math.max(1, scale) });
    if (!hit.enabled) {
      // Inert-button darkening strength is our own choice — the original has no disabled house buttons.
      g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x000000, alpha: 0.22 });
    }
    // Gold-cream title-size label on the dark button tile — the original's button labels use the same
    // letterspaced caps face as the section titles (1024×768 screenshots); greyed when inert.
    textCentered(label, r, hit.enabled ? 'white' : 'dimmed', 'title');
    if (hovered && hit.enabled && !onBitmap) {
      g.rect(r.x, r.y, r.w, r.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
  };

  const tabButton = (r: Rect, active: boolean): void => {
    // The same wooden tile the section buttons use — brighter (hilite) when active — so a tab reads as a
    // raised button, not a flat grey plate. A thin top-left highlight + bottom-right shadow give it a small
    // bevel; the active tab also gets the drawer's green underline, so no heavy dark scrim is needed.
    const fill = active ? bitmaps.buttonHilite : bitmaps.button;
    if (!tile(fill, r)) g.rect(r.x, r.y, r.w, r.h).fill(active ? 0x6b4426 : 0x4a3320);
    const line = Math.max(1, Math.round(scale));
    g.rect(r.x, r.y, r.w - line, line).fill({ color: INNER_BOX_LIGHT, alpha: 0.9 }); // top bevel
    g.rect(r.x, r.y, line, r.h - line).fill({ color: INNER_BOX_LIGHT, alpha: 0.9 }); // left bevel
    g.rect(r.x, r.y + r.h - line, r.w, line).fill({ color: 0x000000, alpha: 0.4 }); // bottom shadow
    g.rect(r.x + r.w - line, r.y, line, r.h).fill({ color: 0x000000, alpha: 0.4 }); // right shadow
    if (!active) g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x000000, alpha: 0.12 });
  };

  /** The gauge fill colour at `clamped` (0..100): the decoded ramp's entry at the level index, else the
   *  flat banded fallback (no `content/`). */
  const rampColor = (clamped: number): number => {
    const colors = assets.barRamp;
    if (colors === undefined || colors.length === 0) return BAR_TONE_FILL[barTone(clamped)];
    const index = Math.min(colors.length - 1, Math.round((clamped / 100) * (colors.length - 1)));
    return colors[index] ?? BAR_TONE_FILL[barTone(clamped)];
  };

  /** Blend `from` toward `to` by `t` (0..1), per RGB channel — the gauge's gradient math. */
  const mixColor = (from: number, to: number, t: number): number => {
    const ch = (shift: number): number => {
      const a = (from >> shift) & 0xff;
      const b = (to >> shift) & 0xff;
      return Math.round(a + (b - a) * t) << shift;
    };
    return ch(16) | ch(8) | ch(0);
  };

  /**
   * A STAT GAUGE (not the grey `bar_disabled` art, whose middle read as a stuck bar — user feedback
   * 2026-07-11). Drawn entirely as Graphics (the PalettedSprite art can't be tinted per-sprite — see
   * paletted-sprite.ts): a recessed near-black groove with an inner top shadow and an embossed light
   * catch under its lip, filled by a smooth vertical gradient of the decoded ramp's level colour
   * (1-px strips — no gradient textures to leak on the panel's 4 Hz rebuilds).
   */
  const drawGauge = (r: Rect, clamped: number, line: number): void => {
    const base = rampColor(clamped);
    // Track groove: solid dark body, a crisp dark outline, an inner top shadow (inset illusion), and a
    // one-px parchment light catch just under the bottom edge (the emboss the wood around it casts).
    g.rect(r.x, r.y, r.w, r.h).fill(0x160f09);
    g.rect(r.x, r.y, r.w, r.h).stroke({ color: INNER_BOX_DARK, width: line });
    g.rect(r.x + line, r.y + line, r.w - 2 * line, line).fill({ color: 0x000000, alpha: 0.45 });
    g.rect(r.x, r.y + r.h, r.w, line).fill({ color: INNER_BOX_LIGHT, alpha: 0.35 });

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
  };

  const bar = (r: Rect, pct: number, style: 'progress' | 'gauge' = 'progress'): void => {
    const clamped = Math.max(0, Math.min(100, pct));
    const line = Math.max(1, Math.round(scale));
    if (style === 'gauge') {
      drawGauge(r, clamped, line);
      return;
    }
    // Neutral progress (production): the original bar frame + art fill, flat Graphics without art.
    if (art === null) {
      g.rect(r.x, r.y, r.w, r.h).fill(0x18120d).stroke({ color: 0x5f4a32, width: 1 });
      const inner = Math.max(0, Math.round((r.w - 2) * (clamped / 100)));
      if (inner > 0) g.rect(r.x + 1, r.y + 1, inner, Math.max(1, r.h - 2)).fill(0xb8894a);
      return;
    }
    guiStretched(GUI_FRAME.bar_frame_96, r, 'bar_disabled', 'magenta', layers.back);
    const innerW = Math.max(0, Math.round((r.w - line * 2) * (clamped / 100)));
    if (innerW > 0) {
      guiStretched(
        GUI_FRAME.bar_frame_96,
        { x: r.x + line, y: r.y + line, w: innerW, h: Math.max(1, r.h - line * 2) },
        'bar_standart',
        'magenta',
        layers.front,
      );
    }
  };

  /**
   * A stock amount's numeric field: a subtle recessed slot on the wood, drawn as flat Graphics rather than
   * the grey `bar_disabled` frame (which read as an ugly opaque plate). A dark translucent fill lets the
   * wood show through, with a thin dark top/left + light bottom/right bevel for the inset look — the
   * original's amounts sit in a shallow recessed field, not on a solid grey bar.
   */
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
    textAt,
    textCentered,
    textLeftMiddle,
    textRight,
    tile,
    guiCentered,
    goodIcon,
    guiStretched,
    window: windowBox,
    innerBox,
    slotSocket,
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
