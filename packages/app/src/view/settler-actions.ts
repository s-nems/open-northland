import {
  type AtlasFrame,
  type Camera,
  PalettedSprite,
  type SpriteLayer,
  tileToScreen,
} from '@vinland/render';
import { ONE, type WorldSnapshot } from '@vinland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { GUI_FRAMES, guiFrameIndex } from '../content/gui-atlas-map.js';
import {
  type GuiPaletteName,
  guiPaletteRow,
  loadGuiPaletteLut,
  loadGuiWindowIndexed,
} from '../content/gui-gfx.js';
import {
  type ActionButton,
  type ActionRingLayout,
  HUMAN_DEFAULT_MENU,
  hitTestActionRing,
  jobIconFrame,
  layoutActionRing,
  layoutJobPicker,
} from '../hud/action-ring-layout.js';
import { backingScale } from './camera.js';
import { el } from './overlay.js';
import type { Profession } from './unit-panel.js';

/**
 * The settler ACTION MENU — the contextual command buttons that fan out around the selected settler(s), in
 * original GUI art. It is the Pixi + input glue over the pure {@link import('../hud/action-ring-layout.js')}
 * geometry (the twin split of `hud/tool-panel*`): the layout module transcribes the original's radial arm
 * footprint and assigns each command a best-guess order-icon; this module draws those icons as
 * {@link PalettedSprite}s over the indexed `ls_gui_window` atlas (the round wooden order buttons, `context`
 * palette) and turns a click into a `setJob` through the callback seam — never touching sim state (app-layer
 * I/O, one-way flow).
 *
 * We draw the WHOLE default human menu (every arm of the original), but only the "change profession" button
 * (`open-jobs`) is wired on this slice: clicking it swaps the menu for a simple profession PICKER; picking a
 * profession issues `setJob` and returns to the menu. Every other button is an inert placeholder (drawn +
 * tooltipped, does nothing) — the future "implement the action" pass wires them (and the warrior/scout menu
 * variants). Three modes: `closed` → `menu` (the default arms) → `jobs` (the picker).
 *
 * It is toggled with **Space** (the info card stays always-on) and anchored on the selected settlers'
 * on-screen centroid, re-placed every frame as the camera pans / the units move. When the decoded GUI art is
 * absent (a checkout that hasn't run the pipeline) it DEGRADES to flat `Graphics` discs at the exact same
 * geometry, staying visible and fully clickable — the tooltip (a DOM label) carries each button's meaning in
 * both modes.
 */

/** Draw the menu above the world (and the tool panel, which is on the far-left strip — they rarely overlap). */
const RING_Z = 1000;

/** Hover highlight over the button under the cursor. */
const HOVER_TINT = 0xffffff;
const HOVER_ALPHA = 0.28;
/** Flat-fallback disc colours (only when the decoded GUI art is absent) — a wooden button + rim. */
const FALLBACK_FILL = 0x6b4f2a;
const FALLBACK_RIM = 0x2a1d0e;

const TOOLTIP_STYLE = [
  'position:fixed',
  'padding:2px 7px',
  'background:rgba(20,16,12,0.94)',
  'color:#e8dcc8',
  'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #5a4a36',
  'border-radius:5px',
  'pointer-events:none',
  'white-space:nowrap',
  'z-index:70',
  'display:none',
].join(';');

/** Which face the menu is showing: nothing, the default arms, or the profession picker. */
type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (from `?uiscale=`, shared with the tool panel); the menu geometry is multiplied by it. */
  readonly uiscale: number;
  /** The professions the picker offers as one-click job changes (content jobs minus idle). */
  readonly professions: readonly Profession[];
  /** Issue a `setJob` on every selected settler (the one-way command seam). */
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
}

export interface SettlerActions {
  /**
   * Per-frame: re-place the menu on the current selection's on-screen centroid (and show/hide it). Reads the
   * settlers' positions from the frame's already-built snapshot; only runs a scan while the menu is OPEN and
   * a settler is selected, so a closed menu costs nothing.
   */
  update(camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void;
  /** Toggle/step the menu (Space): closed→menu, jobs→menu (back out of the picker), menu→closed. */
  toggle(): void;
  /** Open the default action menu (e.g. a right-click on the settler) — idempotent to the `menu` face. */
  open(): void;
  isOpen(): boolean;
  /** Force-close (e.g. on a selection clear). */
  close(): void;
  /** True when a client point is over a visible menu button — the input router asks BEFORE world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/** One built button: its spec + the sprite (real art) or the fallback disc + the (invariant) atlas frame. */
interface ButtonVisual {
  readonly button: ActionButton;
  readonly sprite: PalettedSprite | null;
  readonly fallback: Graphics | null;
  /** The resolved atlas frame (real-art path) — captured once at build so `placeVisual` never re-resolves it. */
  readonly frame: AtlasFrame | null;
}

const paletteOfFrame = (gfx: number): GuiPaletteName => GUI_FRAMES[gfx]?.palette ?? 'context';

/**
 * Mount the settler action menu. Async because it loads the (optional) decoded GUI art; everything degrades
 * gracefully so a checkout without `content/` still boots and the menu stays usable (flat discs + tooltips).
 */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  const scale = Math.max(1, Math.floor(opts.uiscale));

  const [guiLayer, guiLut] = await Promise.all([
    loadGuiWindowIndexed().catch<SpriteLayer | null>(() => null),
    loadGuiPaletteLut().then((t) => t ?? null),
  ]);
  const hasArt = guiLayer !== null && guiLut !== null;
  const guiColours = guiLut?.pixelHeight ?? 1;

  // The two faces: the static default menu (built once from HUMAN_DEFAULT_MENU) and the profession picker's
  // job buttons (from content). Every button of both faces gets a retained visual keyed by identity.
  const jobButtons: readonly ActionButton[] = opts.professions.map(
    (p): ActionButton => ({ kind: 'job', jobType: p.jobType, icon: jobIconFrame(p.label), label: p.label }),
  );
  const allButtons: readonly ActionButton[] = [
    ...HUMAN_DEFAULT_MENU.flatMap((g) => g.buttons),
    ...jobButtons,
  ];

  const root = new Container();
  root.zIndex = RING_Z;
  root.visible = false;
  app.stage.addChild(root);
  const buttonContainer = new Container();
  const hoverG = new Graphics();
  root.addChild(buttonContainer, hoverG);

  const tooltip = el('div', TOOLTIP_STYLE);
  document.body.append(tooltip);

  // The order-icon sprite + its atlas frame for one button, or nulls when the art / frame is missing.
  const iconSprite = (frameName: string): { sprite: PalettedSprite; frame: AtlasFrame } | null => {
    if (!hasArt || guiLayer === null || guiLut === null) return null;
    const gfx = guiFrameIndex(frameName);
    const frame = guiLayer.atlas.frames.get(gfx);
    if (frame === undefined) return null;
    const sprite = new PalettedSprite(guiLut, guiColours);
    sprite.setFrame(guiLayer.source, frame, guiLayer.atlas.width, guiLayer.atlas.height);
    sprite.player = guiPaletteRow(paletteOfFrame(gfx));
    sprite.colorKey = true; // discard the GUI palettes' opaque background band (see PalettedSprite.colorKey)
    return { sprite, frame };
  };

  // Build every button's visual ONCE (retained graph — placed each frame, never re-created). Keyed by the
  // button object so `update` places by identity, robust to a face that shows only a subset of buttons.
  const visuals: ButtonVisual[] = [];
  const visualByButton = new Map<ActionButton, ButtonVisual>();
  for (const button of allButtons) {
    const art = iconSprite(button.icon);
    let fallback: Graphics | null = null;
    if (art === null) {
      fallback = new Graphics();
      buttonContainer.addChild(fallback);
    } else {
      buttonContainer.addChild(art.sprite);
    }
    const v: ButtonVisual = { button, sprite: art?.sprite ?? null, fallback, frame: art?.frame ?? null };
    visuals.push(v);
    visualByButton.set(button, v);
  }

  // --- State ----------------------------------------------------------------------------------------
  let mode: MenuMode = 'closed';
  let layout: ActionRingLayout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  /** The settler ids a click's command applies to (the selected SETTLERS, filtered in `update`). */
  let actionTargets: number[] = [];

  /** The selected settlers' on-screen centroid (canvas px), or null when none is selected. */
  const selectionCentre = (
    camera: Camera,
    snapshot: WorldSnapshot,
    selection: ReadonlySet<number>,
  ): { x: number; y: number; ids: number[] } | null => {
    let wx = 0;
    let wy = 0;
    const ids: number[] = [];
    for (const e of snapshot.entities) {
      if (!selection.has(e.id) || e.components.Settler === undefined) continue;
      const pos = e.components.Position as { x: number; y: number } | undefined;
      if (pos === undefined) continue;
      const s = tileToScreen(pos.x / ONE, pos.y / ONE); // the drawn feet anchor (world px)
      wx += s.x;
      wy += s.y;
      ids.push(e.id);
    }
    if (ids.length === 0) return null;
    const cameraScale = camera.scale ?? 1;
    return {
      x: (wx / ids.length) * cameraScale + camera.offsetX,
      y: (wy / ids.length) * cameraScale + camera.offsetY,
      ids,
    };
  };

  /**
   * Place one button's visual centred in its layout rect (the original's `SetCenterGraphicsFlag`), SNAPPED to
   * whole pixels. The centroid anchor is a float, so an un-snapped origin lands the small icon between screen
   * pixels — nearest-sampled, that drops/doubles texel columns (the "chipped + blurry" look). Rounding the
   * final screen origin to integers keeps the 1:1 texel mapping crisp.
   */
  const placeVisual = (v: ButtonVisual, rect: { x: number; y: number; w: number; h: number }): void => {
    const rw = app.screen.width;
    const rh = app.screen.height;
    if (v.sprite !== null && v.frame !== null) {
      // Centre the frame's WxH box in the rect: drawn-box centre = origin + scale·(offset + size/2).
      const originX = Math.round(rect.x + rect.w / 2 - (v.frame.offsetX + v.frame.width / 2) * scale);
      const originY = Math.round(rect.y + rect.h / 2 - (v.frame.offsetY + v.frame.height / 2) * scale);
      v.sprite.place(originX, originY, scale, rw, rh);
    } else if (v.fallback !== null) {
      const r = Math.min(rect.w, rect.h) / 2;
      v.fallback
        .clear()
        .circle(Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2), r)
        .fill(FALLBACK_FILL)
        .stroke({ color: FALLBACK_RIM, width: Math.max(1, scale) });
    }
  };

  /** The layout for the current mode + centre (the default arms, or the profession-picker grid). */
  const layoutFor = (m: MenuMode, cx: number, cy: number): ActionRingLayout => {
    const w = app.screen.width;
    const h = app.screen.height;
    if (m === 'jobs') return layoutJobPicker(jobButtons, cx, cy, scale, w, h);
    return layoutActionRing(HUMAN_DEFAULT_MENU, cx, cy, scale, w, h);
  };

  const hideAll = (): void => {
    for (const v of visuals) {
      if (v.sprite !== null) v.sprite.visible = false;
      if (v.fallback !== null) v.fallback.visible = false;
    }
  };

  const update = (camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void => {
    const centre = mode === 'closed' ? null : selectionCentre(camera, snapshot, selection);
    if (centre === null) {
      root.visible = false;
      layout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
      actionTargets = [];
      hideAll();
      return;
    }
    actionTargets = centre.ids;
    layout = layoutFor(mode, centre.x, centre.y);
    // Place by button IDENTITY (not index): each face shows only a subset of the built visuals, so hide every
    // visual first, then show + place only the buttons this frame's layout actually produced.
    hideAll();
    for (const placed of layout.buttons) {
      const v = visualByButton.get(placed.button);
      if (v === undefined) continue;
      if (v.sprite !== null) v.sprite.visible = true;
      if (v.fallback !== null) v.fallback.visible = true;
      placeVisual(v, placed.rect);
    }
    root.visible = true;
  };

  // --- Input (own listeners, mirroring the tool panel; registered before unit-controls' so a menu click wins) ---
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = backingScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (mode === 'closed' || !root.visible) return false;
    const { x, y } = toCanvas(clientX, clientY);
    // Claim only actual button squares — a click in the gap BETWEEN buttons (over the unit itself) still
    // reaches world picking, so the settler stays selectable/orderable through the open menu.
    return hitTestActionRing(layout, x, y) !== null;
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (mode === 'closed' || !root.visible || e.button !== 0) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(layout, x, y);
    if (hit === null) return;
    // A menu click is the menu's — stop it reaching world picking (we register before unit-controls). This
    // consumes a placeholder click too, so an inert button never falls through to a move/attack order.
    e.stopImmediatePropagation();
    if (hit.kind === 'open-jobs') {
      mode = 'jobs'; // swap the arms for the profession picker (re-placed next frame).
      hideTransient();
    } else if (hit.kind === 'job') {
      if (actionTargets.length > 0) opts.onSetJob(actionTargets, hit.jobType);
      mode = 'menu'; // picked — back to the default menu.
      hideTransient();
    }
    // kind 'placeholder' — consumed above, but its action is not yet implemented (inert on this slice).
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (mode === 'closed' || !root.visible) {
      hoverG.clear();
      tooltip.style.display = 'none';
      return;
    }
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(layout, x, y);
    hoverG.clear();
    if (hit === null) {
      tooltip.style.display = 'none';
      return;
    }
    const placed = layout.buttons.find((p) => p.button === hit);
    if (placed !== undefined) {
      hoverG
        .roundRect(placed.rect.x, placed.rect.y, placed.rect.w, placed.rect.h, Math.max(2, 3 * scale))
        .fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
    tooltip.textContent = hit.label;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 22}px`;
    tooltip.style.display = 'block';
  };

  const hideTransient = (): void => {
    hoverG.clear();
    tooltip.style.display = 'none';
  };

  // Register BEFORE unit-controls attaches its own canvas mousedown (this controller is mounted first), so a
  // click on a menu button consumes the event and never falls through to selection / a move order. The
  // `mouseleave` clears a hover highlight/tooltip that would otherwise linger when the cursor leaves the
  // canvas while still over a button (no further `mousemove` fires to clear it).
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', hideTransient);

  return {
    update,
    toggle: (): void => {
      // Space steps back out: closed→menu (open), jobs→menu (leave the picker), menu→closed.
      mode = mode === 'closed' ? 'menu' : mode === 'jobs' ? 'menu' : 'closed';
      if (mode === 'closed') {
        root.visible = false;
        hideTransient();
      }
    },
    open: (): void => {
      mode = 'menu'; // update() reveals it next frame off the current selection's centroid.
    },
    isOpen: (): boolean => mode !== 'closed',
    close: (): void => {
      mode = 'closed';
      root.visible = false;
      hideTransient();
    },
    claimsPointer,
    dispose: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', hideTransient);
      tooltip.remove();
      root.destroy({ children: true });
    },
  };
}
