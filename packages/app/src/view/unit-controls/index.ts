import { entityById, MAX_UNIT_ORDER_MEMBERS, systems, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, isVehicle, settlerJobType } from '../../game/snapshot.js';
import { pickableSeat } from '../../game/viewer-seat.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import { createGoodIconPainter } from '../../hud/dom/good-art.js';
import { isActionHotkey, isFieldKey, isOrderHotkey } from '../../hud/hotkeys.js';
import { matchesMouseBinding } from '../../hud/keybindings.js';
import { clientToScreen } from '../camera/index.js';
import { setCanvasCursor } from '../cursors/element.js';
import { nodeBounds, pickInRect, pickTopAt, screenToWorld, type Tile, worldToTile } from '../picking.js';
import { entityAnchor } from '../projections/entity-anchor.js';
import { memoBySnapshot, rangeRingsOf } from '../projections/index.js';
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
import { createKeyboardOrders } from './keyboard-orders.js';
import { createLostGoals } from './lost-goals.js';
import { createSelectionMarquee } from './marquee.js';
import { createOrderFeedback } from './order-feedback.js';
import { createOrderLimitNotice } from './order-limit-notice.js';
import { createOrderMarkers } from './order-markers.js';
import { createUnitOrderController } from './orders.js';
import { createOverviewOrders } from './overview-orders.js';
import { createPendingGroundOrders } from './pending-ground-orders.js';
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
  const pendingGroundOrders = createPendingGroundOrders();
  const enqueue = opts.enqueue;
  opts = { ...opts, enqueue: (command) => pendingGroundOrders.submit(command, enqueue) };
  const { canvas } = opts;
  // The GUI click: a press that takes a selection or commands someone confirms, one that calls an armed
  // pick off fails. Original behavior: the confirming right click and a single selecting click play
  // `click_confirm`, a cancel plays `click_fail`, and a drag select or a click on empty ground plays
  // nothing.
  const { cue, deferGroundConfirmation } = createOrderFeedback(opts.onUiCue);
  const isUnit = (id: number): boolean => {
    const entity = entityById(opts.snapshot(), id);
    return entity !== undefined && (isSettler(entity) || isVehicle(entity));
  };
  const selection = createUnitSelection(isUnit);
  const orderLimitNotice = createOrderLimitNotice(opts.domHud.plane);
  const refuseOrderLimit = (): void => {
    orderLimitNotice.show();
    cue('fail');
  };
  const answered = createAnsweredOrders();
  const controlGroups = createControlGroups();
  // Without the sim's pick-list seam the panel's equip and swap buttons stay inert.
  const equipPicker: EquipPickController | null =
    opts.requestEquipPicks === undefined || opts.requestSelectionEquipPicks === undefined
      ? null
      : mountEquipPicker({
          uiString: opts.domHud.uiString,
          scale: opts.domHud.scale,
          icons: createGoodIconPainter(opts.domHud.pack, opts.content),
          pickList: opts.requestEquipPicks,
          selectionPicks: opts.requestSelectionEquipPicks,
          content: opts.content,
          snapshot: opts.snapshot,
          enqueue: opts.enqueue,
          cue,
          onOrderLimit: refuseOrderLimit,
        });
  const workArea = createWorkAreaOverlay();
  // The selection's circles and the ones the ring's "Show Work Area" kept. Both versions only ever grow,
  // so their sum changes whenever either does.
  const rangeRings = memoBySnapshot(
    (snapshot: WorldSnapshot) =>
      rangeRingsOf(opts.content, snapshot, [...workArea.ids(), ...selection.ids()]),
    () => workArea.version() + selection.version(),
  );
  const orderMarkers = createOrderMarkers(() => performance.now());
  const lostGoals = createLostGoals(nodeBounds(opts.mapSize).width);
  /** A gatherer's or a fisher's workplace pick also plants its flag, so the panel's one button serves
   *  both ways the trade works. */
  const worksFromFlag = (id: number): boolean => {
    const entity = entityById(opts.snapshot(), id);
    const job = entity === undefined ? undefined : settlerJobType(entity);
    return job !== undefined && systems.jobUsesWorkFlag({ content: opts.content }, job);
  };
  // `pickMode` is built below; the arrows defer the reads to click time.
  const ringCommand = (id: ActionOrderId, targets: readonly number[]): boolean =>
    issueRingCommand(id, orderRecipients(opts.content, opts.snapshot(), targets, id), {
      enqueue: opts.enqueue,
      onOrderLimit: orderLimitNotice.show,
      pickMode,
      openEquipment: (settlers) => equipPicker?.openAll(settlers),
      toggleWorkArea: workArea.toggle,
      siegeVehicles: () => vehicleOrders.selectedSiegeVehicles(),
    });
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
    ringCommand,
    cue,
    onOrderLimit: refuseOrderLimit,
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
    onOrderLimit: refuseOrderLimit,
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

  const keyboardOrders = createKeyboardOrders({
    bindings: opts.bindings,
    snapshot: opts.snapshot,
    content: opts.content,
    player: opts.viewer.seat,
    selected: selection.ids,
    select: (ids, add) => applySelection(ids, add),
    camera: opts.camera,
    centreOn: (id) => {
      const at = entityAnchor(opts.snapshot(), id, opts.elevation);
      if (at !== null) opts.centerOn(at.x, at.y);
      return at !== null;
    },
    enqueue: opts.enqueue,
    // The ring's own gate decides who takes the order, so the key and the ring button agree.
    ringOrder: (id) => {
      const ids = [...selection.ids()];
      if (orderRecipients(opts.content, opts.snapshot(), ids, id).length === 0) return false;
      chrome.actions().close();
      return ringCommand(id, ids);
    },
    cue,
  });

  /** Members that died or left the world drop out; an emptied selection ends its pick and ring as a
   *  cleared one does, while survivors keep theirs. */
  const dropGoneMembers = (snapshot: WorldSnapshot): void => {
    if (!selection.dropGone(snapshot)) return;
    if (selection.ids().size === 0) {
      pickMode.cancel();
      chrome.actions().close();
    }
    chrome.renderPanel(snapshot);
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
    onOrderLimit: orderLimitNotice.show,
    uiscale: opts.uiscale ?? 1,
    technologyStatus: opts.technologyStatus,
    technologyVersion: opts.technologyVersion,
    requestEquipPicks: opts.requestEquipPicks,
    requestFormationSlots: opts.requestFormationSlots,
    pendingGroundOrders,
    deferGroundConfirmation,
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
    refuse:
      opts.voices === undefined
        ? undefined
        : (movers) => opts.voices?.refuse({ members: movers, fallback: 'fail' }),
    askAttachTradeHouse: opts.askAttachTradeHouse,
    markOrder: orderMarkers.place,
  });

  const vehicleOrders = createVehicleOrderController({
    onOrderLimit: refuseOrderLimit,
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
    markOrder: orderMarkers.place,
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
        // Refuse a whole mixed gesture before either its settlers or vehicles submit anything.
        if (
          pickTopAt(unitTargets.owned('settler'), w.x, w.y) === null &&
          [...selection.ids()].filter(isUnit).length > MAX_UNIT_ORDER_MEMBERS
        ) {
          refuseOrderLimit();
          return;
        }
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
    // Vehicles have no queue: beside settlers walking a Shift-queued route they would drive ahead to each
    // pressed spot, so they sit it out; a selection of vehicles alone still drives.
    if (e.shiftKey && settlersTook) return true;
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
   * separate modifiers. A building is never added: it replaces the selection, as a unit replaces it.
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
        const ids = controlGroups.recall(
          groupCommand.action,
          (id) => isControlGroupMember(snapshot, id, pickableSeat(opts.viewer)),
          isUnit,
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
    } else if (isOrderHotkey(e, opts.bindings, 'attackMove')) {
      e.preventDefault();
      armAttackMove();
    } else if (isActionHotkey(e, opts.bindings, 'upgradeBuilding')) {
      e.preventDefault();
      // The owned-order gate cues a sent or refused press; a selection without an upgrade tile is
      // told here, an empty one stays silent like the other order keys.
      if (!chrome.upgradeBuilding() && selection.ids().size > 0) cue('fail');
    } else if (keyboardOrders(e)) {
      e.preventDefault();
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

  /** Letting Shift go ends the chain of queued presses it kept a pick armed for. */
  const endShiftChain = (): void => pickMode.endShiftChain();
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') endShiftChain();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', endShiftChain);

  return {
    panelModelContext: chrome.modelContext,
    selectedIds: selection.ids,
    selectionVersion: selection.version,
    selectEntity: (id) => applySelection([id], false),
    overviewPress,
    select: (ids) => applySelection(ids, false),
    portraits: () => chrome.portraits(),
    flaggedFlagIds: () => selection.workFlagIds(opts.snapshot()),
    focusedIds: () => chrome.focusedIds(),
    groupNumbers: controlGroups.numbers,
    rangeRings: () => rangeRings(opts.snapshot()),
    orderMarkers: orderMarkers.live,
    lostGoals: () => lostGoals(opts.snapshot(), selection.ids(), pickableSeat(opts.viewer)),
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
      dropGoneMembers(snapshot);
      orders.refresh();
      chrome.panel().tick(snapshot);
      chrome.refreshWindows();
      // Re-anchors the ring on the selection's on-screen centroid; a no-op while it is closed.
      chrome.actions().update(opts.camera(), snapshot);
    },
    presentFigures: chrome.presentFigures,
    setHudHidden: chrome.setHudHidden,
    setUiScale: async (scale) => {
      await Promise.all([chrome.setUiScale(scale), orders.setUiScale(scale)]);
    },
    dispose: () => {
      selectionCursor.dispose();
      orderLimitNotice.dispose();
      pickMode.cancel(); // an armed mode owns the canvas cursor, which teardown must not leave set
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', endShiftChain);
      answered.dispose();
      pendingGroundOrders.dispose();
      orders.dispose();
      marquee.dispose();
      chrome.dispose();
      equipPicker?.dispose();
    },
  };
}
