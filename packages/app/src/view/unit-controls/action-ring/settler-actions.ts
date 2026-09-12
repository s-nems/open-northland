import { type Camera, cameraScreenX, cameraScreenY } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { loadGuiArt } from '../../../content/gui-art.js';
import { loadUiFont } from '../../../content/ui-font.js';
import {
  ACTION_COMMANDS,
  type ActionGroup,
  type ActionRingLayout,
  actionRingMenu,
  actionRingScale,
  layoutActionRing,
} from '../../../hud/action-ring/index.js';
import { clientToScreen } from '../../camera/index.js';
import { el } from '../../overlay.js';
import { createActionRingVisuals } from './action-ring-visuals.js';
import { createActionRingInput } from './input.js';
import { allowedActions } from './menu-state.js';
import { createProfessionPicker } from './profession-picker.js';
import type { MenuMode, SettlerActions, SettlerActionsOptions } from './types.js';

/**
 * Pixi and input glue over the pure action-ring layout: it draws the order buttons in original GUI art
 * and turns a click into a command through the callback seams, never touching sim state. It owns the
 * mode and anchor state machine; without decoded GUI art the buttons degrade to flat discs at the same
 * geometry.
 */

/** Drawn above the world layer. */
const RING_Z = 1000;

/** The "no ring" layout: menu closed or nothing selected. */
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

/** Mount the settler action menu. Async because it loads the optional decoded GUI art. */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  // The same value feeds the icon bake and the layout, so a drawn icon always fills its hit-rect.
  const scale = actionRingScale(opts.uiscale);

  /** Client (CSS) point to canvas px, the space the layout and every hit-test work in. */
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToScreen(canvas, app.renderer.resolution, clientX, clientY);

  const [art, uiFont] = await Promise.all([loadGuiArt(), loadUiFont()]);

  const root = new Container();
  const cleanup: Array<() => void> = [() => root.destroy({ children: true })];
  try {
    root.zIndex = RING_Z;
    root.visible = false;
    app.stage.addChild(root);
    const buttonContainer = new Container();
    const hoverG = new Graphics();
    root.addChild(buttonContainer, hoverG);

    const tooltip = el('div', TOOLTIP_STYLE);
    document.body.append(tooltip);
    cleanup.push(() => tooltip.remove());

    // Every order bakes once; each frame's layout places only the subset the selection allows.
    const visuals = createActionRingVisuals({
      app,
      art,
      scale,
      commands: ACTION_COMMANDS,
      container: buttonContainer,
    });
    cleanup.push(() => visuals.dispose());

    let mode: MenuMode = 'closed';
    let layout: ActionRingLayout = EMPTY_LAYOUT;
    /** The settler ids a click's command applies to, refreshed in `update`. */
    let actionTargets: readonly number[] = [];
    /** Where the menu is pinned, in screen (canvas) px, captured once when it opens so neither the settler
     *  walking on nor a camera pan moves it. Observation: the original keeps its ring on the cursor
     *  position it opened at. */
    let anchor: { readonly x: number; readonly y: number } | null = null;
    /** The arms of the open session, rebuilt only when the selection changes. Observation: the original
     *  builds its ring once at bring-up, so a gate flipping under an open ring does not reflow the arms. */
    let menu: { readonly ids: readonly number[]; readonly groups: readonly ActionGroup[] } | null = null;
    let restoredJobs = false;
    let restoredPickerScrollTop = 0;

    const hideTransient = (): void => {
      hoverG.clear();
      tooltip.style.display = 'none';
    };

    const picker = createProfessionPicker({
      professions: opts.professions,
      uiFont,
      onPick: (jobType: number): void => {
        if (actionTargets.length > 0) opts.onSetJob(actionTargets, jobType);
        // Picking commits the order, so the whole menu closes rather than stepping back to the arms.
        closeMenu();
      },
      // Steps back to the ring, keeping the unit selected.
      onDismiss: (): void => closeJobWindow(),
    });
    cleanup.push(() => picker.dispose());

    /** Open the profession list over the hidden ring, with availability for the current selection. */
    const openJobWindow = (): void => {
      mode = 'jobs';
      hideTransient();
      picker.show(
        (jobType) => opts.jobUnlocked(actionTargets, jobType),
        (jobType) => opts.jobBlockedReason?.(actionTargets, jobType) ?? '',
      );
    };
    /** Hide the list and step back to the default menu. */
    const closeJobWindow = (): void => {
      picker.hide();
      if (mode === 'jobs') mode = 'menu';
    };
    /** Close the list and the ring back to `closed`, the commit and teardown path. */
    const closeMenu = (): void => {
      picker.hide();
      mode = 'closed';
      anchor = null; // no anchor means no open session, and this is the only place `closed` is entered
      menu = null;
      root.visible = false;
      hideTransient();
    };

    /**
     * Open the default arms, pinned on `atClient` when the caller has a cursor; a re-open always re-pins.
     * Without a cursor the anchor stays null and the next frame's update pins the centroid.
     */
    const openMenu = (atClient?: { readonly x: number; readonly y: number }): void => {
      closeJobWindow(); // a fresh open shows the default arms, never a stale list
      mode = 'menu';
      anchor = atClient === undefined ? null : toCanvas(atClient.x, atClient.y);
      menu = null;
    };

    const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    const update = (camera: Camera, snapshot: WorldSnapshot): void => {
      const centre = mode === 'closed' ? null : opts.selectionCentre(snapshot);
      if (centre === null) {
        root.visible = false;
        layout = EMPTY_LAYOUT;
        actionTargets = [];
        anchor = null;
        menu = null;
        visuals.hideAll();
        if (mode === 'jobs') closeJobWindow();
        return;
      }
      actionTargets = centre.ids;
      if (mode === 'jobs') {
        if (restoredJobs) {
          picker.show(
            (jobType) => opts.jobUnlocked(actionTargets, jobType),
            (jobType) => opts.jobBlockedReason?.(actionTargets, jobType) ?? '',
          );
          picker.setScrollTop(restoredPickerScrollTop);
          restoredJobs = false;
        }
        picker.refresh();
        // Keep the canvas ring hidden under the DOM list window.
        root.visible = false;
        layout = EMPTY_LAYOUT;
        visuals.hideAll();
        return;
      }
      // Space opens with no cursor to pin to. Approximation: the selection's centroid stands in, projected
      // on the session's first frame and then frozen like any other anchor.
      anchor ??= { x: cameraScreenX(camera, centre.x), y: cameraScreenY(camera, centre.y) };
      if (menu === null || !sameIds(menu.ids, centre.ids)) {
        menu = {
          ids: centre.ids,
          groups: actionRingMenu(allowedActions(opts.content, snapshot, centre.ids)),
        };
      }
      layout = layoutActionRing(menu.groups, anchor.x, anchor.y, scale, app.screen.width, app.screen.height);
      visuals.placeLayout(layout);
      root.visible = true;
    };

    // Click routing is order-independent: unit-controls asks `claimsPointer` before world picking.
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
      onCommand: opts.onCommand,
      openJobWindow,
      closeMenu,
    });
    cleanup.push(() => input.dispose());

    return {
      update,
      toggle: (): void => {
        if (mode === 'jobs') closeJobWindow();
        else if (mode === 'menu') closeMenu();
        else openMenu(); // no cursor on the Space path, so `update` pins the centroid next frame
      },
      open: openMenu,
      close: closeMenu,
      claimsPointer: input.claimsPointer,
      handleEscape: (): boolean => {
        if (mode !== 'jobs') return false;
        closeJobWindow();
        return true;
      },
      state: () => ({ mode, anchor, pickerScrollTop: picker.scrollTop() }),
      restore: (state): void => {
        picker.hide();
        mode = state.mode;
        anchor = state.anchor;
        menu = null;
        restoredJobs = mode === 'jobs';
        restoredPickerScrollTop = state.pickerScrollTop;
        root.visible = false;
        layout = EMPTY_LAYOUT;
        visuals.hideAll();
        hideTransient();
      },
      dispose: (): void => {
        input.dispose();
        tooltip.remove();
        picker.dispose();
        visuals.dispose();
        root.destroy({ children: true });
      },
    };
  } catch (error: unknown) {
    for (let i = cleanup.length - 1; i >= 0; i--) cleanup[i]?.();
    throw error;
  }
}
