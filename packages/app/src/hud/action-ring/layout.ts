import { contains, type Rect } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';
import type { ActionCommand } from './commands.js';

/**
 * Radial geometry for the settler action menu: two short rows and three columns around a screen anchor.
 * The 100 px arm offset, 68 px inner column offset, 32 px button step, and 5 px corner nudge are
 * approximations, not confirmed against the running original.
 */

/** Arm ids: the row or column a command's button sits on. */
export const BOTTOM_ARM = 0;
export const TOP_ARM = 1;
export const RIGHT_ARM = 2;
export const LEFT_ARM = 3;
/** The second left column, drawn between the left arm and the unit. */
export const INNER_LEFT_ARM = 4;

export type ActionArm = 0 | 1 | 2 | 3 | 4;

export interface ActionGroup {
  readonly arm: ActionArm;
  readonly commands: readonly ActionCommand[];
}

/** `rect` is in screen (canvas) pixels. */
export interface PlacedActionCommand {
  readonly command: ActionCommand;
  readonly rect: Rect;
}

export interface ActionRingLayout {
  readonly buttons: readonly PlacedActionCommand[];
  /** Bounding box of all buttons. Hit-testing uses the individual squares, so a click in the gaps
   *  between arms still reaches the world underneath. */
  readonly bounds: Rect;
}

// Design pixels, before UI scaling.

const ACTION_BUTTON_PX = 0x20;
/** Step between adjacent buttons on one arm. */
const ACTION_STEP_PX = 0x20;
/** Arm offset from centre for the four cardinal arms. */
export const ACTION_ARM_PX = 100;
const ACTION_INNER_ARM_PX = 68;
/** First/last-in-arm corner nudge. */
const ACTION_EDGE_NUDGE_PX = 5;

/** The ring runs at 75% of the shared HUD scale so it does not crowd the selected settler: a deliberate
 *  deviation from the original's 1:1 size (approximation). */
export const ACTION_RING_UI_FACTOR = 0.75;

/**
 * The ring's effective scale: the floored HUD scale shrunk by the ring factor. The icon bake and the
 * layout must consume this same value or a drawn icon and its hit-rect drift apart.
 */
export function actionRingScale(uiscale: number): number {
  return Math.max(MIN_UI_SCALE, uiscale) * ACTION_RING_UI_FACTOR;
}

/** Per arm: `base` is its offset from the menu centre in design px, `axis` the axis its buttons march
 *  along in drawing order, `nudge` the first/last corner bias. */
interface ArmSpec {
  readonly axis: 'x' | 'y';
  readonly base: { readonly x: number; readonly y: number };
  readonly nudge: { readonly x: number; readonly y: number };
}

const ARMS: Readonly<Record<ActionArm, ArmSpec>> = {
  [BOTTOM_ARM]: { axis: 'x', base: { x: 0, y: ACTION_ARM_PX }, nudge: { x: 0, y: -ACTION_EDGE_NUDGE_PX } },
  [TOP_ARM]: { axis: 'x', base: { x: 0, y: -ACTION_ARM_PX }, nudge: { x: 0, y: ACTION_EDGE_NUDGE_PX } },
  [RIGHT_ARM]: { axis: 'y', base: { x: ACTION_ARM_PX, y: 0 }, nudge: { x: -ACTION_EDGE_NUDGE_PX, y: 0 } },
  [LEFT_ARM]: { axis: 'y', base: { x: -ACTION_ARM_PX, y: 0 }, nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 } },
  [INNER_LEFT_ARM]: {
    axis: 'y',
    base: { x: -ACTION_INNER_ARM_PX, y: 0 },
    nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 },
  },
};

/** A button square centred at `(cx, cy)` in screen px. */
function squareAt(command: ActionCommand, cx: number, cy: number, s: number): PlacedActionCommand {
  const btn = ACTION_BUTTON_PX * s;
  const half = btn / 2;
  return { command, rect: { x: cx - half, y: cy - half, w: btn, h: btn } };
}

/** Place one arm's buttons in drawing order; `s` is the ring scale, `cx,cy` the centre in screen px. */
function placeArm(group: ActionGroup, cx: number, cy: number, s: number): PlacedActionCommand[] {
  const arm = ARMS[group.arm];
  const n = group.commands.length;
  const step = ACTION_STEP_PX * s;
  const halfSpan = (step / 2) * (n - 1);
  const out: PlacedActionCommand[] = [];
  for (const [i, command] of group.commands.entries()) {
    const along = -halfSpan + step * i;
    let centreX = cx + arm.base.x * s + (arm.axis === 'x' ? along : 0);
    let centreY = cy + arm.base.y * s + (arm.axis === 'y' ? along : 0);
    if (i === 0 || i === n - 1) {
      centreX += arm.nudge.x * s;
      centreY += arm.nudge.y * s;
    }
    out.push(squareAt(command, centreX, centreY, s));
  }
  return out;
}

/** The union bounding box of a set of rects (empty → a zero box at the origin). */
function boundsOf(rects: readonly Rect[]): Rect {
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
function clampOnScreen(placed: PlacedActionCommand[], screenW: number, screenH: number): ActionRingLayout {
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
      : placed.map((p) => ({ command: p.command, rect: { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy } }));
  return { buttons: moved, bounds: boundsOf(moved.map((p) => p.rect)) };
}

/**
 * Lay the menu's arms out around a screen-space centre, then nudge the whole menu inside
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
  const placed: PlacedActionCommand[] = [];
  for (const g of groups) placed.push(...placeArm(g, centreX, centreY, scale));
  return clampOnScreen(placed, screenW, screenH);
}

/**
 * The command under a screen point, or `null`. With the approximated offsets a long row and a long column
 * overlap at their corner; the later-drawn button lies on top and takes the click.
 */
export function hitTestActionRing(layout: ActionRingLayout, x: number, y: number): ActionCommand | null {
  for (let i = layout.buttons.length - 1; i >= 0; i--) {
    const p = layout.buttons[i];
    if (p !== undefined && contains(p.rect, x, y)) return p.command;
  }
  return null;
}
