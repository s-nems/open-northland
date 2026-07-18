import { type Camera, cameraScreenX, cameraScreenY } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { loadGuiArt } from '../../../content/gui-art.js';
import { loadUiFont } from '../../../content/ui-font.js';
import {
  type ActionButton,
  type ActionRingLayout,
  actionRingScale,
  layoutActionRing,
} from '../../../hud/action-ring-layout.js';
import { ALL_MENU_BUTTONS, menuForSettler } from '../../../hud/action-ring-menu.js';
import { clientToScreen } from '../../camera/index.js';
import { el } from '../../overlay.js';
import { createActionRingVisuals } from './action-ring-visuals.js';
import { createActionRingInput } from './input.js';
import { menuStateFor } from './menu-state.js';
import { createProfessionPicker } from './profession-picker.js';
import { selectionCentre } from './selection-centre.js';
import type { MenuMode, SettlerActions, SettlerActionsOptions } from './types.js';

/**
 * The settler action menu — the contextual command buttons that fan out around the selected settler(s), in
 * original GUI art. It is the Pixi + input glue over the pure {@link import('../../hud/action-ring-layout.js')}
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
 * It is brought up by a right-click on the settler or by Space (the info card stays always-on), and holds
 * the screen spot it opened on until it closes — see {@link anchor}. The order buttons are drawn
 * with the `'round'` colour key, so each reads as a round disc (no square backdrop). When the decoded GUI art
 * is absent (a checkout that hasn't run the pipeline) it degrades to flat `Graphics` discs at the exact same
 * geometry, staying visible and fully clickable — the tooltip (a DOM label) carries each button's meaning.
 *
 * The pure pieces live beside this glue: the selection centroid projection ({@link selectionCentre}), the
 * per-settler button derivation ({@link menuStateFor}), and the pointer/keyboard controller
 * ({@link createActionRingInput}). This module owns the mode/anchor state machine that ties them together.
 */

/** Draw the menu above the world (and the tool panel, which is on the far-left strip — they rarely overlap). */
const RING_Z = 1000;

/** The "no ring" layout — menu closed or nothing selected (no buttons, zero bounds). */
const EMPTY_LAYOUT: ActionRingLayout = { buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };

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

/**
 * Mount the settler action menu. Async because it loads the (optional) decoded GUI art; everything degrades
 * gracefully so a checkout without `content/` still boots and the menu stays usable (flat discs + tooltips).
 */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  // The ring's effective scale: the shared uiscale, shrunk by the ring's own factor (see actionRingScale) —
  // the same value feeds the icon bake and layoutActionRing, so the drawn icon always fills its hit-rect.
  const scale = actionRingScale(opts.uiscale);

  /** Client (CSS) point → canvas px — the space the layout and every hit-test work in. */
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToScreen(canvas, app.renderer.resolution, clientX, clientY);

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
  /**
   * Where the menu is pinned, in SCREEN (canvas) px — captured once when it opens and held for the rest of
   * the open session (null = not anchored yet / closed), so neither the settler walking on nor a camera pan
   * moves it. Source basis: the original stores the cursor at bring-up and rebuilds the menu box at those
   * desktop coords, never reprojecting (`Selection_ActionButtons_BringUp` → `_selectionActionButtonsMouseX/Y`,
   * consumed by the `SRectangle(x-0x74, y-0x74, 0xE8, 0xE8)` + `PlaceInside(desktop)` layout).
   */
  let anchor: { readonly x: number; readonly y: number } | null = null;

  /** Clear the hover highlight + tooltip (shared by the mode helpers and the input controller). */
  const hideTransient = (): void => {
    hoverG.clear();
    tooltip.style.display = 'none';
  };

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
   * to the ring" used by Escape / the ✕ box / a backdrop click.
   */
  const closeMenu = (): void => {
    picker.hide();
    mode = 'closed';
    anchor = null; // "no anchor ⟺ no open session" — the one place `closed` is entered
    root.visible = false;
    hideTransient();
  };

  /**
   * Open (or re-open) the default arms, pinned on `atClient` when the caller has a cursor to give — a
   * re-open always re-pins, so right-clicking a settler the menu has drifted away from brings it back.
   * Without a cursor the anchor stays null and {@link update} pins the centroid on the next frame.
   */
  const openMenu = (atClient?: { readonly x: number; readonly y: number }): void => {
    closeJobWindow(); // a fresh open shows the default arms, never a stale list
    mode = 'menu';
    anchor = atClient === undefined ? null : toCanvas(atClient.x, atClient.y);
  };

  const update = (camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void => {
    const centre = mode === 'closed' ? null : selectionCentre(snapshot, selection);
    if (centre === null) {
      // Nothing selected (or menu closed): hide the ring, and close the list if it was open (it has no anchor).
      root.visible = false;
      layout = EMPTY_LAYOUT;
      actionTargets = [];
      anchor = null;
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
    // Space opens with no cursor to pin to, so the selection's centroid stands in — projected here, on the
    // first frame of the session, and then frozen like any other anchor. (The right-click path pins the
    // cursor itself, as the original does; Space is a project-added binding, so the centroid is a named
    // approximation of an anchor the original never had to choose.)
    anchor ??= { x: cameraScreenX(camera, centre.x), y: cameraScreenY(camera, centre.y) };
    layout = layoutActionRing(
      menuForSettler(menuStateFor(snapshot, centre.ids, centre.jobType)),
      anchor.x,
      anchor.y,
      scale,
      app.screen.width,
      app.screen.height,
    );
    visuals.placeLayout(layout);
    root.visible = true;
  };

  // The ring's own pointer + keyboard listeners (registered before unit-controls' so a menu click wins). The
  // controller reads the live mode/layout/targets through these getters and drives the command + state seams.
  const input = createActionRingInput({
    canvas,
    scale,
    hoverG,
    tooltip,
    toCanvas,
    getMode: () => mode,
    isRingVisible: () => root.visible,
    getLayout: () => layout,
    getTargets: () => actionTargets,
    hideTransient,
    onErectSignpost: opts.onErectSignpost,
    onMarry: opts.onMarry,
    onAssignHouse: opts.onAssignHouse,
    onMakeChild: opts.onMakeChild,
    openJobWindow,
    closeMenu,
    closeJobWindow,
  });

  return {
    update,
    toggle: (): void => {
      // Space steps back out: jobs→menu (leave the list), else closed→menu (open) / menu→closed.
      if (mode === 'jobs') closeJobWindow();
      else if (mode === 'menu') closeMenu();
      else openMenu(); // no cursor on the Space path: update() pins the centroid next frame
    },
    open: openMenu,
    close: closeMenu,
    claimsPointer: input.claimsPointer,
    dispose: (): void => {
      input.dispose();
      tooltip.remove();
      picker.dispose();
      visuals.dispose(); // free each baked icon's off-screen texture
      root.destroy({ children: true });
    },
  };
}
