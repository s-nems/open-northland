import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, systems, type WorldSnapshot } from '@open-northland/sim';
import { num, ownerPlayerOf } from '../../game/snapshot.js';
import { technologyReason } from '../../game/technology.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import { mountUnitPanel, type UnitPanel, type UnitPanelState } from '../../hud/details-panel/index.js';
import { createReplaceableMount } from '../../hud/replaceable-mount.js';
import { messages } from '../../i18n/index.js';
import { screenScale } from '../camera/index.js';
import { entityAnchor, memoBySnapshot } from '../projections/index.js';
import {
  mountSettlerActions,
  orderRecipients,
  type SettlerActions,
  selectionCentre,
} from './action-ring/index.js';
import type { EquipPickController } from './equip-picker.js';
import type { UnitSelection } from './selection.js';
import type { UnitControlsOptions } from './types.js';

const NO_SELECTION: ReadonlySet<number> = new Set();

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
  readonly ringCommand: (id: ActionOrderId, targets: readonly number[]) => void;
  /** The GUI click feedback the ring's and the panel's buttons press with. */
  readonly cue: (cue: UiCue) => void;
}

export interface UnitChromeHandle {
  panel(): UnitPanel;
  actions(): SettlerActions;
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
      isLivestockWorkplace: (typeId) => systems.isLivestockWorkplaceType(opts.content, typeId),
      livestockTribeOfGood: (goodType) => systems.livestockTribeOfGood(opts.content, goodType),
      edibleGoodForm: (goodType) => systems.edibleGoodFormOf(opts.content, goodType),
      ...(opts.mapText !== undefined ? { mapText: opts.mapText } : {}),
      ...(opts.sheet !== undefined ? { sheet: opts.sheet } : {}),
      ...(opts.packGoods !== undefined ? { packGoods: opts.packGoods } : {}),
      ...(opts.playerColourOf !== undefined ? { playerColourOf: opts.playerColourOf } : {}),
      onUiCue: callbacks.cue,
      onDemolish: (id) => opts.enqueue({ kind: 'demolish', building: id as Entity }),
      onUpgrade: (id) => opts.enqueue({ kind: 'upgradeBuilding', building: id as Entity }),
      onCancelUpgrade: (id) => opts.enqueue({ kind: 'cancelUpgrade', building: id as Entity }),
      onDemolishSignpost: (id) => opts.enqueue({ kind: 'demolishSignpost', signpost: id as Entity }),
      onSetDefenceMode: (id, enabled) =>
        opts.enqueue({ kind: 'setDefenceMode', building: id as Entity, enabled }),
      onSetHouseholdGoodUse: (player, effect, allowed) =>
        opts.enqueue({ kind: 'setHouseholdGoodUse', player, effect, allowed }),
      onAssignWorkplace: callbacks.assignWorkplace,
      onAssignHome: callbacks.assignHome,
      onUnassignWorkplace: (id) => opts.enqueue({ kind: 'unassignWorker', entity: id as Entity }),
      onUnassignHome: (id) => opts.enqueue({ kind: 'unassignHouse', entity: id as Entity }),
      onAttachTradeHouse: callbacks.attachTradeHouse,
      onDetachTradeHouse: (id, house) =>
        opts.enqueue({ kind: 'detachTradeHouse', entity: id as Entity, house: house as Entity }),
      onSetTradeImport: (id, house, good, on) =>
        opts.enqueue({ kind: 'setTradeImport', entity: id as Entity, house: house as Entity, good, on }),
      onSetTradeAgreement: (id, agreement) =>
        opts.enqueue({ kind: 'setTradeAgreement', entity: id as Entity, agreement }),
      ...(opts.traderView !== undefined ? { traderView: opts.traderView } : {}),
      ...(opts.tradeOffersAt !== undefined ? { tradeOffersAt: opts.tradeOffersAt } : {}),
      onSetGatherGood: (id, goodType) =>
        opts.enqueue({ kind: 'setGatherGood', entity: id as Entity, goodType }),
      onSetCraftGoods: (id, goods) =>
        opts.enqueue({ kind: 'setCraftGoods', entity: id as Entity, goods: [...goods] }),
      ...(equipPicker !== null ? { onEquipSlot: (id, ref) => equipPicker.open(id, ref) } : {}),
      onUnequipSlot: (id, ref) =>
        opts.enqueue({ kind: 'unequipGood', entity: id as Entity, group: ref.group, slot: ref.slot }),
      onSelectEntity: callbacks.selectEntity,
      // Approximation: centring uses a building's base, so a tall house sits above the midpoint.
      onCenterOnEntity: (id) => {
        const at = entityAnchor(opts.snapshot(), id, opts.elevation);
        if (at !== null) opts.centerOn(at.x, at.y);
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
    setUiScale: (uiscale) => mounts.replace(uiscale),
    dispose: mounts.dispose,
  };
}
