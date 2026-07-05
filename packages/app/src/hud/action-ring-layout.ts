/**
 * The settler ACTION RING — the contextual command buttons that fan out around a selected settler, with
 * geometry transcribed from the original engine and the button→icon assignment approximated.
 *
 * Original behaviour (OpenVikings `Source/NC2InGameGuiManager/CGuiManager.cs`): selecting 1–2 humans brings
 * up `BuildHumanActionButtons`, which lays the human's available commands out as small round gfx buttons in
 * up to **five groups (group-type 0..4)**, each group a short row/column on one side of a 0xE8 (232) px box
 * centred on the cursor. This module reproduces that arm geometry **verbatim** (the 100 px arm offset, the
 * 0x20 button + step, the ∓5 corner nudges, the centring formula) — that part IS recoverable from the
 * decompile. What is NOT recoverable: which command maps to which group-type and which gfx id (the engine's
 * `sHumanCommandTypeToIconId` table is an unfilled placeholder in the oracle — only the 0x6B fallback is
 * code-pinned). So the **button→icon assignment is our best-guess** (glyph-matched to the frame map),
 * logged in docs/FIDELITY.md as pending calibration against the original game.
 *
 * Our two contextual command families map onto the original's group axes: **profession changes** (`setJob`)
 * fill group 0 (the bottom arm), **military stances** (`setStance`) fill group 1 (the top arm). Groups 2–4
 * are left for future command families. This is pure geometry (no Pixi, no DOM), so the layout + hit-test +
 * icon assignment are unit-tested headlessly (the twin of `hud/tool-panel-layout.ts`).
 */

import { systems } from '@vinland/sim';

/** The five `MILITARY_MODE` ids (`NONE/ATTACK/DEFEND/IGNORE/FLEE`) — the stance the `setStance` command sets. */
const { MILITARY_MODE } = systems;

/** The GUI-atlas frame NAME (see `content/gui-atlas-map.ts`) a button draws; the view resolves it to an index. */
export type ActionIconFrame = string;

/** One contextual action a ring button issues — a discriminated union so the view maps it to a command. */
export type ActionButton =
  | {
      readonly kind: 'job';
      /** The job's `typeId` — the `setJob` target profession. */
      readonly jobType: number;
      readonly icon: ActionIconFrame;
      /** Human tooltip (the profession's content label). */
      readonly label: string;
    }
  | {
      readonly kind: 'stance';
      /** The `MILITARY_MODE` id — the `setStance` target. */
      readonly mode: number;
      readonly icon: ActionIconFrame;
      readonly label: string;
    };

/** One command family placed on a single arm (group-type 0..4) of the ring. */
export interface ActionGroup {
  /** The original engine group-type (0..4) — selects the arm the buttons sit on. */
  readonly group: number;
  readonly buttons: readonly ActionButton[];
}

/** A rect in screen (canvas) pixels. */
export interface PlacedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A button resolved to its on-screen square. */
export interface PlacedActionButton {
  readonly button: ActionButton;
  readonly rect: PlacedRect;
}

/** The whole ring resolved to screen space: every button's square + the ring's overall bounds. */
export interface ActionRingLayout {
  readonly buttons: readonly PlacedActionButton[];
  /** The axis-aligned bounding box of all buttons — the region the input router claims for the ring. */
  readonly bounds: PlacedRect;
}

// --- Geometry (original DESIGN pixels, pre-uiscale) — transcribed from `BuildHumanActionButtons` ----------

/** Button square edge (`SRectangle(x-0x10, y-0x10, 0x20, 0x20)`). */
export const ACTION_BUTTON_PX = 0x20;
/** Step between adjacent buttons in a group (the decompile's `stepX/stepY = 0x20`). */
export const ACTION_STEP_PX = 0x20;
/** Arm offset from centre for the four cardinal groups (the decompile's `±100`). */
export const ACTION_ARM_PX = 100;
/** The fifth group's inner-left column offset (`centerX - 0x44`). */
export const ACTION_INNER_ARM_PX = 0x44;
/** First/last-in-group corner nudge (the decompile's `±5` `cornerBias`). */
export const ACTION_EDGE_NUDGE_PX = 5;

/**
 * Per group-type (0..4): where its arm sits and how its buttons step. `base` is the arm's fixed offset from
 * the ring centre (design px); `axis` is the axis the buttons march along; `startSign`/`stepSign` reproduce
 * the decompile's centring (`start = centre + startSign·(STEP/2)·(N-1)`, then `+ stepSign·STEP·i`); `nudge`
 * is the first/last corner bias. Groups 0 (bottom) and 1 (top) are the ones we populate today.
 */
interface ArmSpec {
  readonly axis: 'x' | 'y';
  readonly base: { readonly x: number; readonly y: number };
  readonly startSign: 1 | -1;
  readonly stepSign: 1 | -1;
  readonly nudge: { readonly x: number; readonly y: number };
}

const ARMS: readonly ArmSpec[] = [
  // group 0 — bottom row: y = centreY + 100, x centred, step +32, corner nudge y −5.
  {
    axis: 'x',
    base: { x: 0, y: ACTION_ARM_PX },
    startSign: -1,
    stepSign: 1,
    nudge: { x: 0, y: -ACTION_EDGE_NUDGE_PX },
  },
  // group 1 — top row: y = centreY − 100, x centred (reversed order), step −32, corner nudge y +5.
  {
    axis: 'x',
    base: { x: 0, y: -ACTION_ARM_PX },
    startSign: 1,
    stepSign: -1,
    nudge: { x: 0, y: ACTION_EDGE_NUDGE_PX },
  },
  // group 2 — right column: x = centreX + 100, y centred, step +32, corner nudge x −5.
  {
    axis: 'y',
    base: { x: ACTION_ARM_PX, y: 0 },
    startSign: -1,
    stepSign: 1,
    nudge: { x: -ACTION_EDGE_NUDGE_PX, y: 0 },
  },
  // group 3 — left column: x = centreX − 100, y centred (reversed), step −32, corner nudge x +5.
  {
    axis: 'y',
    base: { x: -ACTION_ARM_PX, y: 0 },
    startSign: 1,
    stepSign: -1,
    nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 },
  },
  // group 4 — inner-left column: x = centreX − 0x44, y centred (reversed), step −32, corner nudge x +5.
  {
    axis: 'y',
    base: { x: -ACTION_INNER_ARM_PX, y: 0 },
    startSign: 1,
    stepSign: -1,
    nudge: { x: ACTION_EDGE_NUDGE_PX, y: 0 },
  },
];

/** Place one group's buttons on its arm. `s` is the uiscale; `cx,cy` the ring centre (screen px). */
function placeArm(group: ActionGroup, cx: number, cy: number, s: number): PlacedActionButton[] {
  const arm = ARMS[group.group];
  if (arm === undefined) return [];
  const n = group.buttons.length;
  const step = ACTION_STEP_PX * s;
  const halfStep = step / 2; // centre N buttons: the first sits (N−1)·halfStep off centre.
  const btn = ACTION_BUTTON_PX * s;
  const halfBtn = btn / 2;
  const out: PlacedActionButton[] = [];
  for (let i = 0; i < n; i++) {
    const along = arm.startSign * halfStep * (n - 1) + arm.stepSign * step * i;
    let centreX = cx + arm.base.x * s + (arm.axis === 'x' ? along : 0);
    let centreY = cy + arm.base.y * s + (arm.axis === 'y' ? along : 0);
    if (i === 0 || i === n - 1) {
      centreX += arm.nudge.x * s;
      centreY += arm.nudge.y * s;
    }
    out.push({
      button: group.buttons[i] as ActionButton,
      rect: { x: centreX - halfBtn, y: centreY - halfBtn, w: btn, h: btn },
    });
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

/**
 * Lay the ring's groups out around a screen-space centre. Each group fills its arm with the original's
 * centring + step geometry (scaled by `scale`, the uiscale), then the WHOLE ring is nudged to stay inside
 * `[0,screenW]×[0,screenH]` (the original clamps its 232px box with `rect.PlaceInside`; we clamp the actual
 * button bounds, which also covers a long arm overflowing the nominal box). Pure — the view draws from this
 * and the input layer hit-tests it.
 */
export function layoutActionRing(
  groups: readonly ActionGroup[],
  centreX: number,
  centreY: number,
  scale: number,
  screenW: number,
  screenH: number,
): ActionRingLayout {
  const s = Math.max(1, scale);
  let placed: PlacedActionButton[] = [];
  for (const g of groups) placed.push(...placeArm(g, centreX, centreY, s));

  // Clamp the whole ring on-screen: shift by the smallest delta that pulls the bounds fully inside.
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
  if (dx !== 0 || dy !== 0) {
    placed = placed.map((p) => ({
      button: p.button,
      rect: { ...p.rect, x: p.rect.x + dx, y: p.rect.y + dy },
    }));
  }
  return { buttons: placed, bounds: boundsOf(placed.map((p) => p.rect)) };
}

/** The button under a screen point, or `null`. Buttons never overlap, so the first containing square wins. */
export function hitTestActionRing(layout: ActionRingLayout, x: number, y: number): ActionButton | null {
  for (const p of layout.buttons) {
    const r = p.rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return p.button;
  }
  return null;
}

/** Whether a screen point lies within the ring's claimed bounds — the input router asks this before world picking. */
export function pointOverActionRing(layout: ActionRingLayout, x: number, y: number): boolean {
  const b = layout.bounds;
  return layout.buttons.length > 0 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

// --- Button → icon assignment (APPROXIMATED — glyph-matched to the frame map; see the file header) ---------

/**
 * The default order-button gfx — the ONLY code-pinned icon: the original's `GetHumanCommandIconId` returns
 * `0x6B` for any command its (unfilled) table doesn't map (`CGuiManager.cs:2214`). Every profession/stance
 * whose glyph guess below misses falls back to it, exactly as the original falls back for an unmapped command.
 */
export const ACTION_ICON_FALLBACK = 'order_icon_fallback';

/**
 * Best-guess profession → order-icon, matched by the `order_*` glyph descriptions in `gui-atlas-map.ts`.
 * Keyed by the job's content id (exact), with a stem fallback for families (e.g. every `soldier*`). None of
 * these is code-pinned — the assignment is pending calibration (docs/FIDELITY.md).
 */
const JOB_ICON_EXACT: Readonly<Record<string, ActionIconFrame>> = {
  woodcutter: 'order_worker', // figure with crossed tools (no axe glyph exists) — the generic labourer
  carpenter: 'order_build', // hammer
  carrier: 'order_transport', // wheelbarrow
  miner: 'order_mine', // pickaxe
  stonemason: 'order_construct', // hammer / pickaxe
  smith: 'order_produce', // gears + blob
  scout: 'order_scout', // eye with rays
};

/** Stem fallbacks for job families whose exact id varies (e.g. `soldier_sword_long`). Checked after exact. */
const JOB_ICON_STEM: readonly (readonly [string, ActionIconFrame])[] = [
  ['soldier', 'order_soldier_1'], // crossed swords
  ['work_', 'order_produce'], // generic workplace worker → production glyph
];

/** The order-icon frame name for a profession (best-guess; `ACTION_ICON_FALLBACK` when nothing matches). */
export function jobIconFrame(jobId: string): ActionIconFrame {
  const id = jobId.toLowerCase();
  const exact = JOB_ICON_EXACT[id];
  if (exact !== undefined) return exact;
  for (const [stem, icon] of JOB_ICON_STEM) if (id.startsWith(stem)) return icon;
  return ACTION_ICON_FALLBACK;
}

/** Best-guess `MILITARY_MODE` → order-icon (approximated; tooltips carry the exact meaning). */
const STANCE_ICON: Readonly<Record<number, ActionIconFrame>> = {
  [MILITARY_MODE.ATTACK]: 'order_soldier_1', // crossed swords — aggressive
  [MILITARY_MODE.DEFEND]: 'order_crest', // heraldic crest — a shield stand-in
  [MILITARY_MODE.IGNORE]: 'order_query', // question mark — passive / observe
  [MILITARY_MODE.FLEE]: 'order_move', // walking figure — run away
};

/** The order-icon frame name for a stance mode (best-guess; `ACTION_ICON_FALLBACK` for an unknown mode). */
export function stanceIconFrame(mode: number): ActionIconFrame {
  return STANCE_ICON[mode] ?? ACTION_ICON_FALLBACK;
}
