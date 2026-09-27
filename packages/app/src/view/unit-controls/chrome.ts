import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { num, ownerPlayerOf } from '../../game/snapshot.js';
import { technologyReason, vehicleLabel } from '../../game/technology.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import {
  mountUnitPanel,
  type PortraitBox,
  type UnitPanel,
  type UnitPanelState,
} from '../../hud/details-panel/index.js';
import { createGoodIconPainter } from '../../hud/dom/good-art.js';
import { createHoverCard } from '../../hud/dom/hover-card.js';
import type { ClientRect } from '../../hud/dom/portrait-hole.js';
import { createSettlerPanel } from '../../hud/dom/settler-panel/view.js';
import { createTradeWindow, type HousePortrait } from '../../hud/dom/trade-window/window.js';
import { createVehiclePanel } from '../../hud/dom/vehicle-panel/view.js';
import { clientToCanvas } from '../../hud/geometry.js';
import { buildingHoverModel } from '../../hud/hover-card/building.js';
import type { BuildingHoverModel } from '../../hud/hover-card/model.js';
import { keyDisplayLabel } from '../../hud/keybindings.js';
import { createReplaceableMount } from '../../hud/replaceable-mount.js';
import { messages } from '../../i18n/index.js';
import { screenScale } from '../camera/index.js';
import { entityAnchor, memoBySnapshot } from '../projections/index.js';
import { createTooltip } from '../tooltip.js';
import {
  mountSettlerActions,
  orderRecipients,
  type SettlerActions,
  selectionCentre,
} from './action-ring/index.js';
import type { EquipPickController } from './equip-picker.js';
import type { PickMode } from './pick-mode.js';
import { createRingVeil } from './ring-veil.js';
import type { UnitSelection } from './selection.js';
import { type SettlerContractCommands, settlerPanelActions } from './settler-panel.js';
import type { UnitControlsOptions } from './types.js';
import { armedVehiclePick, vehiclePanelActions, vehiclePeersOf } from './vehicle-panel.js';

const NO_SELECTION: ReadonlySet<number> = new Set();
/** Goods the warm-up paints icons of, enough to fill every icon slot of the warm model. */
const WARM_GOOD_ICONS = 12;

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
}

export interface UnitChromeHandle {
  panel(): UnitPanel;
  actions(): SettlerActions;
  /** The live cutouts' boxes on the canvas: the selection's (a DOM panel's frame, else the Pixi
   *  panel's), then the trade window's houses while it is open. */
  portraits(): readonly PortraitBox[];
  /** True over any details panel or the trade window. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Tab and Shift+Tab: show the next or previous person of the shown settler's trade, or vehicle of
   *  the shown vehicle's class. */
  browse(step: 1 | -1): boolean;
  /** Escape: close the trade window or the vehicle hold's picker; false when neither was open. */
  closeWindow(): boolean;
  windowOpen(): boolean;
  /** Once a frame: the settler panel comes back once the ring it stepped aside for is down, the trade
   *  window follows the plane and yields to a beam window, and the vehicle panel lights its armed
   *  order. */
  refreshWindows(): void;
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
  const hoverCard = createHoverCard({
    plane: opts.domHud.plane,
    scale: opts.domHud.scale,
    pack: opts.domHud.pack,
    uiString: opts.domHud.uiString,
  });
  const hoverContext = { buildings: opts.content.buildings, goods: opts.content.goods };
  /** One card model per house and snapshot: a move over a link then only repositions the card. */
  const hoverModels = memoBySnapshot(() => new Map<number, BuildingHoverModel | null>());
  const buildingHover = (id: number): BuildingHoverModel | null => {
    const snapshot = opts.snapshot();
    const models = hoverModels(snapshot);
    const known = models.get(id);
    if (known !== undefined) return known;
    const model = buildingHoverModel(snapshot, id, hoverContext);
    models.set(id, model);
    return model;
  };
  // Its own chip: the Pixi details panel hides the shared one on every canvas mouse move off its rows.
  const panelChip = createTooltip();
  // The ring is down when it closed, or when its selection went and it lost its pin.
  const veil = createRingVeil({ veil: (on) => settlerPanel.veil(on) }, () => {
    const ring = mounts.current().actions.state();
    return ring.mode !== 'closed' && ring.anchor !== null;
  });
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
        veil.raise();
      },
      assignWorkplace: callbacks.assignWorkplace,
      assignHome: callbacks.assignHome,
      attachTradeHouse: callbacks.attachTradeHouse,
      ringCommand: callbacks.ringCommand,
      cue: callbacks.cue,
    },
    contract,
    equipPicker,
  );
  const icons = createGoodIconPainter(opts.domHud.pack);
  // One trade window for both panels: a trader's own and a trader's cart's Handel open it.
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
    const shown = settlerPanel.portrait() ?? vehiclePanel.portrait();
    if (shown === null) return null;
    if (
      portraitMemo?.client !== shown.rect ||
      portraitMemo.box.entityRef !== shown.entityRef ||
      portraitMemo.box.kind !== shown.kind ||
      portraitMemo.box.inside !== ('inside' in shown ? shown.inside : undefined) ||
      portraitMemo.box.aboard !== shown.aboard
    ) {
      portraitMemo = {
        client: shown.rect,
        box: {
          entityRef: shown.entityRef,
          kind: shown.kind,
          ...('inside' in shown && shown.inside !== undefined ? { inside: shown.inside } : {}),
          ...(shown.aboard === undefined ? {} : { aboard: shown.aboard }),
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
  /** Every portrait of the frame, the settler's first; the same list while its boxes are the same. */
  let portraitsMemo: {
    settler: PortraitBox | null;
    houses: readonly PortraitBox[];
    list: readonly PortraitBox[];
  } | null = null;
  const portraits = (): readonly PortraitBox[] => {
    const settler = domPortrait() ?? mounts.current().panel.portrait();
    const houses = housePortraits();
    if (portraitsMemo?.settler !== settler || portraitsMemo.houses !== houses) {
      portraitsMemo = { settler, houses, list: settler === null ? houses : [settler, ...houses] };
    }
    return portraitsMemo.list;
  };

  const mountPanel = (uiscale: number): Promise<UnitPanel> =>
    mountUnitPanel({
      app: opts.app,
      canvas: opts.canvas,
      uiscale,
      lang: opts.lang,
      viewer: opts.viewer,
      backingScale: (canvas) => screenScale(canvas, opts.app.renderer.resolution),
      technologyReason:
        opts.technologyStatus === undefined
          ? undefined
          : (kind, typeId, tribe, player) =>
              technologyReason(
                opts.content,
                opts.technologyStatus?.(kind, typeId, tribe, player) ?? {
                  allowed: true,
                  enabled: true,
                  enablingJobs: [],
                  requiredJobs: [],
                  requiredGoods: [],
                },
              ),
      goodAllowed: (good, tribe, player) =>
        opts.technologyStatus?.('good', good, tribe, player).allowed ?? true,
      buildings: opts.content.buildings,
      goods: opts.content.goods,
      jobs: opts.content.jobs,
      jobExperience: opts.content.jobExperience,
      tribes: opts.content.tribes,
      ...(opts.standsTo !== undefined ? { standsTo: opts.standsTo } : {}),
      vehicles: opts.content.vehicles,
      isLivestockWorkplace: (typeId) => systems.isLivestockWorkplaceType(opts.content, typeId),
      usesWorkFlag: (jobType) => systems.jobUsesWorkFlag({ content: opts.content }, jobType),
      livestockTribeOfGood: (goodType) => systems.livestockTribeOfGood(opts.content, goodType),
      edibleGoodForm: (goodType) => systems.edibleGoodFormOf(opts.content, goodType),
      vehicleLabel: (typeId) => vehicleLabel(opts.content, typeId),
      isTraderJob: (jobType) => systems.isTraderJob(opts.content, jobType),
      ...(opts.mapText !== undefined ? { mapText: opts.mapText } : {}),
      ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
      ...(opts.packGoods !== undefined ? { packGoods: opts.packGoods } : {}),
      ...(opts.playerColourOf !== undefined ? { playerColourOf: opts.playerColourOf } : {}),
      onUiCue: callbacks.cue,
      onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
      onUpgrade: (id) => opts.enqueue({ kind: 'upgradeBuilding', building: id as Entity }),
      onCancelUpgrade: (id) => opts.enqueue({ kind: 'cancelUpgrade', building: id as Entity }),
      onDemolishSignpost: (id) => opts.enqueue({ kind: 'demolishSignpost', signpost: id as Entity }),
      onDemolishPalisade: (id) => opts.enqueue({ kind: 'demolishPalisade', palisade: id as Entity }),
      onSetPalisadeGate: (id, open) =>
        opts.enqueue({ kind: 'setPalisadeGate', palisade: id as Entity, open }),
      onSetDefenceMode: (id, enabled) =>
        opts.enqueue({ kind: 'setDefenceMode', building: id as Entity, enabled }),
      onSetHouseholdGoodUse: (player, effect, allowed) =>
        opts.enqueue({ kind: 'setHouseholdGoodUse', player, effect, allowed }),
      ...(opts.traderView !== undefined ? { traderView: opts.traderView } : {}),
      ...(opts.tradeOffersAt !== undefined ? { tradeOffersAt: opts.tradeOffersAt } : {}),
      ...(opts.workStatus !== undefined ? { workStatus: opts.workStatus } : {}),
      ...(opts.diplomacyStance !== undefined ? { diplomacyStance: opts.diplomacyStance } : {}),
      onSelectEntity: callbacks.selectEntity,
      onCenterOnEntity: centre,
      onModel: (model) => {
        settlerPanel.update(model);
        vehiclePanel.update(model);
      },
      ...(opts.tooltip !== undefined ? { tooltip: opts.tooltip } : {}),
    });

  /** The selection's settlers the ring's profession order reaches. */
  const professionTargets = (ids: readonly number[]): number[] =>
    orderRecipients(opts.content, opts.snapshot(), ids, 'changeProfession');
  /** Of those, the ones that have earned `jobType`; the picker offers a job when any of them has. */
  const professionTakers = (ids: readonly number[], jobType: number): number[] =>
    professionTargets(ids).filter((id) => opts.canChooseJob(id, jobType));
  const currentProfession = (id: number): number | undefined =>
    num((entityById(opts.snapshot(), id)?.components.Settler as { jobType?: unknown } | undefined)?.jobType);

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
      jobVisible: (ids, jobType) =>
        professionTakers(ids, jobType).length > 0 ||
        professionTargets(ids).some((id) => currentProfession(id) === jobType),
      jobUnlocked: (ids, jobType) => professionTargets(ids).some((id) => opts.canChooseJob(id, jobType)),
      jobBlockedReason: (ids, jobType) => {
        for (const id of professionTargets(ids)) {
          const ent = entityById(opts.snapshot(), id);
          if (ent === undefined) continue;
          const tribe = num((ent.components.Settler as { tribe?: unknown } | undefined)?.tribe);
          if (tribe === undefined) continue;
          const status = opts.technologyStatus?.('job', jobType, tribe, ownerPlayerOf(ent));
          if (status !== undefined) {
            const reason = technologyReason(opts.content, status);
            if (reason !== null) return reason;
          }
        }
        return messages().hud.technologyExperience;
      },
      onSetJob: (ids, jobType) => {
        for (const id of professionTakers(ids, jobType)) {
          opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
        }
      },
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
  const panelIds = (): ReadonlySet<number> => (hudHidden ? NO_SELECTION : selection.ids());
  /** The stock tab the hide found, given back on show while the selection is the same one. */
  let keptPanel: { readonly state: UnitPanelState; readonly version: number } | null = null;
  // Behind the loading screen: the panels' styles raster once now, not on the first click.
  const warmGoods = opts.content.goods.slice(0, WARM_GOOD_ICONS).map((good) => good.id);
  settlerPanel.warm(warmGoods);
  vehiclePanel.warm(warmGoods);
  const mounts = createReplaceableMount(await mount(opts.uiscale ?? 1), mount, (next, previous) => {
    const snapshot = opts.snapshot();
    next.panel.render(snapshot, panelIds());
    next.panel.restore(previous.panel.state());
    next.actions.restore(previous.actions.state());
    next.actions.update(opts.camera(), snapshot);
  });
  return {
    panel: () => mounts.current().panel,
    actions: () => mounts.current().actions,
    portraits,
    claimsPointer: (x, y) =>
      settlerPanel.claims(x, y) ||
      vehiclePanel.claims(x, y) ||
      tradeWindow.claims(x, y) ||
      mounts.current().panel.claimsPointer(x, y),
    browse: (step) => settlerPanel.browse(step) || vehiclePanel.browse(step),
    closeWindow: () => {
      if (tradeWindow.isOpen()) {
        tradeWindow.dismiss();
        return true;
      }
      return vehiclePanel.closePicker();
    },
    windowOpen: () => tradeWindow.isOpen(),
    refreshWindows: () => {
      veil.refresh();
      tradeWindow.refresh();
      settlerPanel.refresh();
      vehiclePanel.refresh();
    },
    renderPanel: (snapshot) => mounts.current().panel.render(snapshot, panelIds()),
    setHudHidden: (hidden) => {
      hudHidden = hidden;
      const { panel, actions } = mounts.current();
      if (hidden) {
        keptPanel = { state: panel.state(), version: selection.version() };
        actions.close();
      }
      panel.render(opts.snapshot(), panelIds());
      if (!hidden && keptPanel?.version === selection.version()) panel.restore(keptPanel.state);
      if (!hidden) keptPanel = null;
    },
    setUiScale: (uiscale) => {
      settlerPanel.invalidate();
      vehiclePanel.invalidate();
      tradeWindow.invalidate();
      return mounts.replace(uiscale);
    },
    dispose: () => {
      mounts.dispose();
      tradeWindow.dispose();
      settlerPanel.dispose();
      vehiclePanel.dispose();
      hoverCard.dispose();
      panelChip.destroy();
    },
  };
}
