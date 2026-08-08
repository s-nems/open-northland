import { contains, type Rect } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';

/**
 * The left in-game tool panel's geometry, pinned to the original.
 *
 * Every rect below maps into the original's 640×480–1024×768 design space, provisional until checked
 * against the running original. The strip anchors top-left and scales by `uiscale`, floored at
 * `MIN_UI_SCALE` and fractional-allowed. `gfx` is the original engine gfx id, which for
 * `ls_gui_window` equals the atlas frame id (firstBobId=0).
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

/** The left strip background element - `CBaseToolGfxElement _toolBackground`, gfx 0x33, rect (0,10,50,433). */
const TOOL_PANEL_STRIP_GFX = 0x33;
export const TOOL_PANEL_STRIP: DesignRect = { x: 0, y: 10, w: 0x32, h: 0x1b1 };

export interface ToolButtonSpec {
  readonly id: ToolButtonId;
  readonly rect: DesignRect;
  /** Atlas frame id == original engine gfx id (`ls_gui_window` firstBobId=0). */
  readonly gfx: number;
  /** String id in the ingamegui `main` table (the button's hover tooltip). */
  readonly tooltipStringId: number;
}

/**
 * The nine tool buttons plus the speed button, in the engine's creation order (`Desktop_Open`), one row
 * per `CreateToolButton(SRectangle(x,y,w,h), gfxId, stringId, msgId, …)` call. The `options` and `help`
 * names for frames 47–48 remain provisional.
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

export interface PlacedButton extends ToolButtonSpec {
  readonly placed: PlacedRect;
}

export interface ToolPanelLayout {
  /** The scale actually applied: floored at `MIN_UI_SCALE`, may be fractional. */
  readonly scale: number;
  readonly stripGfx: number;
  readonly strip: PlacedRect;
  readonly buttons: readonly PlacedButton[];
  /** Width of the strip in screen px, which the rest of the HUD is shifted right by. */
  readonly width: number;
  readonly height: number;
  /** The strip and buttons' bounding box in design space; it sizes the off-screen supersample texture. */
  readonly designBounds: DesignRect;
}

function scaleRect(r: DesignRect, s: number): PlacedRect {
  return { x: r.x * s, y: r.y * s, w: r.w * s, h: r.h * s };
}

/** The bounding box of a set of rects, in design space. */
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

/** Resolve the pinned design-space geometry to screen px at `uiscale`, anchored top-left. */
export function buildToolPanelLayout(uiscale: number): ToolPanelLayout {
  const scale = Math.max(MIN_UI_SCALE, uiscale);
  const strip = scaleRect(TOOL_PANEL_STRIP, scale);
  const buttons = TOOL_BUTTONS.map((spec) => ({ ...spec, placed: scaleRect(spec.rect, scale) }));
  return {
    scale,
    stripGfx: TOOL_PANEL_STRIP_GFX,
    strip,
    buttons,
    // The claim region spans from the canvas edge to the strip's right edge.
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

/** Whether a screen point lies over the panel strip: the claim predicate asked before world picking. */
export function pointOverToolPanel(layout: ToolPanelLayout, x: number, y: number): boolean {
  return contains(layout.strip, x, y);
}
