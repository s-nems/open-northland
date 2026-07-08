import { type Camera, tileToScreen } from '@vinland/render';
import { ONE, type WorldSnapshot } from '@vinland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import { type GuiSprite, loadGuiArt, makeGuiSprite } from '../content/gui-art.js';
import { guiFrameIndex } from '../content/gui-atlas-map.js';
import {
  type ActionButton,
  type ActionRingLayout,
  HUMAN_DEFAULT_MENU,
  actionRingScale,
  hitTestActionRing,
  layoutActionRing,
} from '../hud/action-ring-layout.js';
import { type BakedIcon, bakeRoundIcon, placeBakedIcon } from '../hud/icon-texture.js';
import { backingScale } from './camera.js';
import { el } from './overlay.js';
import { isSettler, positionOf } from './snapshot.js';
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
 * (`open-jobs`) is wired on this slice: clicking it opens a scrollable profession-list WINDOW (a plain DOM
 * panel — the "simple form" the user asked for, graphics to be polished later); picking a row issues `setJob`
 * and returns to the menu. Every other button is an inert placeholder (drawn + tooltipped, does nothing) — the
 * future "implement the action" pass wires them (and the warrior/scout menu variants). Three modes: `closed`
 * → `menu` (the default arms) → `jobs` (the list window over the hidden ring).
 *
 * It is toggled with **Space** (the info card stays always-on) and anchored on the selected settlers'
 * on-screen centroid, re-placed every frame as the camera pans / the units move. The order buttons are drawn
 * with the `'round'` colour key, so each reads as a round disc (no square backdrop). When the decoded GUI art
 * is absent (a checkout that hasn't run the pipeline) it DEGRADES to flat `Graphics` discs at the exact same
 * geometry, staying visible and fully clickable — the tooltip (a DOM label) carries each button's meaning.
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

// --- The "change profession" list window (a plain DOM panel — the "simple form" the user asked for) --------
/** Full-screen click-catcher behind the window: a click anywhere off the window closes it (modal dismiss). */
const JOB_BACKDROP_STYLE = ['position:fixed', 'inset:0', 'z-index:80', 'display:none'].join(';');
/** The centred parchment window that holds the title + the scrollable profession list. */
const JOB_WINDOW_STYLE = [
  'position:fixed',
  'top:50%',
  'left:50%',
  'transform:translate(-50%,-50%)',
  'min-width:200px',
  'max-width:280px',
  'box-sizing:border-box',
  'padding:10px 12px',
  'background:rgba(20,16,12,0.97)',
  'color:#e8dcc8',
  'font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #6b5840',
  'border-radius:8px',
  'box-shadow:0 8px 28px rgba(0,0,0,0.5)',
  'z-index:81',
  'display:none',
].join(';');
const JOB_TITLE_STYLE = 'font-weight:700;font-size:14px;margin-bottom:8px';
/** The scrollable list: caps its height so a long profession set scrolls instead of overflowing the screen. */
const JOB_LIST_STYLE = 'display:flex;flex-direction:column;gap:4px;max-height:44vh;overflow-y:auto';
const JOB_ROW_STYLE = [
  'cursor:pointer',
  'text-align:left',
  'background:#3a2f22',
  'color:#e8dcc8',
  'border:1px solid #6b5840',
  'border-radius:5px',
  'padding:6px 10px',
  'font:13px ui-monospace,monospace',
].join(';');
const JOB_ROW_HOVER = '#5a4a30';
const JOB_ROW_BG = '#3a2f22';

/** Which face the menu is showing: nothing, the default arms, or the profession picker. */
type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (from `?uiscale=`, shared with the tool panel); the menu geometry is multiplied by it. May be fractional. */
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

/** One built button: its spec + the supersampled baked icon (real art) or the flat fallback disc. */
interface ButtonVisual {
  readonly button: ActionButton;
  /** The crisp, supersampled order-icon (real-art path) — baked ONCE, re-placed each frame. */
  readonly icon: BakedIcon | null;
  readonly fallback: Graphics | null;
}

/**
 * Mount the settler action menu. Async because it loads the (optional) decoded GUI art; everything degrades
 * gracefully so a checkout without `content/` still boots and the menu stays usable (flat discs + tooltips).
 */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  // The ring's effective scale: the shared uiscale, shrunk by the ring's own factor (see actionRingScale) —
  // the SAME value feeds the icon bake and layoutActionRing, so the drawn icon always fills its hit-rect.
  const scale = actionRingScale(opts.uiscale);

  const art = await loadGuiArt();

  // The static default menu (built once from HUMAN_DEFAULT_MENU) — the only face drawn on the canvas. The
  // profession picker is now a DOM list window (below), so the canvas holds just the menu buttons.
  const allButtons: readonly ActionButton[] = HUMAN_DEFAULT_MENU.flatMap((g) => g.buttons);

  const root = new Container();
  root.zIndex = RING_Z;
  root.visible = false;
  app.stage.addChild(root);
  const buttonContainer = new Container();
  const hoverG = new Graphics();
  root.addChild(buttonContainer, hoverG);

  const tooltip = el('div', TOOLTIP_STYLE);
  document.body.append(tooltip);

  // The order-icon sprite + its atlas frame for one button, or null when the art / frame is missing.
  // 'round' key: hard-clip everything outside the inscribed disc, dropping the square frame + corners so the
  // button reads as a round wooden disc (the original has no square behind it) while keeping the engraved
  // glyph intact. The hard clip aliases unless supersampled, so every icon goes through `bakeRoundIcon`
  // below (bake + downscale). See PalettedSprite.colorKey / GuiColorKey.
  const iconSprite = (frameName: string): GuiSprite | null =>
    art === null
      ? null
      : makeGuiSprite(art, guiFrameIndex(frameName), { defaultPalette: 'context', colorKey: 'round' });

  // Build every button's visual ONCE (retained graph — placed each frame, never re-created). Keyed by the
  // button object so `update` places by identity, robust to a face that shows only a subset of buttons.
  const visuals: ButtonVisual[] = [];
  const visualByButton = new Map<ActionButton, ButtonVisual>();
  for (const button of allButtons) {
    const art = iconSprite(button.icon);
    let icon: BakedIcon | null = null;
    let fallback: Graphics | null = null;
    if (art === null) {
      fallback = new Graphics();
      buttonContainer.addChild(fallback);
    } else {
      // Supersample the round order-icon into a texture (crisp at the fractional UI scale — see
      // hud/icon-texture.ts); the display sprite is what the scene graph draws + re-places each frame.
      icon = bakeRoundIcon({ app, sprite: art.sprite, frame: art.frame, scale });
      buttonContainer.addChild(icon.display);
    }
    const v: ButtonVisual = { button, icon, fallback };
    visuals.push(v);
    visualByButton.set(button, v);
  }

  // --- State ----------------------------------------------------------------------------------------
  let mode: MenuMode = 'closed';
  let layout: ActionRingLayout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };
  /** The settler ids a click's command applies to (the selected SETTLERS, filtered in `update`). */
  let actionTargets: number[] = [];

  // --- The "Zmiana zawodu" (change-profession) list window: a DOM panel, built once from the professions ----
  const jobBackdrop = el('div', JOB_BACKDROP_STYLE);
  const jobWindow = el('div', JOB_WINDOW_STYLE);
  jobWindow.append(el('div', JOB_TITLE_STYLE, 'Zmiana zawodu'));
  const jobList = el('div', JOB_LIST_STYLE);
  for (const p of opts.professions) {
    const row = el('button', JOB_ROW_STYLE, p.label);
    row.addEventListener('mouseenter', () => {
      row.style.background = JOB_ROW_HOVER;
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = JOB_ROW_BG;
    });
    row.addEventListener('click', () => {
      // Apply to whoever is selected right now (actionTargets is refreshed each frame in `update`).
      if (actionTargets.length > 0) opts.onSetJob(actionTargets, p.jobType);
      closeJobWindow();
    });
    jobList.append(row);
  }
  jobWindow.append(jobList);
  document.body.append(jobBackdrop, jobWindow);

  /** Open the profession list over the (hidden) ring. */
  const openJobWindow = (): void => {
    mode = 'jobs';
    hideTransient();
    jobBackdrop.style.display = 'block';
    jobWindow.style.display = 'block';
  };
  /** Hide the list; step back to the default menu (unless we're already closing to `closed`). */
  const closeJobWindow = (): void => {
    jobBackdrop.style.display = 'none';
    jobWindow.style.display = 'none';
    if (mode === 'jobs') mode = 'menu';
  };
  // A click on the backdrop (anywhere off the window) dismisses it — the standard modal behaviour.
  jobBackdrop.addEventListener('mousedown', closeJobWindow);

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
      if (!selection.has(e.id) || !isSettler(e)) continue;
      const pos = positionOf(e);
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
   * Place one button's visual centred in its layout rect (the original's `SetCenterGraphicsFlag`). The baked
   * icon is a scene-graph sprite, centred + pixel-snapped by {@link placeBakedIcon}; the flat fallback draws
   * a disc at the same centre.
   */
  const placeVisual = (v: ButtonVisual, rect: { x: number; y: number; w: number; h: number }): void => {
    if (v.icon !== null) {
      placeBakedIcon(v.icon, rect);
    } else if (v.fallback !== null) {
      const r = Math.min(rect.w, rect.h) / 2;
      v.fallback
        .clear()
        .circle(Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2), r)
        .fill(FALLBACK_FILL)
        .stroke({ color: FALLBACK_RIM, width: Math.max(1, scale) });
    }
  };

  const EMPTY_LAYOUT: ActionRingLayout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };

  const hideAll = (): void => {
    for (const v of visuals) {
      if (v.icon !== null) v.icon.display.visible = false;
      if (v.fallback !== null) v.fallback.visible = false;
    }
  };

  const update = (camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void => {
    const centre = mode === 'closed' ? null : selectionCentre(camera, snapshot, selection);
    if (centre === null) {
      // Nothing selected (or menu closed): hide the ring, and close the list if it was open (it has no anchor).
      root.visible = false;
      layout = EMPTY_LAYOUT;
      actionTargets = [];
      hideAll();
      if (mode === 'jobs') closeJobWindow();
      return;
    }
    actionTargets = centre.ids;
    if (mode === 'jobs') {
      // The DOM list window is showing; keep the canvas ring hidden underneath it.
      root.visible = false;
      layout = EMPTY_LAYOUT;
      hideAll();
      return;
    }
    layout = layoutActionRing(
      HUMAN_DEFAULT_MENU,
      centre.x,
      centre.y,
      scale,
      app.screen.width,
      app.screen.height,
    );
    // Place by button IDENTITY (not index): hide every visual first, then show + place only the buttons this
    // frame's layout actually produced.
    hideAll();
    for (const placed of layout.buttons) {
      const v = visualByButton.get(placed.button);
      if (v === undefined) continue;
      if (v.icon !== null) v.icon.display.visible = true;
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
    if (mode !== 'menu' || !root.visible || e.button !== 0) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(layout, x, y);
    if (hit === null) return;
    // A menu click is the menu's — stop it reaching world picking (we register before unit-controls). This
    // consumes a placeholder click too, so an inert button never falls through to a move/attack order.
    e.stopImmediatePropagation();
    if (hit.kind === 'open-jobs') {
      openJobWindow(); // swap the ring for the scrollable profession list window
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
  // Escape backs out of the open profession list (the twin of a backdrop click / Space). It must STOP here:
  // unit-controls also listens for Escape on `window` (to clear the selection), and we registered first — so
  // without stopImmediatePropagation an Escape over the list would also deselect the unit and close the whole
  // menu, when it should only step back to the ring with the unit still selected.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && mode === 'jobs') {
      e.stopImmediatePropagation();
      closeJobWindow();
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', hideTransient);
  window.addEventListener('keydown', onKeyDown);

  return {
    update,
    toggle: (): void => {
      // Space steps back out: jobs→menu (leave the list), else closed→menu (open) / menu→closed.
      if (mode === 'jobs') {
        closeJobWindow();
        return;
      }
      mode = mode === 'closed' ? 'menu' : 'closed';
      if (mode === 'closed') {
        root.visible = false;
        hideTransient();
      }
    },
    open: (): void => {
      closeJobWindow(); // a fresh open shows the default menu, never a stale list
      mode = 'menu'; // update() reveals it next frame off the current selection's centroid.
    },
    isOpen: (): boolean => mode !== 'closed',
    close: (): void => {
      jobBackdrop.style.display = 'none';
      jobWindow.style.display = 'none';
      mode = 'closed';
      root.visible = false;
      hideTransient();
    },
    claimsPointer,
    dispose: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', hideTransient);
      window.removeEventListener('keydown', onKeyDown);
      tooltip.remove();
      jobWindow.remove();
      jobBackdrop.remove();
      for (const v of visuals) v.icon?.dispose(); // free each baked icon's off-screen texture
      root.destroy({ children: true });
    },
  };
}
