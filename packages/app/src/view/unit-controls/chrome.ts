import { type Entity, systems } from '@open-northland/sim';
import { jobUnlockedForSelection } from '../../game/profession-unlocks.js';
import { mountUnitPanel, type UnitPanel } from '../../hud/details-panel/index.js';
import { createReplaceableMount } from '../../hud/replaceable-mount.js';
import { screenScale } from '../camera/index.js';
import { entityAnchor, memoBySnapshot } from '../projections/index.js';
import { mountSettlerActions, type SettlerActions, selectionCentre } from './action-ring/index.js';
import type { EquipPickController } from './equip-picker.js';
import type { UnitSelection } from './selection.js';
import type { UnitControlsOptions } from './types.js';

interface MountedUnitChrome {
  readonly panel: UnitPanel;
  readonly actions: SettlerActions;
  dispose(): void;
}

export interface UnitChromeCallbacks {
  readonly assignWorkplace: (id: number) => void;
  readonly assignHome: (id: number) => void;
  readonly selectEntity: (id: number) => void;
  readonly erectSignpost: (ids: readonly number[]) => void;
  readonly attackMove: () => void;
}

export interface UnitChromeHandle {
  panel(): UnitPanel;
  actions(): SettlerActions;
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
      backingScale: (canvas) => screenScale(canvas, opts.app.renderer.resolution),
      buildings: opts.content.buildings,
      goods: opts.content.goods,
      jobs: opts.content.jobs,
      jobExperience: opts.content.jobExperience,
      tribes: opts.content.tribes,
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
      onAssignWorkplace: callbacks.assignWorkplace,
      onAssignHome: callbacks.assignHome,
      onUnassignWorkplace: (id) => opts.enqueue({ kind: 'unassignWorker', entity: id as Entity }),
      onUnassignHome: (id) => opts.enqueue({ kind: 'unassignHouse', entity: id as Entity }),
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
      jobUnlocked: (ids, jobType) => jobUnlockedForSelection(opts.content, opts.snapshot(), ids, jobType),
      onSetJob: (ids, jobType) => {
        for (const id of ids) opts.enqueue({ kind: 'setJob', entity: id as Entity, jobType });
      },
      onErectSignpost: callbacks.erectSignpost,
      onAttackMove: callbacks.attackMove,
      onMarry: (id) => opts.enqueue({ kind: 'marry', entity: id as Entity }),
      onAssignHouse: callbacks.assignHome,
      onMakeChild: (id, sex) => opts.enqueue({ kind: 'makeChild', entity: id as Entity, child: sex }),
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

  const mounts = createReplaceableMount(await mount(opts.uiscale ?? 1), mount, (next, previous) => {
    const snapshot = opts.snapshot();
    next.panel.render(snapshot, selection.ids());
    next.panel.restore(previous.panel.state());
    next.actions.restore(previous.actions.state());
    next.actions.update(opts.camera(), snapshot);
  });
  return {
    panel: () => mounts.current().panel,
    actions: () => mounts.current().actions,
    setUiScale: (uiscale) => mounts.replace(uiscale),
    dispose: mounts.dispose,
  };
}
