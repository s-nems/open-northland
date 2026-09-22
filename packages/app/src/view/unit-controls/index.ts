import type { UiCue } from '@open-northland/audio';
import { isActionHotkey, isTypingTarget } from '../../hud/hotkeys.js';
import { matchesMouseBinding } from '../../hud/keybindings.js';
import { clientToScreen } from '../camera/index.js';
import { pickInRect, screenToWorld, type Tile, worldToTile } from '../picking.js';
import { allowedActions } from './action-ring/menu-state.js';
import { createUnitChrome } from './chrome.js';
import { createClickHits } from './click-hits.js';
import {
  controlGroupCommand,
  createControlGroups,
  groupCentre,
  groupRecallEffect,
  isControlGroupMember,
} from './control-groups.js';
import { type EquipPickController, mountEquipPicker } from './equip-picker.js';
import { jobMateArea, jobMatesIn } from './job-mates.js';
import { createSelectionMarquee } from './marquee.js';
import { createUnitOrderController } from './orders.js';
import { createOverviewOrders } from './overview-orders.js';
import { createPickModeController, pickPressCue } from './pick-mode.js';
import { issueRingCommand } from './ring-commands.js';
import { createUnitSelection } from './selection.js';
import type { UnitControls, UnitControlsOptions } from './types.js';
import { createUnitTargets } from './unit-targets.js';
import { createWorkAreaOverlay } from './work-area.js';

export type { UnitControls, UnitControlsOptions } from './types.js';

/** The browser's click count (`MouseEvent.detail`) on the second press of a double-click. */
const DOUBLE_CLICK = 2;

/**
 * App-layer select-and-command input: it reads the mouse and keyboard and issues sim commands through
 * the one-way seam, never touching sim state. Selection is client view state fed to the renderer's
 * rings; only the local player's entities are pickable, unless the session is an observer.
 */

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  // The GUI click: a press that takes a selection or commands someone confirms, one that calls an armed
  // pick off fails. Original behavior: the confirming right click and a single selecting click play
  // `click_confirm`, a cancel plays `click_fail`, and a drag select or a click on empty ground plays
  // nothing.
  const cue: (kind: UiCue) => void = opts.onUiCue ?? ((): void => undefined);
  const selection = createUnitSelection();
  const controlGroups = createControlGroups();
  // Without the sim's pick-list seam the panel's equip and swap buttons stay inert.
  const equipPicker: EquipPickController | null =
    opts.equipPickList === undefined
      ? null
      : await mountEquipPicker({
          pickList: opts.equipPickList,
          content: opts.content,
          snapshot: opts.snapshot,
          enqueue: opts.enqueue,
          cue,
        });
  const workArea = createWorkAreaOverlay();
  // `pickMode` is built below; the arrows defer the reads to click time.
  const chrome = await createUnitChrome(opts, selection, equipPicker, {
    assignWorkplace: (id) => pickMode.arm({ kind: 'workplace', settler: id }),
    assignHome: (id) => pickMode.arm({ kind: 'home', settler: id }),
    attachTradeHouse: (id) => pickMode.arm({ kind: 'trade-house', settler: id }),
    selectEntity: (id) => applySelection([id], false),
    ringCommand: (id, targets) =>
      issueRingCommand(id, targets, {
        enqueue: opts.enqueue,
        pickMode,
        openEquipment: (settlers) => equipPicker?.openAll(settlers),
        toggleWorkArea: workArea.toggle,
      }),
    cue,
  });

  const marquee = createSelectionMarquee();
  /** Last browser cursor point, retained so a keyboard-opened menu can share the click-open anchor. */
  let pointer: { readonly x: number; readonly y: number } | null = null;

  const unitTargets = createUnitTargets({
    snapshot: opts.snapshot,
    humanPlayer: opts.humanPlayer,
    observer: opts.observer === true,
    hostileToward: opts.hostileToward,
    drawnItems: opts.drawnItems,
    boundsOf: opts.boundsOf,
    pixelHitOf: opts.pixelHitOf,
    elevation: opts.elevation,
    resourceVisible: opts.resourceVisible,
  });

  /** Client (CSS) coords to world px. */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const c = clientToScreen(canvas, opts.app.renderer.resolution, clientX, clientY);
    return screenToWorld(opts.camera(), c.x, c.y);
  };

  /** The half-cell node a click on the world view names, under the terrain lift it was drawn with. */
  const nodeAt = (clientX: number, clientY: number): Tile => {
    const w = toWorld(clientX, clientY);
    return worldToTile(w.x, w.y, opts.elevation);
  };

  const clickHits = createClickHits({
    ...(opts.doorBadges !== undefined ? { doorBadges: opts.doorBadges } : {}),
    targets: unitTargets,
    humanPlayer: opts.humanPlayer,
    observer: opts.observer === true,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
  });

  const pickMode = createPickModeController({
    snapshot: opts.snapshot,
    targets: unitTargets,
    content: opts.content,
    mapSize: opts.mapSize,
    toWorld,
    nodeAt,
    enqueue: opts.enqueue,
    orders: () => orders,
    setArmedCursor: (armed) => {
      canvas.style.cursor = armed ? 'crosshair' : '';
    },
  });

  /** The hotkey obeys the ring's own gate, so both ways of arming the order agree on who may take it. */
  const armAttackMove = (): void => {
    if (!allowedActions(opts.content, opts.snapshot(), [...selection.ids()]).has('attackPosition')) return;
    chrome.actions().close();
    pickMode.arm({ kind: 'attack-move' });
  };

  const applySelection = (ids: Iterable<number>, add: boolean): void => {
    const changed = selection.apply(ids, add);
    if (changed) pickMode.cancel();
    chrome.renderPanel(opts.snapshot());
    // Only a changed set closes the ring, so it never lingers on a stale unit while re-selecting the
    // same set leaves an open menu alone.
    if (changed) chrome.actions().close();
  };

  const orders = createUnitOrderController({
    technologyStatus: opts.technologyStatus,
    equipPickList: opts.equipPickList,
    selected: selection.ids,
    targets: unitTargets,
    snapshot: opts.snapshot,
    content: opts.content,
    mapSize: opts.mapSize,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    toWorld,
    enqueue: opts.enqueue,
    selectOwnSettler: (id) => applySelection([id], false),
    openActions: (atClient) => chrome.actions().open(atClient),
    cue,
  });

  const overviewPress = createOverviewOrders({
    pickMode,
    orders: () => orders,
    workFlagBinding: () => opts.bindings.workFlagOrder,
    cue,
  });

  const onMouseDown = (e: MouseEvent): void => {
    pointer = { x: e.clientX, y: e.clientY };
    // The HUD claims its own clicks before any world picking. The ring claim covers the right button
    // too, since its own listener consumes left clicks only.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its buttons through the same claim, so no panel-owned listener races this one.
    if (chrome.panel().handleMouseDown(e.clientX, e.clientY, e.button, e.ctrlKey || e.metaKey)) return;
    if (chrome.actions().claimsPointer(e.clientX, e.clientY)) return;
    const pick = pickMode.handleMouseDown(e);
    if (pick !== null) {
      const pickCue = pickPressCue(pick);
      if (pickCue !== null) cue(pickCue);
      return;
    }
    if (matchesMouseBinding(e, opts.bindings.workFlagOrder)) {
      if (orders.issueSetWorkFlagAt(e)) cue('confirm');
      return;
    }
    if (e.button === 2) {
      const w = toWorld(e.clientX, e.clientY);
      const marker = clickHits.doorMarkerAt(w.x, w.y);
      if (marker?.kind === 'settler') {
        applySelection([marker.ref], false);
        cue('confirm');
      } else if (orders.issueRightClick(e, marker?.kind === 'building' ? marker.ref : null)) {
        cue('confirm');
      }
      return;
    }
    if (e.button !== 0) return; // middle belongs to the camera controller's pan
    marquee.begin(e.clientX, e.clientY);
  };

  const onMouseMove = (e: MouseEvent): void => {
    pointer = { x: e.clientX, y: e.clientY };
    marquee.update(e.clientX, e.clientY);
  };

  /**
   * Shift + click toggles a unit, the usual RTS convention; the original instead adds and removes with two
   * separate modifiers.
   */
  const toggleSelected = (id: number): void => {
    const held = selection.ids();
    if (held.has(id)) {
      applySelection(
        [...held].filter((other) => other !== id),
        false,
      );
    } else {
      applySelection([id], true);
    }
  };

  /** What the last left click on the world landed on, so a double-click can tell both presses hit it. */
  let lastClickHit: number | null = null;

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0) return;
    const previousHit = lastClickHit;
    lastClickHit = null; // a HUD, pick or drag release breaks a double-click
    if (!marquee.active()) return;
    const release = marquee.release(e.clientX, e.clientY);
    if (release === null) return;
    if (release.moved) {
      // A drag select is silent in the original; only the single click below confirms.
      const a = toWorld(release.startX, release.startY);
      const b = toWorld(e.clientX, e.clientY);
      applySelection(pickInRect(unitTargets.owned(), a.x, a.y, b.x, b.y), e.shiftKey);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const hit = clickHits.selectionAt(w.x, w.y);
    lastClickHit = hit;
    const mates =
      hit !== null && hit === previousHit && e.detail >= DOUBLE_CLICK
        ? jobMatesIn(
            unitTargets.owned('settler'),
            hit,
            jobMateArea(opts.camera(), opts.app.screen.width, opts.app.screen.height),
            opts.snapshot(),
            opts.content,
          )
        : null;
    if (mates !== null) {
      applySelection(mates, e.shiftKey); // the original's double-click plays no further click
    } else if (hit !== null) {
      if (e.shiftKey) toggleSelected(hit);
      else applySelection([hit], false);
      cue('confirm');
    } else if (!e.shiftKey) applySelection([], false); // clearing the selection is no button
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const groupCommand = isTypingTarget(e.target) ? null : controlGroupCommand(e, opts.bindings);
    if (groupCommand !== null) {
      e.preventDefault();
      if (groupCommand.mode === 'replace') {
        controlGroups.replace(groupCommand.action, selection.ids());
      } else if (groupCommand.mode === 'add') {
        controlGroups.addExclusive(groupCommand.action, selection.ids());
      } else {
        const snapshot = opts.snapshot();
        const ids = controlGroups.recall(groupCommand.action, (id) =>
          isControlGroupMember(snapshot, id, opts.humanPlayer, opts.observer === true),
        );
        if (ids === null) return;
        if (groupRecallEffect(ids, selection.ids()) === 'centre') {
          const centre = groupCentre(snapshot, ids, opts.elevation);
          if (centre !== null) opts.centerOn(centre.x, centre.y);
        } else {
          applySelection(ids, false);
        }
      }
    } else if (isActionHotkey(e, opts.bindings, 'actionRing')) {
      e.preventDefault(); // Space (the default binding) would otherwise scroll the page
      chrome.actions().toggle(pointer ?? undefined);
    } else if (isActionHotkey(e, opts.bindings, 'professionPicker')) {
      e.preventDefault();
      const ids = [...selection.ids()];
      if (allowedActions(opts.content, opts.snapshot(), ids).has('changeProfession')) {
        chrome.actions().openProfessions(ids);
      }
    } else if (isActionHotkey(e, opts.bindings, 'attackMove')) {
      e.preventDefault();
      armAttackMove();
    } else if (e.code === 'Escape') {
      // Escape steps back one level: job list, then an armed pick mode, then the selection itself.
      if (chrome.actions().handleEscape()) return;
      if (pickMode.isArmed()) {
        pickMode.cancel();
        cue('fail'); // approximation: the original's cancel click is a mouse path; Esc is unverified
      } else applySelection([], false);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);

  return {
    selectedIds: selection.ids,
    selectionVersion: selection.version,
    selectEntity: (id) => applySelection([id], false),
    overviewPress,
    select: (ids) => applySelection(ids, false),
    portrait: () => chrome.panel().portrait(),
    flaggedFlagIds: () => selection.workFlagIds(opts.snapshot()),
    workAreaRings: () => workArea.rings(opts.snapshot()),
    assignHighlight: pickMode.highlight,
    signpostPlacementActive: pickMode.signpostActive,
    claimsEscape: () =>
      chrome.actions().state().mode === 'jobs' || pickMode.isArmed() || selection.ids().size > 0,
    // Includes the details panel, so a consumer gating on this treats a point over the panel as HUD
    // rather than world.
    claimsPointer: (x, y) =>
      opts.claimPointer?.(x, y) === true ||
      chrome.panel().claimsPointer(x, y) ||
      chrome.actions().claimsPointer(x, y),
    tick: (snapshot) => {
      chrome.panel().tick(snapshot);
      // Re-anchors the ring on the selection's on-screen centroid; a no-op while it is closed.
      chrome.actions().update(opts.camera(), snapshot);
    },
    setHudHidden: chrome.setHudHidden,
    setUiScale: chrome.setUiScale,
    dispose: () => {
      pickMode.cancel(); // an armed mode owns the canvas cursor, which teardown must not leave set
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      orders.dispose();
      marquee.dispose();
      chrome.dispose();
      equipPicker?.dispose();
    },
  };
}
