import type { GuiFrameName } from '../content/gui-atlas-map.js';
import { contains, type Rect } from './geometry.js';

/**
 * Radial geometry for the settler action menu: up to five short button groups around a 232 px box centred
 * on the cursor. The 100 px arm offset, 32 px button step, and 5 px corner nudge are approximations
 * awaiting visual confirmation against the running original.
 */

export type ActionIconFrame = GuiFrameName;

/** One contextual action a menu button issues. */
export type ActionButton =
  | {
      readonly kind: 'open-jobs';
      readonly id: 'changeProfession';
      readonly icon: ActionIconFrame;
    }
  | {
      /** Arms the click-to-place mode; the next world click issues `placeSignpost`. */
      readonly kind: 'erect-signpost';
      readonly id: 'erectSignpost';
      readonly icon: ActionIconFrame;
    }
  | {
      /** Arms the attack-move pick mode. */
      readonly kind: 'attack-move';
      readonly id: 'attack';
      readonly icon: ActionIconFrame;
    }
  | {
      readonly kind: 'marry';
      readonly id: 'marry';
      readonly icon: ActionIconFrame;
    }
  | {
      /** Arms the click-a-house pick mode. */
      readonly kind: 'assign-house';
      readonly id: 'assign_house';
      readonly icon: ActionIconFrame;
    }
  | {
      readonly kind: 'make-child';
      readonly id: 'make_son' | 'make_daughter';
      readonly sex: 'male' | 'female';
      readonly icon: ActionIconFrame;
    }
  | {
      /** A default-menu button that is drawn and tooltipped but inert on click. */
      readonly kind: 'placeholder';
      /** Stable id keying the retained visual. */
      readonly id: string;
      readonly icon: ActionIconFrame;
    };

export interface ActionGroup {
  /** Original engine group-type (0..4): the arm the buttons sit on. */
  readonly group: number;
  readonly buttons: readonly ActionButton[];
}

/** A rect in screen (canvas) pixels. */
export type PlacedRect = Rect;

export interface PlacedActionButton {
  readonly button: ActionButton;
  readonly rect: PlacedRect;
}

export interface ActionRingLayout {
  readonly buttons: readonly PlacedActionButton[];
  /** Bounding box of all buttons. Hit-testing uses the individual squares, so a click in the gaps
   *  between arms still reaches the world underneath. */
  readonly bounds: PlacedRect;
}

// Design pixels, before UI scaling.

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
 * The whole ring footprint runs at 75% of the shared HUD scale so it does not crowd the selected settler:
 * a deliberate deviation from the original's 1:1 size (approximation).
 */
export const ACTION_RING_UI_FACTOR = 0.75;

/**
 * The ring's effective scale for `?uiscale=`: clamped >= 1, then shrunk by the ring factor. The icon bake
 * and the layout must consume this same value or a drawn icon and its hit-rect drift apart.
 */
export function actionRingScale(uiscale: number): number {
  return Math.max(1, uiscale) * ACTION_RING_UI_FACTOR;
}

/** Group-type constants: indices into `ARMS`. */
export const BOTTOM_ARM = 0;
export const TOP_ARM = 1;
export const RIGHT_ARM = 2;
export const LEFT_ARM = 3;

/**
 * Per group-type (0..4): `base` is the arm's fixed offset from the menu centre in design px, `axis` the
 * axis its buttons march along in reading order, `nudge` the first/last corner bias.
 */
interface ArmSpec {
  readonly axis: 'x' | 'y';
  readonly base: { readonly x: number; readonly y: number };
  readonly nudge: { readonly x: number; readonly y: number };
}

const ARMS: readonly ArmSpec[] = [
  // group 0: bottom row.
  { axis: 'x', base: { x: 0, y: ACTION_ARM_PX }, nudge: { x: 0, y: -ACTION_EDGE_NUDGE_PX } },
  // group 1: top row.
  { axis: 'x', base: { x: 0, y: -ACTION_ARM_PX }, nudge: { x: 0, y: ACTION_EDGE_NUDGE_PX } },
  // group 2: right column.
  { axis: 'y', base: { x: ACTION_ARM_PX, y: 0 }, nudge: { x: -ACTION_EDGE_NUDGE_PX, y: 0 } },
  // group 3: left column.
  { axis: 'y', base: { x: -ACTION_ARM_PX, y: 0 }, nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 } },
  // group 4: inner-left column.
  { axis: 'y', base: { x: -ACTION_INNER_ARM_PX, y: 0 }, nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 } },
];

/** A button square centred at `(cx, cy)` in screen px. */
function squareAt(button: ActionButton, cx: number, cy: number, s: number): PlacedActionButton {
  const btn = ACTION_BUTTON_PX * s;
  const half = btn / 2;
  return { button, rect: { x: cx - half, y: cy - half, w: btn, h: btn } };
}

/** Place one group's buttons on its arm in reading order; `s` is the ring scale, `cx,cy` the centre in screen px. */
function placeArm(group: ActionGroup, cx: number, cy: number, s: number): PlacedActionButton[] {
  const arm = ARMS[group.group];
  if (arm === undefined) return [];
  const n = group.buttons.length;
  const step = ACTION_STEP_PX * s;
  const halfSpan = (step / 2) * (n - 1);
  const out: PlacedActionButton[] = [];
  for (let i = 0; i < n; i++) {
    const along = -halfSpan + step * i;
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
 * Lay the menu's groups out around a screen-space centre, then nudge the whole menu inside
 * `[0,screenW]x[0,screenH]`. `scale` is the ring's effective scale, where sub-1 values are legal. The
 * clamp uses the actual button bounds rather than the original's nominal 232 px box, so a long arm
 * overflowing that box is covered too.
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
