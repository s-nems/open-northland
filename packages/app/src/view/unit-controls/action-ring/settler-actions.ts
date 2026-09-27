import { type Camera, cameraScreenX, cameraScreenY } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { loadGuiArt } from '../../../content/gui-art.js';
import {
  ACTION_COMMANDS,
  type ActionGroup,
  type ActionRingLayout,
  actionRingMenu,
  actionRingScale,
  layoutActionRing,
} from '../../../hud/action-ring/index.js';
import { HUD_DOM_Z } from '../../../hud/dom/root.js';
import { clientToScreen, screenScale } from '../../camera/index.js';
import { el } from '../../overlay.js';
import { createActionRingVisuals } from './action-ring-visuals.js';
import { createActionRingInput } from './input.js';
import { allowedActions } from './menu-state.js';
import { createProfessionPicker } from './profession-picker.js';
import type { MenuMode, RingAnchor, RingPin, SettlerActions, SettlerActionsOptions } from './types.js';

/**
 * DOM and input glue over the pure action-ring layout: it draws the order buttons in original GUI art
 * and turns a click into a command through the callback seams, never touching sim state. It owns the
 * mode and anchor state machine; without decoded GUI art the buttons degrade to flat discs at the same
 * geometry.
 */

/** Just above the DOM HUD: a ring opened from the settler panel stands over it, and so does one opened
 *  before a window, since the ring is the last thing the player called up and closes on any order,
 *  Space or Escape. */
const RING_Z = HUD_DOM_Z + 1;

const LAYER_STYLE = ['position:fixed', 'inset:0', 'pointer-events:none', `z-index:${RING_Z}`].join(';');

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

/** Where the button's name stands from the cursor, in client px: beside it and just above. */
const TIP_OFFSET = { x: 12, y: -22 } as const;

/** Mount the settler action menu. Async because it loads the optional decoded GUI art. */
export async function mountSettlerActions(opts: SettlerActionsOptions): Promise<SettlerActions> {
  const { app, canvas } = opts;
  // The same value feeds the icon bake and the layout, so a drawn icon always fills its hit-rect.
  const scale = actionRingScale(opts.uiscale);

  /** Client (CSS) point to canvas px, the space the layout and every hit-test work in. */
  const toCanvas = (clientX: number, clientY: number): { x: number; y: number } =>
    clientToScreen(canvas, app.renderer.resolution, clientX, clientY);

  const art = await loadGuiArt();

  const layer = el('div', LAYER_STYLE);
  layer.className = 'on-ring';
  layer.hidden = true;
  const cleanup: Array<() => void> = [() => layer.remove()];
  try {
    document.body.append(layer);

    const tooltip = el('div', TOOLTIP_STYLE);
    document.body.append(tooltip);
    cleanup.push(() => tooltip.remove());

    // Every order bakes once; each frame's layout places only the subset the selection allows.
    const visuals = createActionRingVisuals({
      app,
      art,
      scale,
      commands: ACTION_COMMANDS,
      layer,
      onPress: (command, event) => input.press(command, event),
      onHover: (command, event) => input.hover(command, event),
    });
    cleanup.push(() => visuals.dispose());

    let mode: MenuMode = 'closed';
    let layout: ActionRingLayout = EMPTY_LAYOUT;
    /** The selected settler ids the open menu serves, refreshed in `update`. */
    let selectedIds: readonly number[] = [];
    /** Where the menu is pinned, in screen (canvas) px, captured once when it opens so neither the settler
     *  walking on nor a camera pan moves it. Observation: the original keeps its ring on the cursor
     *  position it opened at. */
    let anchor: RingAnchor | null = null;
    /** The arms of the open session, rebuilt only when the selection changes. Observation: the original
     *  builds its ring once at bring-up, so a gate flipping under an open ring does not reflow the arms. */
    let menu: { readonly ids: readonly number[]; readonly groups: readonly ActionGroup[] } | null = null;
    let restoredJobs = false;
    let restoredPickerScrollTop = 0;
    /** The snapshot and answers the open list was last gated against: the frames between two ticks
     *  would only ask the gates again, unless an answer landed. */
    let listedSnapshot: WorldSnapshot | null = null;
    let listedAnswers = -1;

    const hideTransient = (): void => {
      tooltip.style.display = 'none';
    };

    const picker = createProfessionPicker({
      professions: opts.professions,
      scale: opts.uiscale,
      onPick: (jobType: number): void => {
        if (selectedIds.length > 0) opts.onSetJob(selectedIds, jobType);
        // Picking commits the order, so the whole menu closes rather than stepping back to the arms.
        closeMenu();
      },
      // Steps back to the ring, keeping the unit selected.
      onDismiss: (): void => closeJobWindow(),
      cue: opts.cue,
    });
    cleanup.push(() => picker.dispose());

    /** Open the profession list over the hidden ring, with availability for the current selection. */
    const openJobWindow = (): void => {
      mode = 'jobs';
      listedSnapshot = null;
      hideTransient();
      picker.show(
        (jobType) => opts.jobVisible(selectedIds, jobType),
        (jobType) => opts.jobUnlocked(selectedIds, jobType),
        (jobType) => opts.jobBlockedReason?.(selectedIds, jobType) ?? '',
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
      layer.hidden = true;
      hideTransient();
    };

    /**
     * Open the default arms, pinned on `pin` when the caller has a cursor; a re-open always re-pins.
     * Without a cursor the anchor stays null and the next frame's update pins the centroid.
     */
    const openMenu = (pin?: RingPin): void => {
      closeJobWindow(); // a fresh open shows the default arms, never a stale list
      mode = 'menu';
      anchor =
        pin === undefined
          ? null
          : {
              ...toCanvas(pin.x, pin.y),
              leftBound: pin.keepRightOf === undefined ? null : toCanvas(pin.keepRightOf, 0).x,
            };
      menu = null;
    };

    const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
      a.length === b.length && a.every((id, i) => id === b[i]);

    const update = (camera: Camera, snapshot: WorldSnapshot): void => {
      const centre = mode === 'closed' ? null : opts.selectionCentre(snapshot);
      if (centre === null) {
        layer.hidden = true;
        layout = EMPTY_LAYOUT;
        selectedIds = [];
        anchor = null;
        menu = null;
        visuals.hideAll();
        if (mode === 'jobs') closeJobWindow();
        return;
      }
      selectedIds = centre.ids;
      if (mode === 'jobs') {
        if (restoredJobs) {
          picker.show(
            (jobType) => opts.jobVisible(selectedIds, jobType),
            (jobType) => opts.jobUnlocked(selectedIds, jobType),
            (jobType) => opts.jobBlockedReason?.(selectedIds, jobType) ?? '',
          );
          picker.setScrollTop(restoredPickerScrollTop);
          restoredJobs = false;
        }
        const answers = opts.jobAnswersVersion();
        if (snapshot !== listedSnapshot || answers !== listedAnswers) {
          listedSnapshot = snapshot;
          listedAnswers = answers;
          picker.refresh();
        }
        // Keep the ring hidden under the DOM list window.
        layer.hidden = true;
        layout = EMPTY_LAYOUT;
        visuals.hideAll();
        return;
      }
      // A caller without a pointer sample falls back to the selection centroid on the session's first
      // frame, then freezes it like any other anchor.
      anchor ??= { x: cameraScreenX(camera, centre.x), y: cameraScreenY(camera, centre.y), leftBound: null };
      if (menu === null || !sameIds(menu.ids, centre.ids)) {
        menu = {
          ids: centre.ids,
          groups: actionRingMenu(allowedActions(opts.content, snapshot, centre.ids)),
        };
      }
      layout = layoutActionRing(
        menu.groups,
        anchor.x,
        anchor.y,
        scale,
        app.screen.width,
        app.screen.height,
        anchor.leftBound ?? 0,
      );
      visuals.placeLayout(layout, screenScale(canvas, app.renderer.resolution));
      layer.hidden = false;
    };

    // Click routing is order-independent: unit-controls asks `claimsPointer` before world picking.
    const input = createActionRingInput({
      showTip: (text, clientX, clientY) => {
        tooltip.textContent = text;
        tooltip.style.left = `${clientX + TIP_OFFSET.x}px`;
        tooltip.style.top = `${clientY + TIP_OFFSET.y}px`;
        tooltip.style.display = 'block';
      },
      hideTip: hideTransient,
      toCanvas,
      getMode: () => mode,
      isRingVisible: () => !layer.hidden,
      getLayout: () => layout,
      getTargets: () => selectedIds,
      onCommand: opts.onCommand,
      cue: opts.cue,
      openJobWindow,
      closeMenu,
    });

    return {
      update,
      toggle: (pin): void => {
        if (mode === 'jobs') closeJobWindow();
        else if (mode === 'menu') closeMenu();
        else openMenu(pin);
      },
      openProfessions: (targets): void => {
        selectedIds = [...targets];
        openJobWindow();
      },
      open: openMenu,
      close: closeMenu,
      claimsPointer: input.claimsPointer,
      handleEscape: (): boolean => {
        if (mode === 'closed') return false;
        if (mode === 'jobs') closeJobWindow();
        else closeMenu();
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
        layer.hidden = true;
        layout = EMPTY_LAYOUT;
        visuals.hideAll();
        hideTransient();
      },
      dispose: (): void => {
        tooltip.remove();
        picker.dispose();
        visuals.dispose();
        layer.remove();
      },
    };
  } catch (error: unknown) {
    for (let i = cleanup.length - 1; i >= 0; i--) cleanup[i]?.();
    throw error;
  }
}
