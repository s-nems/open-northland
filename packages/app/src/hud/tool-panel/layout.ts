import { contains, type Rect } from '../geometry.js';

/**
 * The left in-game tool panel — geometry, pinned to the original.
 *
 * Every rect below is the project's current mapping in the original's 640×480–1024×768 design space.
 * The mapping should be checked against the running original before pixel-fidelity sign-off. We keep the
 * hex→decimal literals in a named table (the constant *is* the geometry, so this
 * satisfies the no-magic-numbers rule) and anchor the strip top-left, scaling the whole thing by
 * `uiscale` (default 1.4× — see {@link DEFAULT_UI_SCALE} — with a `?uiscale=` override) so it reads on an
 * arbitrary-size canvas. The panel's internal layout stays pinned — only the uniform scale is ours
 * (logged in source basis "Left tool panel"). The scale may be fractional (the 1.4× default) — it is
 * clamped to ≥1 but not floored. The GUI art is a nearest-sampled indexed bitmap (palette indices can't
 * be linearly filtered), so drawing it straight at a fractional scale doubles some texel columns and not
 * others ("pixeloza"). To keep a fractional scale crisp, the strip+buttons are rasterized at an integer
 * oversample into an off-screen texture and linear-downscaled to the display size (`strip-texture.ts`);
 * {@link designBounds} sizes that texture. This scale knob is the single input a future in-game UI-size
 * slider would drive.
 *
 * `gfx` is the original engine gfx id, which for `ls_gui_window` equals the atlas frame id (firstBobId=0,
 * see `content/gui-atlas-map.ts`), so the view resolves the sprite with `atlas.frames.get(spec.gfx)`.
 *
 * This module is pure (no Pixi, no DOM) so the hit-test and layout are unit-tested headlessly.
 */

/** The tool buttons, identified by the checked-in atlas-map semantic name (`content/gui-atlas-map.ts`). */
export type ToolButtonId =
  | 'buildings'
  | 'extras'
  | 'mission'
  | 'diplomacy'
  | 'statistics'
  | 'population'
  | 'tech_tree'
  | 'options'
  | 'help'
  | 'speed';

/** A rect in the original design space (pre-scale), `left/top/width/height` exactly as the engine stores it. */
export interface DesignRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The left strip background element — `CBaseToolGfxElement _toolBackground`, gfx 0x33, rect (0,10,50,433). */
export const TOOL_PANEL_STRIP_GFX = 0x33;
export const TOOL_PANEL_STRIP: DesignRect = { x: 0, y: 10, w: 0x32, h: 0x1b1 };

/** One tool button: its stable id, its design-space rect, its atlas gfx id, and its `main`-table tooltip id. */
export interface ToolButtonSpec {
  readonly id: ToolButtonId;
  readonly rect: DesignRect;
  /** Atlas frame id == original engine gfx id (`ls_gui_window` firstBobId=0). */
  readonly gfx: number;
  /** String id in the ingamegui `main` table (the button's hover tooltip). */
  readonly tooltipStringId: number;
}

/**
 * The nine tool buttons plus the speed button, in the engine's creation order (see `Desktop_Open`).
 * Each `CreateToolButton(SRectangle(x,y,w,h), gfxId, stringId, msgId, …)` maps 1:1 to a row here; the msg
 * ids (0xf3c–0xf46) are the click routes and are recorded in the commit, not needed at draw/hit-test time.
 * Ids follow the checked-in atlas-map names. The `options`/`help` names for frames 47–48 remain
 * provisional and are tracked in the source-basis notes.
 */
export const TOOL_BUTTONS: readonly ToolButtonSpec[] = [
  { id: 'buildings', rect: { x: 0, y: 0x29, w: 0x28, h: 0x23 }, gfx: 0x2a, tooltipStringId: 2 },
  { id: 'extras', rect: { x: 0, y: 0x49, w: 0x28, h: 0x23 }, gfx: 0x2d, tooltipStringId: 5 },
  { id: 'mission', rect: { x: 0, y: 0x75, w: 0x28, h: 0x23 }, gfx: 0x2e, tooltipStringId: 3 },
  { id: 'diplomacy', rect: { x: 0, y: 0x97, w: 0x28, h: 0x23 }, gfx: 0x2c, tooltipStringId: 4 },
  { id: 'statistics', rect: { x: 0, y: 0xb0, w: 0x28, h: 0x23 }, gfx: 0x32, tooltipStringId: 7 },
  { id: 'population', rect: { x: 0, y: 0xcc, w: 0x28, h: 0x23 }, gfx: 0x2b, tooltipStringId: 6 },
  { id: 'tech_tree', rect: { x: 0, y: 0xee, w: 0x28, h: 0x23 }, gfx: 0x38, tooltipStringId: 8 },
  { id: 'options', rect: { x: 0, y: 0x127, w: 0x28, h: 0x23 }, gfx: 0x2f, tooltipStringId: 1 },
  { id: 'help', rect: { x: 0, y: 0x149, w: 0x28, h: 0x23 }, gfx: 0x30, tooltipStringId: 0 },
  { id: 'speed', rect: { x: 0, y: 0x175, w: 0x28, h: 0x23 }, gfx: 0x31, tooltipStringId: 0x0d },
];

/** A rect placed in screen (canvas) pixels after top-left anchoring + uniform scaling. */
export type PlacedRect = Rect;

/** A button spec resolved to its on-screen rect. */
export interface PlacedButton extends ToolButtonSpec {
  readonly placed: PlacedRect;
}

/** The whole panel resolved to screen space for one `uiscale`: the strip, the buttons, and the claim bounds. */
export interface ToolPanelLayout {
  /** The scale actually applied (`buildToolPanelLayout` clamps to ≥1; may be fractional). */
  readonly scale: number;
  readonly stripGfx: number;
  readonly strip: PlacedRect;
  readonly buttons: readonly PlacedButton[];
  /** Width of the strip in screen px — the amount the rest of the HUD is shifted right to clear the panel. */
  readonly width: number;
  readonly height: number;
  /** The strip+buttons' bounding box in design space (pre-scale). It sizes the off-screen supersample
   *  texture the crisp-scaling render pass rasterizes the panel into (see `strip-texture.ts`). */
  readonly designBounds: DesignRect;
}

/**
 * The default UI scale. The pinned strip is 433 design px tall (nearly the original's whole 480-line
 * screen); at 1× that already fills roughly half a modern window and 2× overflowed it, so 1.4× is the
 * default — comfortably larger for readability while still fitting a typical window. The fractional scale
 * stays crisp because the strip is supersampled (see the module note). `?uiscale=` overrides it (fractional
 * allowed, e.g. `?uiscale=1.2` or `?uiscale=1`).
 */
export const DEFAULT_UI_SCALE = 1.4;

function scaleRect(r: DesignRect, s: number): PlacedRect {
  return { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s };
}

/** The bounding box (design space) of a set of rects — the union that the supersample texture must cover. */
function unionDesign(rects: readonly DesignRect[]): DesignRect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Resolve the pinned design-space geometry to screen pixels at `uiscale` (clamped to ≥1; may be
 * fractional), anchored top-left. Pure — the view draws from this and the input layer hit-tests it.
 */
export function buildToolPanelLayout(uiscale: number = DEFAULT_UI_SCALE): ToolPanelLayout {
  const scale = Math.max(1, uiscale);
  const strip = scaleRect(TOOL_PANEL_STRIP, scale);
  const buttons = TOOL_BUTTONS.map((spec) => ({ ...spec, placed: scaleRect(spec.rect, scale) }));
  return {
    scale,
    stripGfx: TOOL_PANEL_STRIP_GFX,
    strip,
    buttons,
    // The claim region spans from the canvas edge to the strip's right edge (the strip starts at y=10,
    // so its right edge x = w*scale is the panel width the HUD clears).
    width: strip.x + strip.w,
    height: strip.y + strip.h,
    designBounds: unionDesign([TOOL_PANEL_STRIP, ...TOOL_BUTTONS.map((b) => b.rect)]),
  };
}

/** The button under the cursor (screen px), or `null`. Buttons sit inside the strip, so test them directly. */
export function hitTestToolPanel(layout: ToolPanelLayout, x: number, y: number): ToolButtonId | null {
  for (const b of layout.buttons) {
    if (contains(b.placed, x, y)) return b.id;
  }
  return null;
}

/**
 * Whether a screen point lies over the panel strip at all — the claim predicate the input router asks
 * before world picking, so a click over the HUD never falls through to unit selection/orders.
 */
export function pointOverToolPanel(layout: ToolPanelLayout, x: number, y: number): boolean {
  return contains(layout.strip, x, y);
}
