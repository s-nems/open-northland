/**
 * The settler ACTION MENU — the contextual command buttons that fan out around a selected settler, with
 * geometry transcribed from the original engine and the button→icon assignment approximated.
 *
 * Original behaviour (OpenVikings `Source/NC2InGameGuiManager/CGuiManager.cs`): selecting 1–2 humans brings
 * up `BuildHumanActionButtons`, which lays the human's available commands out as small round gfx buttons in
 * up to **five groups (group-type 0..4)**, each group a short row/column on one side of a 0xE8 (232) px box
 * centred on the cursor. This module reproduces that arm **footprint** (the 100 px arm offset, the 0x20
 * button + step, the ∓5 corner nudge, the centring around the unit) — that part IS recoverable from the
 * decompile. What is NOT recoverable: which command maps to which group-type and which gfx id (the engine's
 * `sHumanCommandTypeToIconId` table is an unfilled placeholder in the oracle — only the 0x6B fallback is
 * code-pinned). So the **button→icon assignment is our best-guess** (glyph-matched to the frame map, and to
 * the layout the user read off the running original), logged in docs/FIDELITY.md as pending calibration.
 *
 * We render the whole default HUMAN menu as buttons — every arm of the original, in original art — but on
 * this slice only ONE is wired: `open-jobs` (the "change profession" button) opens a simple profession
 * PICKER ({@link layoutJobPicker}); every other button is an inert {@link placeholder} (tooltip only) left
 * for a future "implement the action" pass (warrior/scout menus differ — a per-unit-type menu is the hook).
 * This is pure geometry (no Pixi, no DOM), so the layout + hit-test + icon assignment are unit-tested
 * headlessly (the twin of `hud/tool-panel-layout.ts`).
 */

/** The GUI-atlas frame NAME (see `content/gui-atlas-map.ts`) a button draws; the view resolves it to an index. */
export type ActionIconFrame = string;

/** One contextual action a menu button issues — a discriminated union so the view maps it to behaviour. */
export type ActionButton =
  | {
      /** The "change profession" button — opens the profession {@link layoutJobPicker}. The one live default button. */
      readonly kind: 'open-jobs';
      readonly icon: ActionIconFrame;
      readonly label: string;
    }
  | {
      /** A profession in the picker — a one-click `setJob`. */
      readonly kind: 'job';
      /** The job's `typeId` — the `setJob` target profession. */
      readonly jobType: number;
      readonly icon: ActionIconFrame;
      /** Human tooltip (the profession's content label). */
      readonly label: string;
    }
  | {
      /** A default-menu button whose action is not yet implemented — drawn + tooltipped, but inert on click. */
      readonly kind: 'placeholder';
      /** Stable id (keys the retained visual, and is what a test asserts). */
      readonly id: string;
      readonly icon: ActionIconFrame;
      readonly label: string;
    };

/** One command family placed on a single arm (group-type 0..4) of the menu. */
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

/** A menu resolved to screen space: every button's square + the overall bounds. Shared by the ring + picker. */
export interface ActionRingLayout {
  readonly buttons: readonly PlacedActionButton[];
  /** The axis-aligned bounding box of all buttons — the region the input router claims for the menu. */
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
/** Extra gap between profession buttons in the picker grid (a hair of breathing room; the ring packs tight). */
export const ACTION_PICKER_GAP_PX = 4;
/** Max columns the profession picker wraps at before adding a row. */
export const ACTION_PICKER_MAX_COLS = 6;

/** Group-type constants (indices into {@link ARMS}) — which arm a command family sits on. */
export const BOTTOM_ARM = 0;
export const TOP_ARM = 1;
export const RIGHT_ARM = 2;
export const LEFT_ARM = 3;

/**
 * Per group-type (0..4): where its arm sits and how its buttons corner-nudge. `base` is the arm's fixed
 * offset from the menu centre (design px); `axis` is the axis the buttons march along; `nudge` is the
 * first/last corner bias. Buttons march in READING ORDER along the axis (left→right / top→bottom) — the
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
 * original's centring + step footprint (scaled by `scale`, the uiscale), then the WHOLE menu is nudged to
 * stay inside `[0,screenW]×[0,screenH]` (the original clamps its 232px box with `rect.PlaceInside`; we clamp
 * the actual button bounds, which also covers a long arm overflowing the nominal box). Pure — the view draws
 * from this and the input layer hit-tests it.
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
  const placed: PlacedActionButton[] = [];
  for (const g of groups) placed.push(...placeArm(g, centreX, centreY, s));
  return clampOnScreen(placed, screenW, screenH);
}

/**
 * Lay the profession PICKER out: the `buttons` (all `kind:'job'`) in a compact grid centred on the settler,
 * wrapping at {@link ACTION_PICKER_MAX_COLS} columns. The picker replaces the default menu while it is open;
 * picking a profession issues a `setJob` and returns to the menu. Same {@link ActionRingLayout} shape, so the
 * view + hit-test are reused. A "simple form" grid — the original's picker art is a later polish pass.
 */
export function layoutJobPicker(
  buttons: readonly ActionButton[],
  centreX: number,
  centreY: number,
  scale: number,
  screenW: number,
  screenH: number,
): ActionRingLayout {
  const s = Math.max(1, scale);
  const n = buttons.length;
  if (n === 0) return { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  const cols = Math.min(ACTION_PICKER_MAX_COLS, n);
  const rows = Math.ceil(n / cols);
  const step = (ACTION_BUTTON_PX + ACTION_PICKER_GAP_PX) * s;
  // Centre the grid on (centreX, centreY): the first cell centre is half the grid span up-left of centre.
  const startX = centreX - (step * (cols - 1)) / 2;
  const startY = centreY - (step * (rows - 1)) / 2;
  const placed: PlacedActionButton[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    placed.push(squareAt(buttons[i] as ActionButton, startX + col * step, startY + row * step, s));
  }
  return clampOnScreen(placed, screenW, screenH);
}

/** The button under a screen point, or `null`. Buttons never overlap, so the first containing square wins. */
export function hitTestActionRing(layout: ActionRingLayout, x: number, y: number): ActionButton | null {
  for (const p of layout.buttons) {
    const r = p.rect;
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return p.button;
  }
  return null;
}

/** Whether a screen point lies within the menu's claimed bounds — the input router asks this before world picking. */
export function pointOverActionRing(layout: ActionRingLayout, x: number, y: number): boolean {
  const b = layout.bounds;
  return layout.buttons.length > 0 && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}

// --- The default HUMAN menu (APPROXIMATED — icons glyph-matched to the frame map + the user's read of the
//     running original; every button but `open-jobs` is inert. See the file header + docs/FIDELITY.md) ------

/**
 * The default order-button gfx — the ONLY code-pinned icon: the original's `GetHumanCommandIconId` returns
 * `0x6B` for any command its (unfilled) table doesn't map (`CGuiManager.cs:2214`). Buttons whose glyph is
 * still unread (sleep, the last bottom slot) fall back to it, exactly as the original falls back.
 */
export const ACTION_ICON_FALLBACK = 'order_icon_fallback';

/**
 * The "change profession" button — the one live default-menu button (opens the profession picker). Its icon
 * is the original's two-screws glyph (frame `order_change_profession`, user-identified off the running game).
 */
const CHANGE_JOB: ActionButton = {
  kind: 'open-jobs',
  icon: 'order_change_profession',
  label: 'Zmiana zawodu',
};

/** Build an inert default-menu button. */
const placeholder = (id: string, icon: ActionIconFrame, label: string): ActionButton => ({
  kind: 'placeholder',
  id,
  icon,
  label,
});

/**
 * The default menu of a civilian human, arm by arm, in the layout the user read off the running original
 * (top = profession + hammer/alert/query, left = attack/house/animal/vehicle, bottom = social/needs, right =
 * house assignments). Icons are best-guess; labels name the INTENDED action even though only `open-jobs`
 * fires today. A warrior/scout differs (mainly the left arm + an extra button) — a future per-unit-type menu
 * is the hook; this civilian menu is the one selected today.
 */
export const HUMAN_DEFAULT_MENU: readonly ActionGroup[] = [
  {
    group: TOP_ARM,
    buttons: [
      CHANGE_JOB,
      placeholder('build', 'order_build', 'Budowa'),
      placeholder('alert', 'order_alert', 'Alarm'),
      placeholder('query', 'order_query', 'Informacja'),
    ],
  },
  {
    group: LEFT_ARM,
    buttons: [
      placeholder('attack', 'order_soldier_1', 'Atak'),
      placeholder('assign_house', 'order_house', 'Przypisz do domu'),
      placeholder('animal', 'order_animal', 'Zwierzę'),
      placeholder('vehicle', 'order_transport', 'Pojazd'),
    ],
  },
  {
    group: BOTTOM_ARM,
    buttons: [
      placeholder('marry', 'order_marry', 'Szukaj partnera'),
      placeholder('pray', 'order_pray', 'Modlitwa'),
      placeholder('talk', 'order_figure_hand', 'Rozmowa'),
      placeholder('sleep', ACTION_ICON_FALLBACK, 'Sen'),
      placeholder('eat', 'order_eat', 'Jedzenie'),
      placeholder('bottom_last', ACTION_ICON_FALLBACK, '—'),
    ],
  },
  {
    group: RIGHT_ARM,
    buttons: [
      placeholder('house_a', 'order_house', 'Przypisanie domu'),
      placeholder('house_b', 'order_build_house', 'Przypisanie domu'),
      placeholder('house_c', 'order_house_repair', 'Przypisanie domu'),
      placeholder('house_d', 'order_house_enter', 'Przypisanie domu'),
    ],
  },
];

// --- Profession → icon assignment (APPROXIMATED — glyph-matched to the frame map; see the file header) -----

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
