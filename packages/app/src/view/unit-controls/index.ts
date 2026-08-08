import type { DoorBadge } from '@open-northland/render';
import { type Entity, systems } from '@open-northland/sim';
import { jobUnlockedForSelection } from '../../game/profession-unlocks.js';
import { mountUnitPanel, type UnitPanel } from '../../hud/details-panel/index.js';
import { isActionHotkey } from '../../hud/hotkeys.js';
import { clientToScreen, screenScale } from '../camera/index.js';
import { pickDoorBadgeRow, pickGarrisonFlag, pickInRect, pickTopAt, screenToWorld } from '../picking.js';
import { entityAnchor, memoBySnapshot, selectedWorkFlags } from '../projections/index.js';
import { mountSettlerActions, type SettlerActions, selectionCentre } from './action-ring/index.js';
import { type EquipPickController, mountEquipPicker } from './equip-picker.js';
import { createSelectionMarquee } from './marquee.js';
import { createUnitOrderController } from './orders.js';
import { createPickModeController } from './pick-mode.js';
import type { UnitControls, UnitControlsOptions } from './types.js';
import { createUnitTargets } from './unit-targets.js';

export type { UnitControls, UnitControlsOptions } from './types.js';

/**
 * App-layer select-and-command input: it reads the mouse and keyboard and issues sim commands through
 * the one-way seam, never touching sim state. Selection is client view state fed to the renderer's
 * rings; only the local player's entities are pickable, unless the session is an observer.
 */

/** Shared empty id set, so an empty selection allocates nothing per call. */
const EMPTY_IDS: ReadonlySet<number> = new Set();

const sameSelection = (a: ReadonlySet<number>, b: ReadonlySet<number>): boolean => {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

export async function createUnitControls(opts: UnitControlsOptions): Promise<UnitControls> {
  const { canvas } = opts;
  const selected = new Set<number>();
  // Memo key for the projections that read `selected`: snapshot identity alone cannot invalidate them,
  // because a click can re-select within one tick.
  let selectionVersion = 0;
  // Late-bound: the panel's worker-sprite callback needs `setSelection`, which closes over `panel`.
  let selectFromPanel: (id: number) => void = () => {};
  // Without the sim's pick-list seam the panel's equip and swap buttons stay inert.
  const equipPicker: EquipPickController | null =
    opts.equipPickList === undefined
      ? null
      : await mountEquipPicker({
          pickList: opts.equipPickList,
          goods: opts.content.goods,
          enqueue: opts.enqueue,
        });
  const panel: UnitPanel = await mountUnitPanel({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    lang: opts.lang,
    backingScale: (c: HTMLCanvasElement) => screenScale(c, opts.app.renderer.resolution),
    buildings: opts.content.buildings,
    goods: opts.content.goods,
    jobs: opts.content.jobs,
    jobExperience: opts.content.jobExperience,
    tribes: opts.content.tribes,
    // The sim's own classifications, so the panel and the recipe table cannot disagree.
    isLivestockWorkplace: (typeId) => systems.isLivestockWorkplaceType(opts.content, typeId),
    isLivestockGood: (goodType) => systems.livestockTribeOfGood(opts.content, goodType) !== null,
    livestockMeatGood: systems.livestockMeatGoodOf(opts.content),
    edibleGoodForm: (goodType) => systems.edibleGoodFormOf(opts.content, goodType),
    ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
    ...(opts.playerColourOf !== undefined ? { playerColourOf: opts.playerColourOf } : {}),
    onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
    onUpgrade: (id) => opts.enqueue({ kind: 'upgradeBuilding', building: id as Entity }),
    onCancelUpgrade: (id) => opts.enqueue({ kind: 'cancelUpgrade', building: id as Entity }),
    onDemolishSignpost: (id) => opts.enqueue({ kind: 'demolishSignpost', signpost: id as Entity }),
    onSetDefenceMode: (id, enabled) =>
      opts.enqueue({ kind: 'setDefenceMode', building: id as Entity, enabled }),
    onAssignWorkplace: (id) => pickMode.armWorkplace(id),
    onAssignHome: (id) => pickMode.armHome(id),
    // Neither release picks a target, so both enqueue directly instead of arming a pick mode.
    onUnassignWorkplace: (id) => opts.enqueue({ kind: 'unassignWorker', entity: id as Entity }),
    onUnassignHome: (id) => opts.enqueue({ kind: 'unassignHouse', entity: id as Entity }),
    onSetGatherGood: (id, goodType) =>
      opts.enqueue({ kind: 'setGatherGood', entity: id as Entity, goodType }),
    onSetCraftGoods: (id, goods) =>
      opts.enqueue({ kind: 'setCraftGoods', entity: id as Entity, goods: [...goods] }),
    ...(equipPicker !== null ? { onEquipSlot: (id, ref) => equipPicker.open(id, ref) } : {}),
    onUnequipSlot: (id, ref) =>
      opts.enqueue({ kind: 'unequipGood', entity: id as Entity, group: ref.group, slot: ref.slot }),
    onSelectEntity: (id) => selectFromPanel(id),
    // The original centres the view from its own controls (`housewindow` 116/117, `humanwindow` 100).
    // Approximation: this centres a building's base, so a tall house sits above centre after the jump.
    onCenterOnEntity: (id) => {
      const at = entityAnchor(opts.snapshot(), id, opts.elevation);
      if (at !== null) opts.centerOn(at.x, at.y);
    },
    ...(opts.tooltip !== undefined ? { tooltip: opts.tooltip } : {}),
  });
  // Mounted before this controller's own canvas listeners, so a click on a menu button consumes the
  // press and never falls through to selection or a move order.
  const actions: SettlerActions = await mountSettlerActions({
    app: opts.app,
    canvas,
    uiscale: opts.uiscale ?? 1,
    selectionCentre: memoBySnapshot(
      (snapshot) => selectionCentre(snapshot, selected),
      () => selectionVersion,
    ),
    professions: opts.professions,
    content: opts.content,
    jobUnlocked: (ids, jobType) => jobUnlockedForSelection(opts.content, opts.snapshot(), ids, jobType),
    onSetJob: (ids, jobType) => {
      for (const id of ids) opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
    },
    onErectSignpost: (ids) => pickMode.armSignpost(ids),
    onAttackMove: () => armAttackMove(),
    onMarry: (id) => opts.enqueue({ kind: 'marry', entity: id as Entity }),
    onAssignHouse: (id) => pickMode.armHome(id),
    onMakeChild: (id, sex) => opts.enqueue({ kind: 'makeChild', entity: id as Entity, child: sex }),
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

  /** Clickable door badges: an enemy building's sign chain must not select its settler. */
  const ownDoorBadges = (): readonly DoorBadge[] => {
    const badges = opts.doorBadges?.() ?? [];
    if (opts.observer === true) return badges;
    return badges.filter((b) => b.player === opts.humanPlayer);
  };

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
    if (unitTargets.ownedSettlersIn(selected).length === 0) return;
    actions.close();
    pickMode.armAttackMove();
  };

  const changed = (): void => {
    panel.render(opts.snapshot(), selected);
  };

  const setSelection = (ids: Iterable<number>, add: boolean): void => {
    const before = new Set(selected);
    if (!add) selected.clear();
    for (const id of ids) selected.add(id);
    if (!sameSelection(before, selected)) {
      selectionVersion++;
      pickMode.cancel();
    }
    changed();
    // Only a changed set closes the ring, so it never lingers on a stale unit while re-selecting the
    // same set leaves an open menu alone.
    if (!sameSelection(before, selected)) actions.close();
  };

  // Clicking a worker sprite in the details panel selects that settler alone, dropping the building.
  selectFromPanel = (id) => setSelection([id], false);

  const orders = createUnitOrderController({
    selected,
    targets: unitTargets,
    snapshot: opts.snapshot,
    content: opts.content,
    mapSize: opts.mapSize,
    ...(opts.elevation !== undefined ? { elevation: opts.elevation } : {}),
    toWorld,
    enqueue: opts.enqueue,
    selectOwnSettler: (id) => setSelection([id], false),
    openActions: (atClient) => actions.open(atClient),
  });

  const onMouseDown = (e: MouseEvent): void => {
    // The HUD claims its own clicks before any world picking. The ring claim covers the right button
    // too, since its own listener consumes left clicks only.
    if (opts.claimPointer?.(e.clientX, e.clientY) === true) return;
    // The details panel routes its buttons through the same claim, so no panel-owned listener races this one.
    if (panel.handleMouseDown(e.clientX, e.clientY, e.button, e.ctrlKey || e.metaKey)) return;
    if (actions.claimsPointer(e.clientX, e.clientY)) return;
    if (pickMode.handleMouseDown(e)) return;
    if (e.button === 2) {
      if (e.ctrlKey || e.metaKey) orders.issueSetWorkFlag(e);
      else {
        // A sign-chain row takes the right button as a plain select: without this mask the click reads
        // as a right-click on the settler idling below the door, or falls through into a move order.
        const w = toWorld(e.clientX, e.clientY);
        const badgeSettler = pickDoorBadgeRow(ownDoorBadges(), w.x, w.y, opts.elevation);
        // A garrison flag hands its click to the building, so right-clicking it posts selected soldiers there.
        if (badgeSettler !== null) setSelection([badgeSettler], false);
        else orders.issueRightClick(e, pickGarrisonFlag(ownDoorBadges(), w.x, w.y, opts.elevation));
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
      setSelection(pickInRect(unitTargets.owned(), a.x, a.y, b.x, b.y), e.shiftKey);
    } else {
      const w = toWorld(e.clientX, e.clientY);
      // Pick order matters: a sign row is a small target on a busy door that the building's own pixel
      // hit would otherwise swallow, and a signpost is direct-click only.
      const hit =
        pickDoorBadgeRow(ownDoorBadges(), w.x, w.y, opts.elevation) ??
        pickGarrisonFlag(ownDoorBadges(), w.x, w.y, opts.elevation) ??
        pickTopAt(unitTargets.owned(), w.x, w.y) ??
        pickTopAt(unitTargets.flags(), w.x, w.y) ??
        pickTopAt(unitTargets.signposts(), w.x, w.y);
      if (hit !== null) setSelection([hit], e.shiftKey);
      else if (!e.shiftKey) setSelection([], false);
    }
  };

  /** Memoized per tick and selection: the renderer reads these every frame. */
  const flaggedFlags = memoBySnapshot(
    (snapshot) => (selected.size === 0 ? EMPTY_IDS : selectedWorkFlags(snapshot, selected)),
    () => selectionVersion,
  );
  const flaggedFlagIds = (): ReadonlySet<number> => flaggedFlags(opts.snapshot());

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault(); // let the right button be a move order, not the browser menu
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (isActionHotkey(e, opts.bindings, 'actionRing')) {
      e.preventDefault(); // Space (the default binding) would otherwise scroll the page
      actions.toggle(); // the info card is always-on; the hotkey toggles only the action ring
    } else if (isActionHotkey(e, opts.bindings, 'attackMove')) {
      armAttackMove();
    } else if (e.code === 'Escape') {
      if (pickMode.isArmed())
        pickMode.cancel(); // Esc backs out of a pick mode first, keeping the selection
      else setSelection([], false);
    }
  };

  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);

  return {
    selectedIds: () => selected,
    selectionVersion: () => selectionVersion,
    portrait: () => panel.portrait(),
    flaggedFlagIds,
    assignHighlight: pickMode.highlight,
    signpostPlacementActive: pickMode.signpostActive,
    // Includes the details panel, so a consumer gating on this treats a point over the panel as HUD
    // rather than world.
    claimsPointer: (x, y) =>
      opts.claimPointer?.(x, y) === true || panel.claimsPointer(x, y) || actions.claimsPointer(x, y),
    tick: (snapshot) => {
      panel.tick(snapshot);
      // Re-anchors the ring on the selection's on-screen centroid; a no-op while it is closed.
      actions.update(opts.camera(), snapshot);
    },
    dispose: () => {
      pickMode.cancel(); // an armed mode owns the canvas cursor, which teardown must not leave set
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      marquee.dispose();
      panel.dispose();
      actions.dispose();
      equipPicker?.dispose();
    },
  };
}
