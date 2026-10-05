import type { UiCue } from '@open-northland/audio';
import { type Entity, systems, type UnlockStatus, type WorldSnapshot } from '@open-northland/sim';
import { holdsHaulFlagPost } from '../../game/snapshot.js';
import { technologyReason } from '../../game/technology.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import {
  mountUnitPanel,
  type PortraitBox,
  type UnitPanel,
  type UnitPanelModelContext,
} from '../../hud/details-panel/index.js';
import { createBuildingPanel } from '../../hud/dom/building-panel/view.js';
import { createGatePanel } from '../../hud/dom/gate-panel.js';
import { createGoodIconPainter } from '../../hud/dom/good-art.js';
import { createGroupPanel } from '../../hud/dom/group-panel/view.js';
import { createHoverCard } from '../../hud/dom/hover-card.js';
import type { ClientRect } from '../../hud/dom/portrait-hole.js';
import { createSettlerPanel } from '../../hud/dom/settler-panel/view.js';
import { createSignpostPanel } from '../../hud/dom/signpost-panel.js';
import { createTradeWindow, type HousePortrait } from '../../hud/dom/trade-window/window.js';
import { createVehiclePanel } from '../../hud/dom/vehicle-panel/view.js';
import { LiveFigures } from '../../hud/figures/live-figures.js';
import { clientToCanvas } from '../../hud/geometry.js';
import { type BuildingHoverContext, buildingHoverModel } from '../../hud/hover-card/building.js';
import type { BuildingHoverModel } from '../../hud/hover-card/model.js';
import { keyDisplayLabel } from '../../hud/keybindings.js';
import { createReplaceableMount } from '../../hud/replaceable-mount.js';
import { messages } from '../../i18n/index.js';
import { screenScale } from '../camera/index.js';
import { entityAnchor, memoBySnapshot } from '../projections/index.js';
import { createTooltip } from '../tooltip.js';
import { mountSettlerActions, type SettlerActions, selectionCentre } from './action-ring/index.js';
import type { AnsweredOrders } from './answered-orders.js';
import { buildingPanelActions, buildingPeers } from './building-panel.js';
import type { EquipPickController } from './equip-picker.js';
import { groupPanelActions } from './group-panel.js';
import { ownedOrder } from './owned-order.js';
import type { PickMode } from './pick-mode.js';
import { professionGates } from './profession-gates.js';
import type { UnitSelection } from './selection.js';
import { type SettlerContractCommands, settlerPanelActions } from './settler-panel.js';
import type { UnitControlsOptions } from './types.js';
import { armedVehiclePick, vehiclePanelActions, vehiclePeersOf } from './vehicle-panel.js';

const NO_SELECTION: ReadonlySet<number> = new Set();
const NO_FIGURES: ReadonlySet<number> = new Set();
/** Goods the warm-up paints icons of, enough to fill every icon slot of the warm model. */
const WARM_GOOD_ICONS = 12;
/** An unanswered technology read refuses, as every unanswered rule does. */
const UNANSWERED_STATUS: UnlockStatus = {
  allowed: false,
  enabled: false,
  enablingJobs: [],
  requiredJobs: [],
  requiredGoods: [],
};

interface MountedUnitChrome {
  readonly panel: UnitPanel;
  readonly actions: SettlerActions;
  dispose(): void;
}

export interface UnitChromeCallbacks {
  readonly assignWorkplace: (id: number) => void;
  readonly assignHome: (id: number) => void;
  readonly attachTradeHouse: (id: number) => void;
  readonly selectEntity: (id: number) => void;
  /** Arm a pick for a vehicle panel control, and read which one waits for its target. */
  readonly armPick: (mode: PickMode) => void;
  readonly armedPick: () => PickMode | null;
  /** Replace the selection with these entities; none clears it. */
  readonly selectGroup: (ids: readonly number[]) => void;
  readonly ringCommand: (id: ActionOrderId, targets: readonly number[]) => void;
  /** The GUI click feedback the ring's and the panel's buttons press with. */
  readonly cue: (cue: UiCue) => void;
  /** Runs a click's order once the host answered it, never after the controls are gone. */
  readonly answered: AnsweredOrders;
}

export interface UnitChromeHandle {
  /** The content and sim reads every details panel's model is built from. */
  readonly modelContext: UnitPanelModelContext;
  panel(): UnitPanel;
  actions(): SettlerActions;
  /** The live cutouts' boxes on the canvas: the selection's (a DOM panel's frame, else the Pixi
   *  panel's), then the trade window's houses while it is open. */
  portraits(): readonly PortraitBox[];
  /** True over any details panel or the trade window. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the next or previous person of the shown settler's trade, vehicle of the
   *  shown vehicle's class, or building of the shown building's type. */
  browse(step: 1 | -1): boolean;
  /** The upgrade key: raise the shown building's tier; false when no building is shown or it refuses. */
  upgradeBuilding(): boolean;
  /** Escape: close the trade window or the vehicle hold's picker; false when neither was open. */
  closeWindow(): boolean;
  windowOpen(): boolean;
  /** Once a frame: the trade window follows the plane and yields to a beam window, and the vehicle
   *  panel lights its armed order. */
  refreshWindows(): void;
  /** Once a frame: the shown building's or vehicle's wells draw their people as the map does. */
  presentFigures(snapshot: WorldSnapshot, alpha: number): void;
  /** The selected unit the HUD points at (a hovered group well), whose ring the map lights. */
  focusedIds(): ReadonlySet<number>;
  /** Show the selection on the panel, or nothing while the HUD is hidden. */
  renderPanel(snapshot: WorldSnapshot): void;
  setHudHidden(hidden: boolean): void;
  setUiScale(uiscale: number): Promise<void>;
  dispose(): void;
}

/** Own the scale-baked details panel and action ring around the stable unit-input controller. */
export async function createUnitChrome(
  opts: UnitControlsOptions,
  selection: UnitSelection,
  equipPicker: EquipPickController | null,
  callbacks: UnitChromeCallbacks,
): Promise<UnitChromeHandle> {
  // The settler panel's commands of the sim contract (`ProductionCounters.counters`, `renameSettler`).
  const contract: SettlerContractCommands = {
    rename: (id, name) => opts.enqueue({ kind: 'renameSettler', entity: id as Entity, name }),
    setProductionCount: (id, goodType, count) =>
      opts.enqueue({ kind: 'setProductionCount', entity: id as Entity, goodType, count }),
  };

  // Approximation: centring uses a building's base, so a tall house sits above the midpoint.
  const centre = (id: number): void => {
    const at = entityAnchor(opts.snapshot(), id, opts.elevation);
    if (at !== null) opts.centerOn(at.x, at.y);
  };
  const keyLabel = (action: 'actionRing'): string => {
    const binding = opts.bindings[action];
    return binding === null ? messages().mainMenu.settings.bindingUnassigned : keyDisplayLabel(binding);
  };
  // Its own card: the world hover hides the plane's shared one every frame the cursor is over the HUD.
  const icons = createGoodIconPainter(opts.domHud.pack, opts.content);
  const hoverCard = createHoverCard({
    plane: opts.domHud.plane,
    scale: opts.domHud.scale,
    icons,
    uiString: opts.domHud.uiString,
  });
  const hoverContext: BuildingHoverContext = {
    buildings: opts.content.buildings,
    goods: opts.content.goods,
    viewer: opts.viewer,
    seatNameOf: opts.seatNameOf,
    diplomacyStance: opts.diplomacyStance,
    playerColourOf: opts.playerColourOf,
  };
  /** One card model per house, snapshot and viewer seat: a move over a link then only repositions the
   *  card, and a spectator's seat switch reads the houses anew. */
  const hoverModels = memoBySnapshot(
    () => new Map<number, BuildingHoverModel | null>(),
    () => opts.viewer.version(),
  );
  const buildingHover = (id: number): BuildingHoverModel | null => {
    const snapshot = opts.snapshot();
    const models = hoverModels(snapshot);
    const known = models.get(id);
    if (known !== undefined) return known;
    const model = buildingHoverModel(snapshot, id, hoverContext);
    models.set(id, model);
    return model;
  };
  // Its own chip: the frame loop hides the ground tooltip whenever the pointer is over the HUD, which is
  // exactly where this one must stay shown.
  const panelChip = createTooltip();
  const settlerActions = settlerPanelActions(
    opts,
    {
      selectEntity: callbacks.selectEntity,
      selectGroup: callbacks.selectGroup,
      centre,
      openOrders: (press) => {
        const edge = tradeWindow.clientRight();
        mounts
          .current()
          .actions.open({ x: press.x, y: press.y, ...(edge === null ? {} : { keepRightOf: edge }) });
      },
      closeOrders: () => mounts.current().actions.close(),
      assignWorkplace: callbacks.assignWorkplace,
      assignHome: callbacks.assignHome,
      attachTradeHouse: callbacks.attachTradeHouse,
      ringCommand: callbacks.ringCommand,
      cue: callbacks.cue,
    },
    contract,
    equipPicker,
  );
  // One trade window for both panels: a trader's own and a trader's cart's Trade open it.
  const tradeWindow = createTradeWindow({
    plane: opts.domHud.plane,
    icons,
    tooltip: panelChip,
    hoverCard,
    buildingHover,
    actions: settlerActions,
    ...(opts.domHud.centralWindows !== undefined ? { centralWindows: opts.domHud.centralWindows } : {}),
  });
  // Mounted once on the plane, which scales as a whole: a HUD scale change remounts only the Pixi parts.
  const panelDeps = {
    plane: opts.domHud.plane,
    icons,
    residents: opts.domHud.residents,
    keyLabel,
    hoverCard,
    tooltip: panelChip,
    buildingHover,
    now: () => performance.now(),
    cue: callbacks.cue,
    tradeWindow,
    actions: settlerActions,
  };
  const settlerPanel = createSettlerPanel(panelDeps);
  const vehiclePanel = createVehiclePanel({
    ...panelDeps,
    vehicle: vehiclePanelActions({
      snapshot: opts.snapshot,
      viewer: opts.viewer,
      enqueue: opts.enqueue,
      arm: callbacks.armPick,
      cue: callbacks.cue,
    }),
    vehiclePeers: (vehicle) => vehiclePeersOf(opts.snapshot(), opts.content, vehicle),
    armedPick: (vehicle) => armedVehiclePick(callbacks.armedPick(), vehicle),
  });
  const groupActions = groupPanelActions(opts, {
    selectEntity: callbacks.selectEntity,
    selectGroup: callbacks.selectGroup,
    centre,
    openOrders: (press) => mounts.current().actions.open({ x: press.x, y: press.y }),
    closeOrders: () => mounts.current().actions.close(),
    ringCommand: callbacks.ringCommand,
    cue: callbacks.cue,
  });
  const groupPanel = createGroupPanel({
    plane: opts.domHud.plane,
    actions: groupActions,
    icons,
    tooltip: panelChip,
    keyLabel,
    reach: groupActions.reach,
  });
  const buildingPanel = createBuildingPanel({
    plane: opts.domHud.plane,
    icons,
    tooltip: panelChip,
    actions: settlerActions,
    building: buildingPanelActions({
      snapshot: opts.snapshot,
      viewer: opts.viewer,
      enqueue: opts.enqueue,
      cue: callbacks.cue,
    }),
    windows: {
      residentsFor: (jobType) => opts.domHud.centralWindows?.residentsFor(jobType),
      knowledge: (typeId) => opts.domHud.centralWindows?.knowledge(typeId),
    },
    buildingPeers: (building) => buildingPeers(opts.snapshot(), building),
  });
  const gatePanel = createGatePanel({
    plane: opts.domHud.plane,
    tooltip: panelChip,
    close: () => settlerActions.clearSelection(),
    mode: (id, mode) => {
      callbacks.cue('confirm');
      opts.enqueue({ kind: 'setPalisadeGateMode', palisade: id as Entity, mode });
    },
    demolish: (id) => {
      callbacks.cue('confirm');
      opts.enqueue({ kind: 'demolishPalisade', palisade: id as Entity });
    },
  });
  const signpostPanel = createSignpostPanel({
    plane: opts.domHud.plane,
    icons,
    tooltip: panelChip,
    close: () => callbacks.selectGroup([]),
    demolish: ownedOrder(
      opts.snapshot,
      opts.viewer,
      callbacks.cue,
    )((id) => opts.enqueue({ kind: 'demolishSignpost', signpost: id as Entity })),
  });
  const figures = opts.domHud.figures;
  const wellFigures =
    figures === undefined ? null : new LiveFigures(figures.sheet, figures.frames, opts.playerColourOf);
  const canvasRect = (client: ClientRect): PortraitBox['rect'] => {
    const scale = screenScale(opts.canvas, opts.app.renderer.resolution);
    const { left, top, width, height } = client;
    const from = clientToCanvas(scale, left, top);
    const to = clientToCanvas(scale, left + width, top + height);
    return { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y };
  };
  /** The canvas box of the DOM portrait, converted once per measured client box and subject. */
  let portraitMemo: { client: ClientRect; box: PortraitBox } | null = null;
  const domPortrait = (): PortraitBox | null => {
    const shown = settlerPanel.portrait() ?? vehiclePanel.portrait() ?? buildingPanel.portrait();
    if (shown === null) return null;
    const inside = 'inside' in shown ? shown.inside : undefined;
    const aboard = 'aboard' in shown ? shown.aboard : undefined;
    if (
      portraitMemo?.client !== shown.rect ||
      portraitMemo.box.entityRef !== shown.entityRef ||
      portraitMemo.box.kind !== shown.kind ||
      portraitMemo.box.inside !== inside ||
      portraitMemo.box.aboard !== aboard
    ) {
      portraitMemo = {
        client: shown.rect,
        box: {
          entityRef: shown.entityRef,
          kind: shown.kind,
          ...(inside === undefined ? {} : { inside }),
          ...(aboard === undefined ? {} : { aboard }),
          rect: canvasRect(shown.rect),
        },
      };
    }
    return portraitMemo.box;
  };
  /** The trade window's house portraits on the canvas, converted once per list the window measured. */
  let housesMemo: { client: readonly HousePortrait[]; boxes: readonly PortraitBox[] } | null = null;
  const housePortraits = (): readonly PortraitBox[] => {
    const shown = tradeWindow.portraits();
    if (housesMemo?.client !== shown) {
      housesMemo = {
        client: shown,
        boxes: shown.map((house) => ({
          entityRef: house.entityRef,
          kind: 'building',
          rect: canvasRect(house.rect),
        })),
      };
    }
    return housesMemo.boxes;
  };
  /** Every portrait of the frame, the selection's first; the same list while its boxes are the same. */
  let portraitsMemo: {
    selected: PortraitBox | null;
    houses: readonly PortraitBox[];
    list: readonly PortraitBox[];
  } | null = null;
  const portraits = (): readonly PortraitBox[] => {
    const selected = domPortrait();
    const houses = housePortraits();
    if (portraitsMemo?.selected !== selected || portraitsMemo.houses !== houses) {
      portraitsMemo = { selected, houses, list: selected === null ? houses : [selected, ...houses] };
    }
    return portraitsMemo.list;
  };

  const modelContext: UnitPanelModelContext = {
    viewer: opts.viewer,
    technologyReason:
      opts.technologyStatus === undefined
        ? undefined
        : (kind, typeId, tribe, player) =>
            technologyReason(
              opts.content,
              opts.technologyStatus?.(kind, typeId, tribe, player) ?? UNANSWERED_STATUS,
            ),
    goodAllowed: (good, tribe, player) =>
      opts.technologyStatus === undefined ||
      opts.technologyStatus('good', good, tribe, player)?.allowed === true,
    buildings: opts.content.buildings,
    goods: opts.content.goods,
    jobs: opts.content.jobs,
    jobExperience: opts.content.jobExperience,
    tribes: opts.content.tribes,
    ...(opts.standsTo !== undefined ? { standsTo: opts.standsTo } : {}),
    vehicles: opts.content.vehicles,
    weapons: opts.content.weapons,
    armor: opts.content.armor,
    isLivestockWorkplace: (typeId) => systems.isLivestockWorkplaceType(opts.content, typeId),
    usesWorkFlag: (jobType) => systems.jobUsesWorkFlag({ content: opts.content }, jobType),
    holdsHaulFlagPost: (snapshot, ent) => holdsHaulFlagPost(opts.content, snapshot, ent),
    livestockTribeOfGood: (goodType) => systems.livestockTribeOfGood(opts.content, goodType),
    edibleGoodForm: (goodType) => systems.edibleGoodFormOf(opts.content, goodType),
    isTraderJob: (jobType) => systems.isTraderJob(opts.content, jobType),
    ...(opts.mapText !== undefined ? { mapText: opts.mapText } : {}),
    ...(opts.signpostReach !== undefined ? { signpostReach: opts.signpostReach } : {}),
    ...(opts.traderView !== undefined ? { traderView: opts.traderView } : {}),
    ...(opts.tradeOffersAt !== undefined ? { tradeOffersAt: opts.tradeOffersAt } : {}),
    ...(opts.workStatus !== undefined ? { workStatus: opts.workStatus } : {}),
    ...(opts.diplomacyStance !== undefined ? { diplomacyStance: opts.diplomacyStance } : {}),
  };

  const mountPanel = (uiscale: number): Promise<UnitPanel> =>
    mountUnitPanel({
      ...modelContext,
      app: opts.app,
      canvas: opts.canvas,
      uiscale,
      lang: opts.lang,
      backingScale: (canvas) => screenScale(canvas, opts.app.renderer.resolution),
      ...(opts.panelAnswersVersion !== undefined ? { answersVersion: opts.panelAnswersVersion } : {}),
      onUiCue: callbacks.cue,
      onDemolishPalisade: (id) => opts.enqueue({ kind: 'demolishPalisade', palisade: id as Entity }),
      onCancelRoadSite: (id) => opts.enqueue({ kind: 'cancelRoadSite', roadSite: id as Entity }),
      onModel: (model) => {
        settlerPanel.update(model);
        vehiclePanel.update(model);
        buildingPanel.update(model);
        groupPanel.update(model);
        gatePanel.update(model);
        signpostPanel.update(model);
      },
    });

  const mountActions = (uiscale: number): Promise<SettlerActions> =>
    mountSettlerActions({
      app: opts.app,
      canvas: opts.canvas,
      uiscale,
      selectionCentre: memoBySnapshot(
        (snapshot) => selectionCentre(snapshot, selection.ids()),
        selection.version,
      ),
      professions: opts.professions,
      content: opts.content,
      ...professionGates({
        content: opts.content,
        snapshot: opts.snapshot,
        canChooseJob: opts.canChooseJob,
        askCanChooseJob: opts.askCanChooseJob,
        technologyStatus: opts.technologyStatus,
        answered: callbacks.answered,
        enqueue: opts.enqueue,
      }),
      jobAnswersVersion: () => opts.jobChoicesVersion() + (opts.technologyVersion?.() ?? 0),
      onCommand: callbacks.ringCommand,
      cue: callbacks.cue,
    });

  const mount = async (uiscale: number): Promise<MountedUnitChrome> => {
    const panel = await mountPanel(uiscale);
    let actions: SettlerActions;
    try {
      actions = await mountActions(uiscale);
    } catch (error: unknown) {
      panel.dispose();
      throw error;
    }
    return {
      panel,
      actions,
      dispose(): void {
        panel.dispose();
        actions.dispose();
      },
    };
  };

  let hudHidden = false;
  /** The one-id set the map lights, the same object while the hovered well holds. */
  let focusMemo: ReadonlySet<number> = NO_SELECTION;
  const panelIds = (): ReadonlySet<number> => (hudHidden ? NO_SELECTION : selection.ids());
  // Behind the loading screen: the panels' styles raster once now, not on the first click.
  const warmGoods = opts.content.goods.slice(0, WARM_GOOD_ICONS).map((good) => good.id);
  settlerPanel.warm(warmGoods);
  vehiclePanel.warm(warmGoods);
  buildingPanel.warm(warmGoods);
  groupPanel.warm();
  const mounts = createReplaceableMount(await mount(opts.uiscale ?? 1), mount, (next, previous) => {
    const snapshot = opts.snapshot();
    next.panel.render(snapshot, panelIds());
    next.actions.restore(previous.actions.state());
    next.actions.update(opts.camera(), snapshot);
  });
  return {
    modelContext,
    panel: () => mounts.current().panel,
    actions: () => mounts.current().actions,
    portraits,
    claimsPointer: (x, y) =>
      settlerPanel.claims(x, y) ||
      vehiclePanel.claims(x, y) ||
      buildingPanel.claims(x, y) ||
      groupPanel.claims(x, y) ||
      gatePanel.claims(x, y) ||
      signpostPanel.claims(x, y) ||
      tradeWindow.claims(x, y) ||
      mounts.current().panel.claimsPointer(x, y),
    browse: (step) => settlerPanel.browse(step) || vehiclePanel.browse(step) || buildingPanel.browse(step),
    upgradeBuilding: () => buildingPanel.upgrade(),
    closeWindow: () => {
      if (tradeWindow.isOpen()) {
        tradeWindow.dismiss();
        return true;
      }
      return vehiclePanel.closePicker();
    },
    windowOpen: () => tradeWindow.isOpen(),
    refreshWindows: () => {
      tradeWindow.refresh();
      settlerPanel.refresh();
      vehiclePanel.refresh();
      gatePanel.refreshTip();
      buildingPanel.refresh();
      groupPanel.refresh();
      signpostPanel.refresh();
    },
    presentFigures: (snapshot, alpha) => {
      // One details panel shows at a time; the hidden ones answer no slots.
      const building = buildingPanel.figureSlots();
      const vehicle = building.length > 0 ? building : vehiclePanel.figureSlots();
      const slots = vehicle.length > 0 ? vehicle : groupPanel.figureSlots();
      // Painting no slots drops the tracks, so a panel shown again does not resume an old gait.
      const drawn =
        wellFigures === null ? NO_FIGURES : wellFigures.paint(snapshot, slots, snapshot.tick, alpha);
      buildingPanel.markDrawn(drawn);
      vehiclePanel.markDrawn(drawn);
      groupPanel.markDrawn(drawn);
    },
    focusedIds: () => {
      const id = groupPanel.focused();
      if (id === null) return NO_SELECTION;
      if (!focusMemo.has(id)) focusMemo = new Set([id]);
      return focusMemo;
    },
    renderPanel: (snapshot) => mounts.current().panel.render(snapshot, panelIds()),
    setHudHidden: (hidden) => {
      hudHidden = hidden;
      const { panel, actions } = mounts.current();
      if (hidden) actions.close();
      panel.render(opts.snapshot(), panelIds());
    },
    setUiScale: (uiscale) => {
      settlerPanel.invalidate();
      vehiclePanel.invalidate();
      buildingPanel.invalidate();
      groupPanel.invalidate();
      signpostPanel.invalidate();
      tradeWindow.invalidate();
      return mounts.replace(uiscale);
    },
    dispose: () => {
      mounts.dispose();
      tradeWindow.dispose();
      settlerPanel.dispose();
      vehiclePanel.dispose();
      buildingPanel.dispose();
      groupPanel.dispose();
      gatePanel.dispose();
      signpostPanel.dispose();
      hoverCard.dispose();
      panelChip.destroy();
    },
  };
}
