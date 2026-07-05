import {
  type AtlasFrame,
  type Camera,
  PalettedSprite,
  type SpriteLayer,
  tileToScreen,
} from '@vinland/render';
import { ONE, type WorldSnapshot, systems } from '@vinland/sim';
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
  type ActionGroup,
  type ActionRingLayout,
  hitTestActionRing,
  jobIconFrame,
  layoutActionRing,
  stanceIconFrame,
} from '../hud/action-ring-layout.js';
import { backingScale } from './camera.js';
import { el } from './overlay.js';
import type { Profession } from './unit-panel.js';

/**
 * The settler ACTION RING — the contextual command buttons that fan out around the selected settler(s), in
 * original GUI art. It is the Pixi + input glue over the pure {@link import('../hud/action-ring-layout.js')}
 * geometry (the twin split of `hud/tool-panel*`): the layout module transcribes the original's radial arm
 * geometry and assigns each command a best-guess order-icon; this module draws those icons as
 * {@link PalettedSprite}s over the indexed `ls_gui_window` atlas (the round wooden order buttons, `context`
 * palette) and turns a click into a `setJob` / `setStance` through the callback seam — never touching sim
 * state (app-layer I/O, one-way flow).
 *
 * It is toggled with **Space** (the info card stays always-on) and anchored on the selected settlers'
 * on-screen centroid, re-placed every frame as the camera pans / the units move. When the decoded GUI art is
 * absent (a checkout that hasn't run the pipeline) it DEGRADES to flat `Graphics` discs at the exact same
 * geometry, staying visible and fully clickable — the tooltip (a DOM label) carries each button's meaning in
 * both modes.
 */

const { MILITARY_MODE } = systems;

/** The four player-selectable military stances the ring offers (NONE is the passive fallback, never offered). */
const STANCES: readonly { readonly mode: number; readonly label: string }[] = [
  { mode: MILITARY_MODE.ATTACK, label: 'Atak' },
  { mode: MILITARY_MODE.DEFEND, label: 'Obrona' },
  { mode: MILITARY_MODE.IGNORE, label: 'Ignoruj' },
  { mode: MILITARY_MODE.FLEE, label: 'Ucieczka' },
];

/** Professions fill the bottom arm (group-type 0); stances the top arm (group-type 1). See the layout module. */
const JOB_GROUP = 0;
const STANCE_GROUP = 1;

/** Draw the ring above the world (and the tool panel, which is on the far-left strip — they rarely overlap). */
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

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** Integer UI scale (from `?uiscale=`, shared with the tool panel); the ring geometry is multiplied by it. */
  readonly uiscale: number;
  /** The professions the ring offers as one-click job changes (content jobs minus idle). */
  readonly professions: readonly Profession[];
  /** Issue a `setJob` on every selected settler (the one-way command seam). */
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** Issue a `setStance` on every selected settler. */
  readonly onSetStance: (ids: readonly number[], mode: number) => void;
}

export interface SettlerActions {
  /**
   * Per-frame: re-place the ring on the current selection's on-screen centroid (and show/hide it). Reads the
   * settlers' positions from the frame's already-built snapshot; only runs a scan while the ring is OPEN and
   * a settler is selected, so a closed ring costs nothing.
   */
  update(camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void;
  /** Toggle the ring (Space); the info card is unaffected (always-on). */
  toggle(): void;
  isOpen(): boolean;
  /** Force-close (e.g. on a selection clear). */
  close(): void;
  /** True when a client point is over a visible ring button — the input router asks BEFORE world picking. */
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
 * Mount the settler action ring. Async because it loads the (optional) decoded GUI art; everything degrades
 * gracefully so a checkout without `content/` still boots and the ring stays usable (flat discs + tooltips).
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

  // The two command families as ring groups (built ONCE — professions come from content, stances are fixed).
  const groups: readonly ActionGroup[] = [
    {
      group: JOB_GROUP,
      buttons: opts.professions.map(
        (p): ActionButton => ({
          kind: 'job',
          jobType: p.jobType,
          icon: jobIconFrame(p.label),
          label: p.label,
        }),
      ),
    },
    {
      group: STANCE_GROUP,
      buttons: STANCES.map(
        (s): ActionButton => ({
          kind: 'stance',
          mode: s.mode,
          icon: stanceIconFrame(s.mode),
          label: s.label,
        }),
      ),
    },
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
  // button object so `update` places by identity, robust to a group the layout drops (an arm index it lacks).
  const visuals: ButtonVisual[] = [];
  const visualByButton = new Map<ActionButton, ButtonVisual>();
  for (const g of groups) {
    for (const button of g.buttons) {
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
  }

  // --- State ----------------------------------------------------------------------------------------
  let open = false;
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

  /** Place one button's visual centred in its layout rect (the original's `SetCenterGraphicsFlag`). */
  const placeVisual = (v: ButtonVisual, rect: { x: number; y: number; w: number; h: number }): void => {
    const rw = app.screen.width;
    const rh = app.screen.height;
    if (v.sprite !== null && v.frame !== null) {
      // Centre the frame's WxH box in the rect: drawn-box centre = origin + scale·(offset + size/2).
      const originX = rect.x + rect.w / 2 - (v.frame.offsetX + v.frame.width / 2) * scale;
      const originY = rect.y + rect.h / 2 - (v.frame.offsetY + v.frame.height / 2) * scale;
      v.sprite.place(originX, originY, scale, rw, rh);
    } else if (v.fallback !== null) {
      const r = Math.min(rect.w, rect.h) / 2;
      v.fallback
        .clear()
        .circle(rect.x + rect.w / 2, rect.y + rect.h / 2, r)
        .fill(FALLBACK_FILL)
        .stroke({ color: FALLBACK_RIM, width: Math.max(1, scale) });
    }
  };

  const update = (camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void => {
    if (!open) {
      root.visible = false;
      layout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
      actionTargets = [];
      return;
    }
    const centre = selectionCentre(camera, snapshot, selection);
    if (centre === null) {
      root.visible = false;
      layout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
      actionTargets = [];
      return;
    }
    actionTargets = centre.ids;
    layout = layoutActionRing(groups, centre.x, centre.y, scale, app.screen.width, app.screen.height);
    // Place by button IDENTITY (not index): the layout may drop a whole group whose arm index it lacks, so
    // hide every visual first, then show + place only the buttons this frame's layout actually produced.
    for (const v of visuals) {
      if (v.sprite !== null) v.sprite.visible = false;
      if (v.fallback !== null) v.fallback.visible = false;
    }
    for (const placed of layout.buttons) {
      const v = visualByButton.get(placed.button);
      if (v === undefined) continue;
      if (v.sprite !== null) v.sprite.visible = true;
      if (v.fallback !== null) v.fallback.visible = true;
      placeVisual(v, placed.rect);
    }
    root.visible = true;
  };

  // --- Input (own listeners, mirroring the tool panel; registered before unit-controls' so a ring click wins) ---
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } => {
    const { sx, sy, rect } = backingScale(canvas);
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  };

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (!open || !root.visible) return false;
    const { x, y } = toCanvas(clientX, clientY);
    // Claim only actual button squares — a click in the gap BETWEEN arms (over the unit itself) still
    // reaches world picking, so the settler stays selectable/orderable through the open ring.
    return hitTestActionRing(layout, x, y) !== null;
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (!open || !root.visible || e.button !== 0) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(layout, x, y);
    if (hit === null) return;
    // A ring click is the ring's — stop it reaching world picking (we register before unit-controls).
    e.stopImmediatePropagation();
    if (actionTargets.length === 0) return;
    if (hit.kind === 'job') opts.onSetJob(actionTargets, hit.jobType);
    else opts.onSetStance(actionTargets, hit.mode);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!open || !root.visible) {
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
  // click on a ring button consumes the event and never falls through to selection / a move order. The
  // `mouseleave` clears a hover highlight/tooltip that would otherwise linger when the cursor leaves the
  // canvas while still over a button (no further `mousemove` fires to clear it).
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', hideTransient);

  return {
    update,
    toggle: (): void => {
      open = !open;
      if (!open) {
        root.visible = false;
        hideTransient();
      }
    },
    isOpen: (): boolean => open,
    close: (): void => {
      open = false;
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
