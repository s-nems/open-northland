import { type Camera, tileToScreen } from '@open-northland/render';
import { ONE, systems, type WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import { JOB_SCOUT } from '../../game/sandbox/index.js';
import { loadGuiArt } from '../../content/gui-art.js';
import { loadUiFont } from '../../content/ui-font.js';
import {
  childOrderOf,
  entityById,
  hasEligiblePartner,
  isAdult,
  isFemale,
  isMarrying,
  isSettler,
  marriageOf,
  positionOf,
  settlerJobType,
} from '../../game/snapshot.js';
import {
  type ActionButton,
  type ActionRingLayout,
  actionRingScale,
  hitTestActionRing,
  layoutActionRing,
} from '../../hud/action-ring-layout.js';
import {
  ALL_MENU_BUTTONS,
  DEFAULT_MENU_STATE,
  menuForSettler,
  type SettlerMenuState,
} from '../../hud/action-ring-menu.js';
import { type Messages, messages } from '../../i18n/index.js';
import { clientToScreen } from '../camera.js';
import { el } from '../overlay.js';
import { createActionRingVisuals } from './action-ring-visuals.js';
import { createProfessionPicker } from './profession-picker.js';

/**
 * The settler action menu — the contextual command buttons that fan out around the selected settler(s), in
 * original GUI art. It is the Pixi + input glue over the pure {@link import('../hud/action-ring-layout.js')}
 * geometry (the twin split of `hud/tool-panel*`): the layout module transcribes the original's radial arm
 * footprint and assigns each command a best-guess order-icon; this module draws those icons as
 * {@link PalettedSprite}s over the indexed `ls_gui_window` atlas (the round wooden order buttons, `context`
 * palette) and turns a click into a `setJob` through the callback seam — never touching sim state (app-layer
 * I/O, one-way flow).
 *
 * We draw the whole default human menu (every arm of the original), rebuilt per frame from the selected
 * settler's state ({@link menuForSettler}): "change profession" (`open-jobs`) opens the scrollable
 * profession-picker window — a DOM panel styled to evoke the original's parchment/rope selection windows
 * (warm-wood fill, double rope-tan frame, engraved headline + close box, the shared serif face), kept DOM
 * so the grouped profession set scrolls with no Pixi masking; picking a row issues `setJob` and returns to
 * the menu. The family buttons are live too: `marry` (an unmarried eligible adult), `assign_house` (arms
 * the click-a-house pick mode), and the make-son/make-daughter pair (a married woman) — each issued
 * through its callback seam. The offered professions + their labels come from the shared
 * `catalog/professions.ts` roster + `i18n/`, so the picker and the details-panel label can't drift. The
 * remaining buttons are inert placeholders. Three modes: `closed` → `menu` (the default arms) → `jobs`
 * (the list window over the hidden ring).
 *
 * It is toggled with Space (the info card stays always-on) and anchored on the selected settlers'
 * on-screen centroid, re-placed every frame as the camera pans / the units move. The order buttons are drawn
 * with the `'round'` colour key, so each reads as a round disc (no square backdrop). When the decoded GUI art
 * is absent (a checkout that hasn't run the pipeline) it degrades to flat `Graphics` discs at the exact same
 * geometry, staying visible and fully clickable — the tooltip (a DOM label) carries each button's meaning.
 */

/** Draw the menu above the world (and the tool panel, which is on the far-left strip — they rarely overlap). */
const RING_Z = 1000;

/** The "no ring" layout — menu closed or nothing selected (no buttons, zero bounds). */
const EMPTY_LAYOUT: ActionRingLayout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };

/** Hover highlight over the button under the cursor. */
const HOVER_TINT = 0xffffff;
const HOVER_ALPHA = 0.28;

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
  /** UI scale (from `?uiscale=`, shared with the tool panel); the menu geometry is multiplied by it. May be fractional. */
  readonly uiscale: number;
  /** The grouped profession menu the picker offers (group headers + one-click profession rows). */
  readonly professions: readonly PickerEntry[];
  /** Issue a `setJob` on every selected settler (the one-way command seam). */
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** Arm the erect-signpost click-to-place mode for the selected scout(s) (the scout menu's button). */
  readonly onErectSignpost: (ids: readonly number[]) => void;
  /** Issue a `marry` order on the (single) selected settler. */
  readonly onMarry: (id: number) => void;
  /** Arm the click-a-house pick mode for the (single) selected settler. */
  readonly onAssignHouse: (id: number) => void;
  /** Issue a `makeChild` order of the chosen sex on the (single) selected woman. */
  readonly onMakeChild: (id: number, sex: 'male' | 'female') => void;
}

export interface SettlerActions {
  /**
   * Per-frame: re-place the menu on the current selection's on-screen centroid (and show/hide it). Reads the
   * settlers' positions from the frame's already-built snapshot; only runs a scan while the menu is open and
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
  /** True when a client point is over a visible menu button — the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/**
 * Mount the settler action menu. Async because it loads the (optional) decoded GUI art; everything degrades
 * gracefully so a checkout without `content/` still boots and the menu stays usable (flat discs + tooltips).
 */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  // The ring's effective scale: the shared uiscale, shrunk by the ring's own factor (see actionRingScale) —
  // the same value feeds the icon bake and layoutActionRing, so the drawn icon always fills its hit-rect.
  const scale = actionRingScale(opts.uiscale);

  const art = await loadGuiArt();

  // Every button any menu state can show (family + scout variants included) — the retained visuals are
  // baked once for the union, and each frame's layout places only the active state's subset. The
  // profession picker is a DOM list window (below), so the canvas holds just the menu buttons.
  const allButtons: readonly ActionButton[] = ALL_MENU_BUTTONS;

  const root = new Container();
  root.zIndex = RING_Z;
  root.visible = false;
  app.stage.addChild(root);
  const buttonContainer = new Container();
  const hoverG = new Graphics();
  root.addChild(buttonContainer, hoverG);

  const tooltip = el('div', TOOLTIP_STYLE);
  document.body.append(tooltip);

  // The retained button graphics (round order-icon discs, real art or flat fallback) — built once, placed
  // each frame by layout. See action-ring-visuals.ts.
  const visuals = createActionRingVisuals({
    app,
    art,
    scale,
    buttons: allButtons,
    container: buttonContainer,
  });

  // --- State ----------------------------------------------------------------------------------------
  let mode: MenuMode = 'closed';
  let layout: ActionRingLayout = EMPTY_LAYOUT;
  /** The settler ids a click's command applies to (the selected settlers, filtered in `update`). */
  let actionTargets: number[] = [];

  // --- The "Zmiana zawodu" profession picker window: a parchment DOM panel over the (hidden) ring ------
  // The serif UI face (shared with the details panel) — falls back to a serif stack until/if it resolves.
  const uiFont = await loadUiFont();
  const picker = createProfessionPicker({
    professions: opts.professions,
    uiFont,
    onPick: (jobType: number): void => {
      // Apply to whoever is selected right now (actionTargets is refreshed each frame in `update`).
      if (actionTargets.length > 0) opts.onSetJob(actionTargets, jobType);
      // Picking a profession commits the menu: close it entirely (list and ring), rather than stepping back
      // to the arms — the order is issued, so there is nothing left to do in the menu.
      closeMenu();
    },
    // The ✕ box / a backdrop click steps back to the ring (the twin of Escape), keeping the unit selected.
    onDismiss: (): void => closeJobWindow(),
  });

  /** Open the profession list over the (hidden) ring. */
  const openJobWindow = (): void => {
    mode = 'jobs';
    hideTransient();
    picker.show();
  };
  /** Hide the list; step back to the default menu (unless we're already closing to `closed`). */
  const closeJobWindow = (): void => {
    picker.hide();
    if (mode === 'jobs') mode = 'menu';
  };
  /**
   * Fully close the whole menu — the list and the ring, back to `closed`. The commit/teardown path (picking a
   * profession, or an external {@link SettlerActions.close}), as opposed to {@link closeJobWindow}'s "step back
   * to the ring" used by Escape / the ✕ box / a backdrop click. (`hideTransient` is defined below; this only
   * runs on user events after mount, so the forward reference is safe.)
   */
  const closeMenu = (): void => {
    picker.hide();
    mode = 'closed';
    root.visible = false;
    hideTransient();
  };

  /** The selected settlers' on-screen centroid (canvas px), or null when none is selected. */
  const selectionCentre = (
    camera: Camera,
    snapshot: WorldSnapshot,
    selection: ReadonlySet<number>,
  ): { x: number; y: number; ids: number[]; jobType: number | undefined } | null => {
    let wx = 0;
    let wy = 0;
    const ids: number[] = [];
    // The selection's common trade (undefined when mixed) — picks the per-profession menu variant.
    let jobType: number | undefined;
    let mixed = false;
    for (const e of snapshot.entities) {
      if (!selection.has(e.id) || !isSettler(e)) continue;
      const pos = positionOf(e);
      if (pos === undefined) continue;
      const s = tileToScreen(pos.x / ONE, pos.y / ONE); // the drawn feet anchor (world px)
      wx += s.x;
      wy += s.y;
      const job = settlerJobType(e);
      if (ids.length === 0) jobType = job;
      else if (job !== jobType) mixed = true;
      ids.push(e.id);
    }
    if (ids.length === 0) return null;
    const cameraScale = camera.scale ?? 1;
    return {
      x: (wx / ids.length) * cameraScale + camera.offsetX,
      y: (wy / ids.length) * cameraScale + camera.offsetY,
      ids,
      jobType: mixed ? undefined : jobType,
    };
  };

  /**
   * The menu state of the single selected settler — which per-state buttons (marry / assign home /
   * make son+daughter) its ring shows. A multi-selection (or a missing entity) shows none: the family
   * orders are per-settler, so they only surface when exactly one settler anchors the ring. The scout
   * swap (erect-signpost replaces alert/query) keys on the selection's UNIFORM jobType, so a multi-scout
   * selection keeps the button (the erect order takes several scouts).
   */
  const menuStateFor = (
    snapshot: WorldSnapshot,
    ids: readonly number[],
    uniformJobType: number | undefined,
  ): SettlerMenuState => {
    const erectSignpost = uniformJobType === JOB_SCOUT;
    if (ids.length !== 1 || ids[0] === undefined) return { ...DEFAULT_MENU_STATE, erectSignpost };
    const e = entityById(snapshot, ids[0]);
    if (e === undefined || !isSettler(e)) return { ...DEFAULT_MENU_STATE, erectSignpost };
    // A single selected child shows no change-profession button (its stage is the GrowthSystem's) and
    // no family buttons.
    if (!isAdult(e)) return { ...DEFAULT_MENU_STATE, canChangeJob: false, erectSignpost };
    const married = marriageOf(e);
    const onMission = systems.isOnMission(settlerJobType(e) ?? null);
    // The one-child limit: a living, still-growing child blocks a fresh order (a grown or dead child
    // frees it — the sim command re-validates either way; this only decides button visibility).
    const child = married?.child ?? null;
    const childEntity = child !== null ? entityById(snapshot, child) : undefined;
    const raisingChild = childEntity !== undefined && !isAdult(childEntity);
    return {
      canChangeJob: !isFemale(e), // women keep the woman role for life (the sim guards setJob too)
      // Marry only lights up when somebody eligible exists — otherwise the click would silently cancel.
      canMarry: married === undefined && !isMarrying(e) && !onMission && hasEligiblePartner(snapshot, e),
      canAssignHouse: true,
      canOrderChild: married !== undefined && isFemale(e) && !raisingChild && childOrderOf(e) === undefined,
      erectSignpost,
    };
  };

  const update = (camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void => {
    const centre = mode === 'closed' ? null : selectionCentre(camera, snapshot, selection);
    if (centre === null) {
      // Nothing selected (or menu closed): hide the ring, and close the list if it was open (it has no anchor).
      root.visible = false;
      layout = EMPTY_LAYOUT;
      actionTargets = [];
      visuals.hideAll();
      if (mode === 'jobs') closeJobWindow();
      return;
    }
    actionTargets = centre.ids;
    if (mode === 'jobs') {
      // The DOM list window is showing; keep the canvas ring hidden underneath it.
      root.visible = false;
      layout = EMPTY_LAYOUT;
      visuals.hideAll();
      return;
    }
    layout = layoutActionRing(
      menuForSettler(menuStateFor(snapshot, centre.ids, centre.jobType)),
      centre.x,
      centre.y,
      scale,
      app.screen.width,
      app.screen.height,
    );
    visuals.placeLayout(layout);
    root.visible = true;
  };

  // --- Input (own listeners, mirroring the tool panel; registered before unit-controls' so a menu click wins) ---
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToScreen(canvas, app.renderer.resolution, clientX, clientY);

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (mode === 'closed' || !root.visible) return false;
    const { x, y } = toCanvas(clientX, clientY);
    // Claim only actual button squares — a click in the gap between buttons (over the unit itself) still
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
    const single = actionTargets.length === 1 ? actionTargets[0] : undefined;
    if (hit.kind === 'open-jobs') {
      openJobWindow(); // swap the ring for the scrollable profession list window
    } else if (hit.kind === 'erect-signpost') {
      // Arm the click-to-place mode for the selected scout(s) and close the ring — the next world click
      // places the signpost (the "Select place for signpost" flow of the original).
      const targets = [...actionTargets];
      closeMenu();
      opts.onErectSignpost(targets);
    } else if (hit.kind === 'marry' && single !== undefined) {
      opts.onMarry(single);
      closeMenu(); // the order is issued — nothing left to do in the menu
    } else if (hit.kind === 'assign-house' && single !== undefined) {
      opts.onAssignHouse(single);
      closeMenu(); // hands off to the click-a-house pick mode
    } else if (hit.kind === 'make-child' && single !== undefined) {
      opts.onMakeChild(single, hit.sex);
      closeMenu();
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
    tooltip.textContent = messages().actionRing[hit.id as keyof Messages['actionRing']] ?? hit.id;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 22}px`;
    tooltip.style.display = 'block';
  };

  const hideTransient = (): void => {
    hoverG.clear();
    tooltip.style.display = 'none';
  };

  // These listeners register before unit-controls' (this controller is mounted first). The `mouseleave`
  // clears a hover highlight/tooltip that would otherwise linger when the cursor leaves the canvas while
  // still over a button (no further `mousemove` fires to clear it).
  // Escape backs out of the open profession list (the twin of a backdrop click / Space). It must stop here:
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
    close: closeMenu,
    claimsPointer,
    dispose: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', hideTransient);
      window.removeEventListener('keydown', onKeyDown);
      tooltip.remove();
      picker.dispose();
      visuals.dispose(); // free each baked icon's off-screen texture
      root.destroy({ children: true });
    },
  };
}
