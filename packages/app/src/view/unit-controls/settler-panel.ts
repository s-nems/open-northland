import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, type NeedKind } from '@open-northland/sim';
import { ownerPlayerOf } from '../../game/snapshot.js';
import { pickableSeat } from '../../game/viewer-seat.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import type { SettlerPanelActions } from '../../hud/dom/settler-panel/actions.js';
import { NEED_ORDER } from '../../hud/dom/settler-panel/needs.js';
import type { EquipPickController } from './equip-picker.js';
import type { UnitControlsOptions } from './types.js';

/** The commands of the settler panel's sim contract, which `chrome.ts` builds. */
export interface SettlerContractCommands {
  readonly rename: (id: number, name: string) => void;
  readonly setProductionCount: (id: number, goodType: number, count: number) => void;
}

/** What the unit controls do for the panel beyond submitting a command. */
export interface SettlerPanelHost {
  readonly selectEntity: (id: number) => void;
  readonly selectGroup: (ids: readonly number[]) => void;
  readonly centre: (id: number) => void;
  readonly openOrders: () => void;
  readonly openProfessions: (id: number) => void;
  readonly assignWorkplace: (id: number) => void;
  readonly assignHome: (id: number) => void;
  readonly attachTradeHouse: (id: number) => void;
  readonly pickPartner: (id: number) => void;
  readonly ringCommand: (id: ActionOrderId, targets: readonly number[]) => void;
  readonly cue: (cue: UiCue) => void;
}

/**
 * The settler panel's presses as orders. Every order first checks that the viewer's seat owns the
 * settler (the whole-map view owns everyone) and that it still stands: a refused press fails with the
 * GUI click and sends nothing.
 */
export function settlerPanelActions(
  opts: Pick<UnitControlsOptions, 'snapshot' | 'viewer' | 'enqueue'>,
  host: SettlerPanelHost,
  contract: SettlerContractCommands,
  equipPicker: EquipPickController | null,
): SettlerPanelActions {
  const owns = (id: number): boolean => {
    const ent = entityById(opts.snapshot(), id);
    if (ent === undefined) return false;
    const seat = pickableSeat(opts.viewer);
    return seat === null || ownerPlayerOf(ent) === seat;
  };
  /** A press that orders the settler: confirmed and run when the seat owns it, else refused. */
  const order =
    <A extends unknown[]>(run: (id: number, ...args: A) => void) =>
    (id: number, ...args: A): void => {
      if (!owns(id)) {
        host.cue('fail');
        return;
      }
      host.cue('confirm');
      run(id, ...args);
    };
  /** A press that only moves the view or the selection. */
  const view =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A): void => {
      host.cue('confirm');
      run(...args);
    };
  const enqueue = opts.enqueue;
  return {
    centre: view(host.centre),
    select: view(host.selectEntity),
    showPeer: view((id: number) => {
      host.selectEntity(id);
      host.centre(id);
    }),
    selectGroup: view(host.selectGroup),
    clearSelection: view(() => host.selectGroup([])),
    openOrders: order(() => host.openOrders()),
    rename: order(contract.rename),
    changeProfession: order(host.openProfessions),
    // The ring's own order, so a press obeys the same gate the ring button does.
    orderNeed: order((id, need: NeedKind) => host.ringCommand(NEED_ORDER[need], [id])),
    assignWorkplace: order(host.assignWorkplace),
    unassignWorkplace: order((id) => enqueue({ kind: 'unassignWorker', entity: id as Entity })),
    assignHome: order(host.assignHome),
    unassignHome: order((id) => enqueue({ kind: 'unassignHouse', entity: id as Entity })),
    pickPartner: order(host.pickPartner),
    equip: order((id, ref) => equipPicker?.open(id, ref)),
    unequip: order((id, ref) =>
      enqueue({ kind: 'unequipGood', entity: id as Entity, group: ref.group, slot: ref.slot }),
    ),
    setProductionCount: order(contract.setProductionCount),
    onlyProduct: order((id, goodType: number) =>
      enqueue({ kind: 'setCraftGoods', entity: id as Entity, goods: [goodType] }),
    ),
    setGatherGood: order((id, goodType: number | null) =>
      enqueue({ kind: 'setGatherGood', entity: id as Entity, goodType }),
    ),
    setStance: order((id, mode: number) => enqueue({ kind: 'setStance', entity: id as Entity, mode })),
    setRegeneration: order((id, enabled: boolean) =>
      enqueue({ kind: 'setRegeneration', entity: id as Entity, enabled }),
    ),
    attachTradeHouse: order(host.attachTradeHouse),
    detachTradeHouse: order((id, house: number) =>
      enqueue({ kind: 'detachTradeHouse', entity: id as Entity, house: house as Entity }),
    ),
    setTradeImport: order((id, house: number, good: number, on: boolean) =>
      enqueue({ kind: 'setTradeImport', entity: id as Entity, house: house as Entity, good, on }),
    ),
    setTradeAgreement: order((id, agreement: number) =>
      enqueue({ kind: 'setTradeAgreement', entity: id as Entity, agreement }),
    ),
  };
}
