import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, MAX_UNIT_ORDER_MEMBERS } from '@open-northland/sim';
import { ownerPlayerOf } from '../../game/snapshot.js';
import { pickableSeat } from '../../game/viewer-seat.js';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import type { GroupStance } from '../../hud/details-panel/model/index.js';
import type { GroupPanelActions } from '../../hud/dom/group-panel/actions.js';
import type { OrdersPress } from '../../hud/dom/selection-panel.js';
import { orderRecipients } from './action-ring/menu-state.js';
import { enqueueArmyOrder } from './group-orders.js';
import type { UnitControlsOptions } from './types.js';

/** What the unit controls do for the group panel beyond submitting a command. */
export interface GroupPanelHost {
  readonly onOrderLimit?: (() => void) | undefined;
  readonly selectEntity: (id: number) => void;
  readonly selectGroup: (ids: readonly number[]) => void;
  readonly centre: (id: number) => void;
  readonly openOrders: (press: OrdersPress) => void;
  readonly closeOrders: () => void;
  readonly ringCommand: (id: ActionOrderId, targets: readonly number[]) => boolean;
  readonly cue: (cue: UiCue) => void;
}

const STANCE_ORDER: Readonly<Record<GroupStance, ActionOrderId>> = {
  attack: 'attackMode',
  defend: 'defenceMode',
  ignore: 'ignorantMode',
};

/**
 * The group panel's presses as orders. A settler order goes through the action ring's own command, so
 * only the members whose gates take it receive it; members of another seat never do. An order nobody
 * takes fails with the GUI click and sends nothing.
 */
export function groupPanelActions(
  opts: Pick<UnitControlsOptions, 'snapshot' | 'viewer' | 'enqueue' | 'content'>,
  host: GroupPanelHost,
): GroupPanelActions & { readonly reach: (order: ActionOrderId, ids: readonly number[]) => number } {
  const owned = (ids: readonly number[]): number[] => {
    const snapshot = opts.snapshot();
    const seat = pickableSeat(opts.viewer);
    return ids.filter((id) => {
      const ent = entityById(snapshot, id);
      return ent !== undefined && (seat === null || ownerPlayerOf(ent) === seat);
    });
  };
  const reach = (order: ActionOrderId, ids: readonly number[]): number =>
    orderRecipients(opts.content, opts.snapshot(), owned(ids), order).length;
  const ring = (order: ActionOrderId, ids: readonly number[]): void => {
    const targets = owned(ids);
    if (orderRecipients(opts.content, opts.snapshot(), targets, order).length === 0) {
      host.cue('fail');
      return;
    }
    host.cue(host.ringCommand(order, targets) === false ? 'fail' : 'confirm');
  };
  const view =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A): void => {
      host.cue('confirm');
      run(...args);
    };
  return {
    reach,
    selectOnly: view(host.selectEntity),
    select: view(host.selectGroup),
    centre: view(host.centre),
    clearSelection: view(() => host.selectGroup([])),
    openOrders: host.openOrders,
    closeOrders: host.closeOrders,
    setStance: (ids, stance) => ring(STANCE_ORDER[stance], ids),
    setRegeneration: (ids, allowed) => ring(allowed ? 'allowRegeneration' : 'prohibitRegeneration', ids),
    setVehicleStance: (ids, stance) => {
      const vehicles = owned(ids);
      if (vehicles.length === 0) {
        host.cue('fail');
        return;
      }
      if (vehicles.length > MAX_UNIT_ORDER_MEMBERS) {
        if (host.onOrderLimit !== undefined) host.onOrderLimit();
        else host.cue('fail');
        return;
      }
      const accepted = enqueueArmyOrder(
        {
          kind: 'setVehicleStanceGroup',
          members: vehicles.map((entity) => ({ entity: entity as Entity })),
          stance,
        },
        opts.enqueue,
      );
      host.cue(accepted ? 'confirm' : 'fail');
    },
  };
}
