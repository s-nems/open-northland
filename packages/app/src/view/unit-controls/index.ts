import { isActionHotkey } from '../../hud/hotkeys.js';
import { clientToScreen } from '../camera/index.js';
import { pickInRect, screenToWorld } from '../picking.js';
import { createUnitChrome } from './chrome.js';
import { createClickHits } from './click-hits.js';
import { type EquipPickController, mountEquipPicker } from './equip-picker.js';
import { createSelectionMarquee } from './marquee.js';
import { createUnitOrderController } from './orders.js';
import { createPickModeController } from './pick-mode.js';
import { createUnitSelection } from './selection.js';
import type { UnitControls, UnitControlsOptions } from './types.js';
import { createUnitTargets } from './unit-targets.js';

export type { UnitControls, UnitControlsOptions } from './types.js';

/**
 * App-layer select-and-command input: it reads the mouse and keyboard and issues sim commands through
 * the one-way seam, never touching sim state. Selection is client view state fed to the renderer's
 * rings; only the local player's entities are pickable, unless the session is an observer.
 */

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  const selection = createUnitSelection();
  // Without the sim's pick-list seam the panel's equip and swap buttons stay inert.
  const equipPicker: EquipPickController | null =
    opts.equipPickList === undefined
      ? null
      : await mountEquipPicker({
          pickList: opts.equipPickList,
          goods: opts.content.goods,
          enqueue: opts.enqueue,
        });
  const chrome = await createUnitChrome(opts, selection, equipPicker, {
    assignWorkplace: (id) => pickMode.armWorkplace(id),
    assignHome: (id) => pickMode.armHome(id),
    selectEntity: (id) => applySelection([id], false),
    erectSignpost: (ids) => pickMode.armSignpost(ids),
    attackMove: () => armAttackMove(),
  });

  const marquee = createSelectionMarquee();

  const unitTargets = createUnitTargets({
    snapshot: opts.snapshot,
    humanPlayer: opts.humanPlayer,
    observer: opts.observer === true,
    hostileToward: opts.hostileToward,
    drawnItems: opts.drawnItems,
    boundsOf: opts.boundsOf,
    pixelHitOf: opts.pixelHitOf,
  });

  /** Client (CSS) coords to world px. */
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const c = clientToScreen(canvas, opts.app.renderer.resolution, clientX, clientY);
    return screenToWorld(opts.camera(), c.x, c.y);
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
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    toWorld,
    enqueue: opts.enqueue,
    // `orders` is built below, so the arrow defers the read to click time.
    issueAttackMove: (event) => orders.issueAttackMove(event),
    setArmedCursor: (armed) => {
      canvas.style.cursor = armed ? 'crosshair' : '';
    },
  });

  /** Refused when the selection holds no settler to send, so the mode never arms into a click that does nothing. */
  const armAttackMove = (): void => {
    if (unitTargets.ownedSettlersIn(selection.ids()).length === 0) return;
    chrome.actions().close();
    pickMode.armAttackMove();
  };

  const applySelection = (ids: Iterable<number>, add: boolean): void => {
    const changed = selection.apply(ids, add);
    if (changed) pickMode.cancel();
    chrome.panel().render(opts.snapshot(), selection.ids());
    // Only a changed set closes the ring, so it never lingers on a stale unit while re-selecting the
    // same set leaves an open menu alone.
    if (changed) chrome.actions().close();
  };

  const orders = createUnitOrderController({
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
  });

  const onMouseDown = (e: MouseEvent): void => {
    // The HUD claims its own clicks before any world picking. The ring claim covers the right button
    // too, since its own listener consumes left clicks only.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its buttons through the same claim, so no panel-owned listener races this one.
    if (chrome.panel().handleMouseDown(e.clientX, e.clientY, e.button, e.ctrlKey || e.metaKey)) return;
    if (chrome.actions().claimsPointer(e.clientX, e.clientY)) return;
    if (pickMode.handleMouseDown(e)) return;
    if (e.button === 2) {
      if (e.ctrlKey || e.metaKey) orders.issueSetWorkFlag(e);
      else {
        const w = toWorld(e.clientX, e.clientY);
        const marker = clickHits.doorMarkerAt(w.x, w.y);
        if (marker?.kind === 'settler') applySelection([marker.ref], false);
        else orders.issueRightClick(e, marker?.kind === 'building' ? marker.ref : null);
      }
      return;
    }
    if (e.button !== 0) return; // middle belongs to the camera controller's pan
    marquee.begin(e.clientX, e.clientY);
  };

  const onMouseMove = (e: MouseEvent): void => {
    marquee.update(e.clientX, e.clientY);
  };

  const onMouseUp = (e: MouseEvent): void => {
    if (e.button !== 0 || !marquee.active()) return;
    const release = marquee.release(e.clientX, e.clientY);
    if (release === null) return;
    if (release.moved) {
      const a = toWorld(release.startX, release.startY);
      const b = toWorld(e.clientX, e.clientY);
      applySelection(pickInRect(unitTargets.owned(), a.x, a.y, b.x, b.y), e.shiftKey);
    } else {
      const w = toWorld(e.clientX, e.clientY);
      const hit = clickHits.selectionAt(w.x, w.y);
      if (hit !== null) applySelection([hit], e.shiftKey);
      else if (!e.shiftKey) applySelection([], false);
    }
  };

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault(); // let the right button be a move order, not the browser menu
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isActionHotkey(e, opts.bindings, 'actionRing')) {
      e.preventDefault(); // Space (the default binding) would otherwise scroll the page
      chrome.actions().toggle(); // the info card is always-on; the hotkey toggles only the action ring
    } else if (isActionHotkey(e, opts.bindings, 'attackMove')) {
      armAttackMove();
    } else if (e.code === 'Escape') {
      // Escape steps back one level: job list, then an armed pick mode, then the selection itself.
      if (chrome.actions().handleEscape()) return;
      if (pickMode.isArmed()) pickMode.cancel();
      else applySelection([], false);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    selectedIds: selection.ids,
    selectionVersion: selection.version,
    selectEntity: (id) => applySelection([id], false),
    portrait: () => chrome.panel().portrait(),
    flaggedFlagIds: () => selection.workFlagIds(opts.snapshot()),
    assignHighlight: pickMode.highlight,
    signpostPlacementActive: pickMode.signpostActive,
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
    setUiScale: chrome.setUiScale,
    dispose: () => {
      pickMode.cancel(); // an armed mode owns the canvas cursor, which teardown must not leave set
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      marquee.dispose();
      chrome.dispose();
      equipPicker?.dispose();
    },
  };
}
