/**
 * The LEFT in-game tool panel — geometry, PINNED to the original.
 *
 * Every rect below is transcribed verbatim from the OpenVikings reverse-engineering of the original
 * engine — `Source/NC2InGameGuiManager/CGuiManager.cs` `Desktop_Open()`, where the toolbar strip and each
 * button is created with an `SRectangle(left, top, width, height)` in the original's 640×480–1024×768
 * DESIGN space. We keep the hex→decimal literals in a named table (the constant *is* the geometry, so this
 * satisfies the no-magic-numbers rule) and anchor the strip top-left, scaling the whole thing by an INTEGER
 * `uiscale` (default 2×, `?uiscale=` override) so it reads on an arbitrary-size canvas. The panel's INTERNAL
 * layout stays pinned — only the uniform scale is ours (logged in docs/FIDELITY.md "Left tool panel").
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

/** A rect in the original DESIGN space (pre-scale), `left/top/width/height` exactly as the engine stores it. */
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
 * Ids follow the checked-in atlas-map names; the OpenVikings decompile labels gfx 0x2f `_btnHelp` (str 1)
 * where the atlas map names 47 `options`/48 `help` — a provisional-naming discrepancy tracked in FIDELITY.
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

/** A rect placed in screen (canvas) pixels after top-left anchoring + integer scaling. */
export interface PlacedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A button spec resolved to its on-screen rect. */
export interface PlacedButton extends ToolButtonSpec {
  readonly placed: PlacedRect;
}

/** The whole panel resolved to screen space for one `uiscale`: the strip, the buttons, and the claim bounds. */
export interface ToolPanelLayout {
  /** The integer scale actually applied (`buildToolPanelLayout` floors + clamps to ≥1). */
  readonly scale: number;
  readonly stripGfx: number;
  readonly strip: PlacedRect;
  readonly buttons: readonly PlacedButton[];
  /** Width of the strip in screen px — the amount the rest of the HUD is shifted right to clear the panel. */
  readonly width: number;
  readonly height: number;
}

/**
 * The default integer UI scale. The pinned strip is 433 design px tall (nearly the original's whole
 * 480-line screen); at 1× that already fills roughly half a modern window, and 2× overflowed it — so 1×
 * is the readable default and `?uiscale=2|3` magnifies for a large display.
 */
export const DEFAULT_UI_SCALE = 1;

function scaleRect(r: DesignRect, s: number): PlacedRect {
  return { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s };
}

/**
 * Resolve the pinned design-space geometry to screen pixels at `uiscale` (floored to an integer ≥1),
 * anchored top-left. Pure — the view draws from this and the input layer hit-tests it.
 */
export function buildToolPanelLayout(uiscale: number = DEFAULT_UI_SCALE): ToolPanelLayout {
  const scale = Math.max(1, Math.floor(uiscale));
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
  };
}

function within(r: PlacedRect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** The button under the cursor (screen px), or `null`. Buttons sit inside the strip, so test them directly. */
export function hitTestToolPanel(layout: ToolPanelLayout, x: number, y: number): ToolButtonId | null {
  for (const b of layout.buttons) {
    if (within(b.placed, x, y)) return b.id;
  }
  return null;
}

/**
 * Whether a screen point lies over the panel strip at all — the claim predicate the input router asks
 * BEFORE world picking, so a click over the HUD never falls through to unit selection/orders.
 */
export function pointOverToolPanel(layout: ToolPanelLayout, x: number, y: number): boolean {
  return within(layout.strip, x, y);
}
