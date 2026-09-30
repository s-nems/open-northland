import type { UiCue } from '@open-northland/audio';
import { entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { settlerJobType } from '../../game/snapshot.js';
import { pickableSeat } from '../../game/viewer-seat.js';
import { isActionHotkey, isFieldKey } from '../../hud/hotkeys.js';
import { matchesMouseBinding } from '../../hud/keybindings.js';
import { clientToScreen } from '../camera/index.js';
import { setCanvasCursor } from '../cursors/element.js';
import { pickInRect, screenToWorld, type Tile, worldToTile } from '../picking.js';
import { orderRecipients } from './action-ring/index.js';
import { createAnsweredOrders } from './answered-orders.js';
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
import { pickCursor } from './pick-cursor.js';
import { createPickModeController, pickPressCue } from './pick-mode.js';
import { issueRingCommand } from './ring-commands.js';
import { createUnitSelection } from './selection.js';
import { createSelectionCursor } from './selection-cursor.js';
import type { UnitControls, UnitControlsOptions } from './types.js';
import { createUnitTargets } from './unit-targets.js';
import { createVehicleOrderController } from './vehicle-orders.js';
import { createWorkAreaOverlay } from './work-area.js';

export type { UnitControls, UnitControlsOptions } from './types.js';

/** The browser's click count (`MouseEvent.detail`) on the second press of a double-click. */
const DOUBLE_CLICK = 2;

/** A right-click press as it landed. A fallback that runs once the sim's answer arrives replays it, so
 *  the order controllers resolve its client point to the press's world point and read the press's
 *  selection, however far the camera or the selection moved meanwhile. */
interface RightClickPress {
  readonly clientX: number;
  readonly clientY: number;
  readonly world: { readonly x: number; readonly y: number };
  readonly selected: ReadonlySet<number>;
}

/**
 * App-layer select-and-command input: it reads the mouse and keyboard and issues sim commands through
 * the one-way seam, never touching sim state. Selection is client view state fed to the renderer's
 * rings; only the viewer seat's entities are pickable, unless the viewer watches the whole map.
 */

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  // The GUI click: a press that takes a selection or commands someone confirms, one that calls an armed
  // pick off fails. Original behavior: the confirming right click and a single selecting click play
  // `click_confirm`, a cancel plays `click_fail`, and a drag select or a click on empty ground plays
  // nothing.
  const cue: (kind: UiCue) => void = opts.onUiCue ?? ((): void => undefined);
  const selection = createUnitSelection();
  const answered = createAnsweredOrders();
  const controlGroups = createControlGroups();
  // Without the sim's pick-list seam the panel's equip and swap buttons stay inert.
  const equipPicker: EquipPickController | null =
    opts.requestEquipPicks === undefined
      ? null
      : await mountEquipPicker({
          pickList: opts.requestEquipPicks,
          content: opts.content,
          snapshot: opts.snapshot,
          enqueue: opts.enqueue,
          cue,
        });
  const workArea = createWorkAreaOverlay();
  /** A gatherer's or a fisher's workplace pick also plants its flag, so the panel's one button serves
   *  both ways the trade works. */
  const worksFromFlag = (id: number): boolean => {
    const entity = entityById(opts.snapshot(), id);
    const job = entity === undefined ? undefined : settlerJobType(entity);
    return job !== undefined && systems.jobUsesWorkFlag({ content: opts.content }, job);
  };
  // `pickMode` is built below; the arrows defer the reads to click time.
  const chrome = await createUnitChrome(opts, selection, equipPicker, {
    assignWorkplace: (id) =>
      pickMode.arm({ kind: worksFromFlag(id) ? 'workplace-or-flag' : 'workplace', units: [id] }),
    assignHome: (id) => pickMode.arm({ kind: 'home', units: [id] }),
    attachTradeHouse: (id) => pickMode.arm({ kind: 'trade-house', units: [id] }),
    selectEntity: (id) => applySelection([id], false),
    armPick: (mode) => pickMode.arm(mode),
    armedPick: () => pickMode.armed(),
    selectGroup: (ids) => applySelection(ids, false),
    answered,
    ringCommand: (id, targets) =>
      issueRingCommand(id, orderRecipients(opts.content, opts.snapshot(), targets, id), {
        enqueue: opts.enqueue,
        pickMode,
        openEquipment: (settlers) => equipPicker?.openAll(settlers),
        toggleWorkArea: workArea.toggle,
        siegeVehicles: () => vehicleOrders.selectedSiegeVehicles(),
      }),
    cue,
  });

  const marquee = createSelectionMarquee();
  /** Last browser cursor point, retained so a keyboard-opened menu can share the click-open anchor. */
  let pointer: { readonly x: number; readonly y: number } | null = null;

  const unitTargets = createUnitTargets({
    snapshot: opts.snapshot,
    viewer: opts.viewer,
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

  let replaying: RightClickPress | null = null;
  const orderToWorld = (clientX: number, clientY: number): { x: number; y: number } =>
    replaying !== null && replaying.clientX === clientX && replaying.clientY === clientY
      ? replaying.world
      : toWorld(clientX, clientY);
  const orderSelection = (): ReadonlySet<number> => replaying?.selected ?? selection.ids();
  const replayed =
    (press: RightClickPress, run: () => void): (() => void) =>
    () => {
      const outer = replaying;
      replaying = press;
      try {
        run();
      } finally {
        replaying = outer;
      }
    };

  /** The half-cell node a click on the world view names, under the terrain lift it was drawn with. */
  const nodeAt = (clientX: number, clientY: number): Tile => {
    const w = toWorld(clientX, clientY);
    return worldToTile(w.x, w.y, opts.elevation);
  };

  const clickHits = createClickHits({
    ...(opts.doorBadges !== undefined ? { doorBadges: opts.doorBadges } : {}),
    targets: unitTargets,
    viewer: opts.viewer,
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
    vehicleOrders: () => vehicleOrders,
    setArmedCursor: (mode) => {
      setCanvasCursor(canvas, 'pick', pickCursor(mode));
    },
    canAttachToVehicle: opts.canAttachToVehicle,
    canAttachTradeHouse: opts.canAttachTradeHouse,
    askAttachTradeHouse: opts.askAttachTradeHouse,
    answered,
    ...(opts.attachPicksVersion !== undefined ? { answersVersion: opts.attachPicksVersion } : {}),
  });

  const selectionCursor = createSelectionCursor({
    canvas,
    camera: opts.camera,
    viewerVersion: opts.viewer.version,
    toWorld,
    hasSelectableAt: clickHits.hasSelectableAt,
    blocked: (x, y) =>
      pickMode.isArmed() ||
      opts.claimPointer?.(x, y) === true ||
      chrome.claimsPointer(x, y) ||
      chrome.actions().claimsPointer(x, y),
  });

  /** The hotkey obeys the ring's own gate for the settlers, so both ways of arming the order agree on
   *  which of them may take it; the selected siege vehicles, which the settler ring does not list,
   *  march along. */
  const armAttackMove = (): void => {
    const units = orderRecipients(opts.content, opts.snapshot(), [...selection.ids()], 'attackPosition');
    const vehicles = vehicleOrders.selectedSiegeVehicles();
    if (units.length === 0 && vehicles.length === 0) return;
    chrome.actions().close();
    pickMode.arm({ kind: 'attack-move', units, vehicles });
  };

  /** The one selected entity no longer stands in the world. */
  const selectionGone = (snapshot: WorldSnapshot): boolean => {
    const ids = selection.ids();
    if (ids.size !== 1) return false;
    const [only] = ids;
    return only !== undefined && entityById(snapshot, only) === undefined;
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
    uiscale: opts.uiscale ?? 1,
    technologyStatus: opts.technologyStatus,
    technologyVersion: opts.technologyVersion,
    requestEquipPicks: opts.requestEquipPicks,
    answered,
    selected: orderSelection,
    targets: unitTargets,
    snapshot: opts.snapshot,
    content: opts.content,
    mapSize: opts.mapSize,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    toWorld: orderToWorld,
    enqueue: opts.enqueue,
    selectOwnSettler: (id) => applySelection([id], false),
    openActions: (atClient) => chrome.actions().open(atClient),
    cue,
    askAttachTradeHouse: opts.askAttachTradeHouse,
  });

  const vehicleOrders = createVehicleOrderController({
    selected: orderSelection,
    targets: unitTargets,
    snapshot: opts.snapshot,
    content: opts.content,
    mapSize: opts.mapSize,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    viewer: opts.viewer,
    toWorld: orderToWorld,
    enqueue: opts.enqueue,
    askAttachToVehicle: opts.askAttachToVehicle,
    askMoorAt: opts.askMoorAt,
    answered,
  });

  const overviewPress = createOverviewOrders({
    pickMode,
    orders: () => orders,
    workFlagBinding: () => opts.bindings.workFlagOrder,
    cue,
  });

  const onMouseDown = (e: MouseEvent): void => {
    pointer = { x: e.clientX, y: e.clientY };
    // The HUD claims its own clicks before any world picking. The ring's buttons take their own presses;
    // its claim below keeps one that lands on a button's rounded edge off the world.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its buttons through the same claim, so no panel-owned listener races this one.
    if (chrome.panel().handleMouseDown(e.clientX, e.clientY, e.button)) return;
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
        // The marker stands for the person inside, so it takes the right click the figure would.
        applySelection([marker.ref], false);
        chrome.actions().open({ x: e.clientX, y: e.clientY });
        cue('confirm');
      } else {
        // Settlers the vehicle under the cursor refuses take the usual right-click once it answered.
        const onBuilding = marker?.kind === 'building' ? marker.ref : null;
        const press: RightClickPress = {
          clientX: e.clientX,
          clientY: e.clientY,
          world: w,
          selected: new Set(selection.ids()),
        };
        const fallback = replayed(press, () => rightClickOrders(e, onBuilding, press));
        if (vehicleOrders.issueAttachSelected(e, fallback)) cue('confirm');
        else if (rightClickOrders(e, onBuilding, press)) cue('confirm');
      }
      return;
    }
    if (e.button !== 0) return; // middle belongs to the camera controller's pan
    marquee.begin(e.clientX, e.clientY);
  };

  /** Settlers and vehicles selected together both take the click. One that picks an own settler replaces
   *  the selection first, which leaves no vehicle selected to drive. */
  const rightClickOrders = (e: MouseEvent, onBuilding: number | null, press: RightClickPress): boolean => {
    const settlersTook = orders.issueRightClick(e, onBuilding);
    // A trader riding its cart takes a house onto its route instead of driving the cart there.
    const vehiclesTook =
      orders.issueRiderTradeHouse(
        e,
        onBuilding,
        replayed(press, () => vehicleOrders.issueRightClick(e)),
      ) || vehicleOrders.issueRightClick(e);
    return settlersTook || vehiclesTook;
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
      // Any own vehicle whose sprite the box touches joins the settlers; a single one opens its order
      // window, a group takes the right-click and the attack-move.
      const boxed = [...unitTargets.owned('settler'), ...unitTargets.owned('vehicle')];
      applySelection(pickInRect(boxed, a.x, a.y, b.x, b.y), e.shiftKey);
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

  /** Tab steps through the shown settler's trade, vehicle's class or building's type unless a field or
   *  another HUD window has the focus, whose own focus order Tab keeps. */
  const browsesTrade = (e: KeyboardEvent): boolean =>
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey &&
    !isFieldKey(e) &&
    !(
      e.target instanceof Element &&
      e.target.closest('.on-hud') !== null &&
      e.target.closest('.on-selection') === null
    );

  const onKeyDown = (e: KeyboardEvent): void => {
    const groupCommand = isFieldKey(e) ? null : controlGroupCommand(e, opts.bindings);
    if (groupCommand !== null) {
      e.preventDefault();
      if (groupCommand.mode === 'replace') {
        controlGroups.replace(groupCommand.action, selection.ids());
      } else if (groupCommand.mode === 'add') {
        controlGroups.addExclusive(groupCommand.action, selection.ids());
      } else {
        const snapshot = opts.snapshot();
        const ids = controlGroups.recall(groupCommand.action, (id) =>
          isControlGroupMember(snapshot, id, pickableSeat(opts.viewer)),
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
      if (orderRecipients(opts.content, opts.snapshot(), ids, 'changeProfession').length > 0) {
        chrome.actions().openProfessions(ids);
      }
    } else if (isActionHotkey(e, opts.bindings, 'attackMove')) {
      e.preventDefault();
      armAttackMove();
    } else if (e.code === 'Tab' && browsesTrade(e) && chrome.browse(e.shiftKey ? -1 : 1)) {
      e.preventDefault();
    } else if (e.code === 'Escape') {
      // Escape steps back one level: the ring (its job list first), the trade window or the hold's
      // picker, an armed pick mode, the selection.
      if (chrome.actions().handleEscape()) return;
      if (chrome.closeWindow()) return;
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
    panelModelContext: chrome.modelContext,
    selectedIds: selection.ids,
    selectionVersion: selection.version,
    selectEntity: (id) => applySelection([id], false),
    overviewPress,
    select: (ids) => applySelection(ids, false),
    portraits: () => chrome.portraits(),
    flaggedFlagIds: () => selection.workFlagIds(opts.snapshot()),
    workAreaRings: () => workArea.rings(opts.snapshot()),
    assignHighlight: pickMode.highlight,
    signpostPlacementActive: pickMode.signpostActive,
    workFlagPlacementActive: pickMode.flagActive,
    claimsEscape: () =>
      chrome.actions().state().mode !== 'closed' ||
      chrome.windowOpen() ||
      pickMode.isArmed() ||
      selection.ids().size > 0,
    dockPickVehicle: pickMode.dockVehicle,
    // Includes the details panel, so a consumer gating on this treats a point over the panel as HUD
    // rather than world.
    claimsPointer: (x, y) =>
      opts.claimPointer?.(x, y) === true ||
      chrome.claimsPointer(x, y) ||
      chrome.actions().claimsPointer(x, y),
    refreshCursor: selectionCursor.update,
    tick: (snapshot) => {
      // A dead or removed target clears the selection, and the panel with it.
      if (selectionGone(snapshot)) applySelection([], false);
      orders.refresh();
      chrome.panel().tick(snapshot);
      chrome.refreshWindows();
      // Re-anchors the ring on the selection's on-screen centroid; a no-op while it is closed.
      chrome.actions().update(opts.camera(), snapshot);
    },
    setHudHidden: chrome.setHudHidden,
    setUiScale: async (scale) => {
      await Promise.all([chrome.setUiScale(scale), orders.setUiScale(scale)]);
    },
    dispose: () => {
      selectionCursor.dispose();
      pickMode.cancel(); // an armed mode owns the canvas cursor, which teardown must not leave set
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      answered.dispose();
      orders.dispose();
      marquee.dispose();
      chrome.dispose();
      equipPicker?.dispose();
    },
  };
}
