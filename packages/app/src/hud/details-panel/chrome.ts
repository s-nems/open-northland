import type { GuiColorKey } from '@open-northland/render';
import { type Application, type Container, type Graphics, Sprite, type Texture } from 'pixi.js';
import type { FontColorName } from '../../content/font-gfx.js';
import { GENERIC_GOOD_ICON, type GoodIcon, makeGoodSprite } from '../../content/goods-gfx.js';
import { makeGuiSprite } from '../../content/gui-art.js';
import type { GuiPaletteName } from '../../content/gui-gfx.js';
import { HOVER_ALPHA, HOVER_TINT, tileBitmap, WINDOW_BORDER } from '../chrome.js';
import type { Rect } from '../geometry.js';
import type { DetailsPanelAssets } from './assets.js';
import { createFrameBorderKit } from './frame-border.js';
import { drawGauge, PRODUCTION_BAR_FILL, rampColor } from './gauge.js';
import { createTextKit, type FontVariant } from './text.js';

/**
 * The details panel's original-art drawing kit. A `Chrome` is created per rebuild over the panel's fresh
 * layer containers and draws window fills (the original 300×300 `bg*.pcx` bitmaps, tiled as an
 * OpenNorthland composition choice to avoid squashing the texture), the rope-and-knot window borders (edge strips tiled along
 * their length — stretching smears the rope pattern — with the knot corners at native size), headline
 * strips, buttons, bars, text, and the building preview.
 * Every piece degrades to the flat parchment Graphics look when `content/` is absent (`assets.art ===
 * null`, bitmaps `undefined`). The bitmap `Texture`s come pre-minted from `assets.ts`, so a rebuild mints
 * no bitmap-texture wrappers (they'd leak resize listeners on the shared source); the per-line Pixi `Text`
 * objects are minted per rebuild, but the bake disposes them (and their text textures) with the offscreen
 * root each rebuild (see `panel.ts` / `supersample.ts`).
 *
 * Text draws in the bundled vector serif (`content/ui-font.ts`, always present), not the original bitmap
 * `.fnt`: a larger `title` size for headlines/buttons/the building name, a `body` size for everything else.
 * Lines are placed by Pixi `Text` anchors (top-left / centred / right) rather than the bitmap face's
 * baseline metrics.
 */

/** The selected-name underline colour, sampled off the original's 1024×768 screenshots (avg #d8fb55). */
const SELECTED_LIME = 0xd8fb55;
/** Inner content-box bevel lines — eyeballed against the original's preview framing, not sampled. */
const INNER_BOX_DARK = 0x1c130b;
const INNER_BOX_LIGHT = 0x7a6244;
/** Flat fallback for the section card body without `content/`: the grey-blue the `bg_selected` marble
 *  averages to through the `bg_normal` element palette (decoded #3c4043), so a bare checkout still reads
 *  as the original's cool selected-card body rather than the warm brown of the shared window fill. */
const CARD_FILL = 0x3c4043;
/** Warm wood tint of an occupied equipment slot (eyeballed, not sampled). */
const SLOT_FILL = 0x4a2b1d;
/** Round-button wood fills — the same warm-wood/brighter-wood pairing the rectangular button and tab
 *  plates use as their no-bitmap fallback, so the round gather/assign controls read as the same material. */
const ROUND_BUTTON_FILL = 0x4a2b1d;
const ROUND_BUTTON_ACTIVE_FILL = 0x6b4426;
/** Cream tones of the assign glyph — lit vs. dimmed, matching the button label's gold-cream / grey pair. */
const GLYPH_LIGHT = 0xead9a0;
const GLYPH_DIM = 0x8b7a55;
/** The four good tones of the "Wszystko" (gather-everything) tile — stone / wood / gold / herb — so it
 *  reads as a mix, distinct from any single good's pile. */
const ALL_GLYPH_TILES = [0xb8b0a0, 0x9a6a34, 0xe0b455, 0x7f9a2a] as const;

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
  /** A 2×2 grid of mixed-good tiles centered in `r` — the "gather everything" round button's face, drawn
   *  distinct from any single good's pile so it never reads as one specific good. */
  glyphAll(r: Rect): void;
  /** A section window: the tiled grey-blue card fill + the rope-strip border with knot corners. */
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
  button(hit: { readonly rect: Rect; readonly enabled: boolean }, label: string, hovered: boolean): void;
  /** A small round wooden button (the gather-choice / assign-workplace controls): a warm-wood disc with a
   *  raised rim, brightened when `active` (hovered or selected) and darkened when disabled. The caller
   *  overlays the face (a good icon / the assign glyph) centered in `r`. */
  roundButton(r: Rect, enabled: boolean, active: boolean): void;
  /** A small house glyph centered in `r` — the assign-workplace round button's face (assign this settler
   *  to a building); `enabled` picks the lit vs. dimmed cream. */
  glyphHouse(r: Rect, enabled: boolean): void;
  /** A category-tab plate: the tiled wooden button fill + light edge, brighter when `active` and dimmed
   *  otherwise — the frame a stock-tab's representative good icon is drawn onto (no label). */
  tabButton(r: Rect, active: boolean): void;
  /** A progress/need bar. `'progress'` (the default) is the neutral production look: the original
   *  `bar_disabled` frame filled with `bar_standart` art. `'gauge'` is a stat gauge: a recessed dark
   *  track (no grey art remainder) whose fill takes the decoded `bar_hitpoints` ramp's colour at the
   *  current level (red when empty → green when full), falling back to flat {@link BAR_TONE_FILL}
   *  bands without `content/`. */
  bar(r: Rect, pct: number, style?: 'progress' | 'gauge'): void;
  /** A stock amount's recessed numeric field: a subtle dark inset on the wood (not the grey bar frame). */
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
  // render texture so the panel can bake without a whole-texture Y-flip its Pixi-native content (Graphics,
  // the preview Sprite) can't share. See panel.ts / PalettedSprite.flipY.
  const flipY = resolution !== undefined;

  // The vector-text placement primitives (`text.ts`) over the panel's text layer, and the rope-and-knot
  // window border (`frame-border.ts`) over its front sprite layer — the two self-contained sub-concerns
  // of this kit. Headlines/buttons place text through the former; the window fill draws the latter.
  const { textAt, textCentered, textLeftMiddle, textRight } = createTextKit(
    layers.text,
    assets.uiFont.family,
    scale,
  );
  const { frameBorder } = createFrameBorderKit({ art, front: layers.front, scale, flipY, screen });

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

  const placeGoodIcon = (icon: GoodIcon, r: Rect): void => {
    if (assets.goods === null) return;
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

  // A good with no `ls_goods` art (potions/amulets/fruit) falls back to the neutral generic icon, so the
  // Magazyn never shows a blank slot — the same fallback the in-world dropped pile uses (goods-gfx).
  const goodIcon = (goodId: string, r: Rect): void =>
    placeGoodIcon(assets.goods?.icon(goodId) ?? GENERIC_GOOD_ICON, r);

  const glyphAll = (r: Rect): void => {
    const cell = Math.max(2, Math.round(r.w * 0.34));
    const gap = Math.max(1, Math.round(r.w * 0.12));
    const block = cell * 2 + gap;
    const x0 = Math.round(r.x + (r.w - block) / 2);
    const y0 = Math.round(r.y + (r.h - block) / 2);
    const line = Math.max(1, Math.round(scale));
    // Four distinct good tones (stone / wood / gold / herb) so the tile reads as "a mix of everything",
    // never as one specific good.
    ALL_GLYPH_TILES.forEach((color, i) => {
      const tx = x0 + (i % 2) * (cell + gap);
      const ty = y0 + Math.floor(i / 2) * (cell + gap);
      g.rect(tx, ty, cell, cell).fill(color);
      g.rect(tx, ty, cell, cell).stroke({ color: INNER_BOX_DARK, width: line, alpha: 0.6 });
    });
  };

  // Named to avoid shadowing the global `window` inside this closure. The body tiles the grey-blue
  // `card` fill (the original's selected-item card), not the warm brown `bg` — that stays the button
  // plates' disabled fallback; only the headline strips above the cards keep the warm brown.
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

  const glyphHouse = (r: Rect, enabled: boolean): void => {
    const color = enabled ? GLYPH_LIGHT : GLYPH_DIM;
    const cx = r.x + r.w / 2;
    const pad = r.w * 0.28;
    const x0 = r.x + pad;
    const x1 = r.x + r.w - pad;
    const y0 = r.y + pad;
    const y1 = r.y + r.h - pad;
    const eaveY = y0 + (y1 - y0) * 0.42;
    const wallW = x1 - x0;
    // Roof gable, then the wall box, then a punched door in the plate's dark tone.
    g.moveTo(x0, eaveY).lineTo(cx, y0).lineTo(x1, eaveY).closePath().fill(color);
    g.rect(x0 + wallW * 0.12, eaveY, wallW * 0.76, y1 - eaveY).fill(color);
    g.rect(cx - wallW * 0.11, y1 - (y1 - eaveY) * 0.55, wallW * 0.22, (y1 - eaveY) * 0.55).fill({
      color: INNER_BOX_DARK,
      alpha: 0.85,
    });
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
    // Flat Graphics, not a bitmap: no shipped bitmap/palette pairing reproduces this lime (`bg_selected`,
    // the card body, only ever expands to grey/grey-blue, and the other fills to browns/creams).
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

  const bar = (r: Rect, pct: number, style: 'progress' | 'gauge' = 'progress'): void => {
    const clamped = Math.max(0, Math.min(100, pct));
    const line = Math.max(1, Math.round(scale));
    // Both styles share the recessed-groove draw; only the fill colour differs — the stat gauge sweeps
    // the decoded level ramp (red→green), the neutral production bar keeps a fixed warm amber.
    const base = style === 'gauge' ? rampColor(assets.barRamp, clamped) : PRODUCTION_BAR_FILL;
    drawGauge(g, r, clamped, line, base, { dark: INNER_BOX_DARK, light: INNER_BOX_LIGHT });
  };

  /**
   * A stock amount's numeric field: a subtle recessed slot on the wood, drawn as flat Graphics rather than
   * the grey `bar_disabled` frame (which read as an opaque plate). A dark translucent fill lets the wood
   * show through, with a thin dark top/left + light bottom/right bevel for the inset look.
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
    glyphAll,
    window: windowBox,
    innerBox,
    slotSocket,
    roundButton,
    glyphHouse,
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
