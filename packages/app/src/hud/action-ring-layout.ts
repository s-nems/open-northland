import type { GuiFrameName } from '../content/gui-atlas-map.js';
import { contains, type Rect } from './geometry.js';

/**
 * The settler action menu's geometry — the radial arm footprint the contextual command buttons fan out on
 * around a selected settler, transcribed from the original engine. The menu content (which buttons, which
 * icons) is plain data in `action-ring-menu.ts`.
 *
 * The current layout uses up to five short button groups around a 232 px box centered on the cursor.
 * Its 100 px arm offset, 32 px button step, and 5 px corner nudge are project-maintained approximations
 * that need visual confirmation against the running original.
 * Pure geometry (no Pixi, no DOM), so the layout + hit-test are unit-tested headlessly (the twin of
 * `hud/tool-panel/layout.ts`).
 */

/** The GUI-atlas frame name a button draws; the view resolves it to an index. Narrowed to the sheet's own
 *  names, so a typo'd icon fails to compile rather than throwing when the ring first draws. */
export type ActionIconFrame = GuiFrameName;

/** One contextual action a menu button issues — a discriminated union so the view maps it to behaviour. */
export type ActionButton =
  | {
      /** The "change profession" button — opens the profession list window (a DOM panel). The one live default button. */
      readonly kind: 'open-jobs';
      readonly id: 'changeProfession';
      readonly icon: ActionIconFrame;
    }
  | {
      /** The scout's "Erect Signpost" button — arms the click-to-place mode (the next world click issues
       *  `placeSignpost`). Shown only on the scout's menu, in the original's top-right slots. */
      readonly kind: 'erect-signpost';
      readonly id: 'erectSignpost';
      readonly icon: ActionIconFrame;
    }
  | {
      /** "Find a partner" — issues the sim `marry` order (shown only for an unmarried eligible adult). */
      readonly kind: 'marry';
      readonly id: 'marry';
      readonly icon: ActionIconFrame;
    }
  | {
      /** "Assign home" — arms the click-a-house pick mode (shown for any adult settler). */
      readonly kind: 'assign-house';
      readonly id: 'assign_house';
      readonly icon: ActionIconFrame;
    }
  | {
      /** "Make a son / daughter" — issues the sim `makeChild` order (shown for a married woman with
       *  no growing child). Two instances, one per sex. */
      readonly kind: 'make-child';
      readonly id: 'make_son' | 'make_daughter';
      readonly sex: 'male' | 'female';
      readonly icon: ActionIconFrame;
    }
  | {
      /** A default-menu button whose action is not yet implemented — drawn + tooltipped, but inert on click. */
      readonly kind: 'placeholder';
      /** Stable id (keys the retained visual, and is what a test asserts). */
      readonly id: string;
      readonly icon: ActionIconFrame;
    };

/** One command family placed on a single arm (group-type 0..4) of the menu. */
export interface ActionGroup {
  /** The original engine group-type (0..4) — selects the arm the buttons sit on. */
  readonly group: number;
  readonly buttons: readonly ActionButton[];
}

/** A rect in screen (canvas) pixels. */
export type PlacedRect = Rect;

/** A button resolved to its on-screen square. */
export interface PlacedActionButton {
  readonly button: ActionButton;
  readonly rect: PlacedRect;
}

/** A menu resolved to screen space: every button's square + the overall bounding box. */
export interface ActionRingLayout {
  readonly buttons: readonly PlacedActionButton[];
  /**
   * The axis-aligned bounding box of all buttons (e.g. for placing UI relative to the menu). The input router
   * hit-tests individual buttons ({@link hitTestActionRing}), not this box, so a click in the gaps between the
   * arms still reaches the world / the unit underneath.
   */
  readonly bounds: PlacedRect;
}

// --- Geometry in project design pixels, before UI scaling -----------------------------------------------

/** Button square edge (`SRectangle(x-0x10, y-0x10, 0x20, 0x20)`). */
const ACTION_BUTTON_PX = 0x20;
/** Step between adjacent buttons in a group. */
const ACTION_STEP_PX = 0x20;
/** Arm offset from centre for the four cardinal groups. */
export const ACTION_ARM_PX = 100;
/** The fifth group's inner-left column offset (`centerX - 0x44`). */
const ACTION_INNER_ARM_PX = 0x44;
/** First/last-in-group corner nudge. */
const ACTION_EDGE_NUDGE_PX = 5;

/**
 * The action menu draws smaller than the shared HUD uiscale: at the 1.4× default the full-size ring
 * crowded the selected settler, so the whole footprint (buttons + arms + steps) runs at 75% of the HUD
 * scale — a user-requested ~25% shrink, a deliberate deviation from the original's 1:1 size (source
 * basis); the pinned arm proportions are untouched (everything scales by the one factor).
 */
export const ACTION_RING_UI_FACTOR = 0.75;

/**
 * The ring's effective scale for the shared `?uiscale=`: clamped ≥1 like every HUD consumer, then shrunk
 * by {@link ACTION_RING_UI_FACTOR}. The one place ring clamping lives — both the icon bake and
 * {@link layoutActionRing} must consume this same value or the drawn icon and its hit-rect drift apart.
 */
export function actionRingScale(uiscale: number): number {
  return Math.max(1, uiscale) * ACTION_RING_UI_FACTOR;
}

/** Group-type constants (indices into {@link ARMS}) — which arm a command family sits on. Consumed by the
 *  menu data (`action-ring-menu.ts`) and the layout tests. */
export const BOTTOM_ARM = 0;
export const TOP_ARM = 1;
export const RIGHT_ARM = 2;
export const LEFT_ARM = 3;

/**
 * Per group-type (0..4): where its arm sits and how its buttons corner-nudge. `base` is the arm's fixed
 * offset from the menu centre (design px); `axis` is the axis the buttons march along; `nudge` is the
 * first/last corner bias. Buttons march in reading order along the axis (left→right / top→bottom) — the
 * original's per-arm order reversal is moot here (its command→slot table is unrecoverable, so we place the
 * best-guess icon into the slot the user read off the original), while the symmetric footprint is kept.
 */
interface ArmSpec {
  readonly axis: 'x' | 'y';
  readonly base: { readonly x: number; readonly y: number };
  readonly nudge: { readonly x: number; readonly y: number };
}

const ARMS: readonly ArmSpec[] = [
  // group 0 — bottom row: y = centreY + 100, x centred, corner nudge y −5.
  { axis: 'x', base: { x: 0, y: ACTION_ARM_PX }, nudge: { x: 0, y: -ACTION_EDGE_NUDGE_PX } },
  // group 1 — top row: y = centreY − 100, x centred, corner nudge y +5.
  { axis: 'x', base: { x: 0, y: -ACTION_ARM_PX }, nudge: { x: 0, y: ACTION_EDGE_NUDGE_PX } },
  // group 2 — right column: x = centreX + 100, y centred, corner nudge x −5.
  { axis: 'y', base: { x: ACTION_ARM_PX, y: 0 }, nudge: { x: -ACTION_EDGE_NUDGE_PX, y: 0 } },
  // group 3 — left column: x = centreX − 100, y centred, corner nudge x +5.
  { axis: 'y', base: { x: -ACTION_ARM_PX, y: 0 }, nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 } },
  // group 4 — inner-left column: x = centreX − 0x44, y centred, corner nudge x +5.
  { axis: 'y', base: { x: -ACTION_INNER_ARM_PX, y: 0 }, nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 } },
];

/** A button square centred at `(cx, cy)` (screen px), scaled: the placed rect. */
function squareAt(button: ActionButton, cx: number, cy: number, s: number): PlacedActionButton {
  const btn = ACTION_BUTTON_PX * s;
  const half = btn / 2;
  return { button, rect: { x: cx - half, y: cy - half, w: btn, h: btn } };
}

/** Place one group's buttons on its arm in reading order. `s` is the uiscale; `cx,cy` the menu centre (px). */
function placeArm(group: ActionGroup, cx: number, cy: number, s: number): PlacedActionButton[] {
  const arm = ARMS[group.group];
  if (arm === undefined) return [];
  const n = group.buttons.length;
  const step = ACTION_STEP_PX * s;
  const halfSpan = (step / 2) * (n - 1); // centre N buttons: the first sits halfSpan off centre.
  const out: PlacedActionButton[] = [];
  for (let i = 0; i < n; i++) {
    const along = -halfSpan + step * i; // reading order: i=0 is left-/top-most.
    let centreX = cx + arm.base.x * s + (arm.axis === 'x' ? along : 0);
    let centreY = cy + arm.base.y * s + (arm.axis === 'y' ? along : 0);
    if (i === 0 || i === n - 1) {
      centreX += arm.nudge.x * s;
      centreY += arm.nudge.y * s;
    }
    out.push(squareAt(group.buttons[i] as ActionButton, centreX, centreY, s));
  }
  return out;
}

/** The union bounding box of a set of rects (empty → a zero box at the origin). */
function boundsOf(rects: readonly PlacedRect[]): PlacedRect {
  if (rects.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
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

/** Shift a placed set by the smallest delta that pulls its bounds fully inside `[0,w]×[0,h]` (rigid move). */
function clampOnScreen(placed: PlacedActionButton[], screenW: number, screenH: number): ActionRingLayout {
  const b = boundsOf(placed.map((p) => p.rect));
  let dx = 0;
  let dy = 0;
  if (b.w <= screenW) {
    if (b.x < 0) dx = -b.x;
    else if (b.x + b.w > screenW) dx = screenW - (b.x + b.w);
  }
  if (b.h <= screenH) {
    if (b.y < 0) dy = -b.y;
    else if (b.y + b.h > screenH) dy = screenH - (b.y + b.h);
  }
  const moved =
    dx === 0 && dy === 0
      ? placed
      : placed.map((p) => ({ button: p.button, rect: { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy } }));
  return { buttons: moved, bounds: boundsOf(moved.map((p) => p.rect)) };
}

/**
 * Lay the default menu's groups out around a screen-space centre. Each group fills its arm with the
 * original's centring + step footprint (scaled by `scale` — the ring's effective scale, see
 * {@link actionRingScale}; sub-1 values are legal, the shrunk ring at uiscale 1 is 0.75), then the whole
 * menu is nudged to stay inside `[0,screenW]×[0,screenH]` (the original clamps its 232px box with
 * `rect.PlaceInside`; we clamp the actual button bounds, which also covers a long arm overflowing the
 * nominal box). Pure — the view draws from this and the input layer hit-tests it.
 */
export function layoutActionRing(
  groups: readonly ActionGroup[],
  centreX: number,
  centreY: number,
  scale: number,
  screenW: number,
  screenH: number,
): ActionRingLayout {
  const placed: PlacedActionButton[] = [];
  for (const g of groups) placed.push(...placeArm(g, centreX, centreY, scale));
  return clampOnScreen(placed, screenW, screenH);
}

/** The button under a screen point, or `null`. Buttons never overlap, so the first containing square wins. */
export function hitTestActionRing(layout: ActionRingLayout, x: number, y: number): ActionButton | null {
  for (const p of layout.buttons) {
    if (contains(p.rect, x, y)) return p.button;
  }
  return null;
}
