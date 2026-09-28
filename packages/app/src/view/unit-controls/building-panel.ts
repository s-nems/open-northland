import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { buildingPeersOf } from '../../hud/details-panel/model/index.js';
import type { BuildingPanelActions } from '../../hud/dom/building-panel/actions.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { type ConfirmDialogCopy, confirmDialog } from '../confirm-dialog.js';
import { ownedOrder } from './owned-order.js';

export interface BuildingPanelHost {
  readonly snapshot: () => WorldSnapshot;
  readonly viewer: ViewerSeat;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly cue: (cue: UiCue) => void;
  /** The question a demolition asks first; the in-page dialog unless a test answers it. */
  readonly confirm?: (copy: ConfirmDialogCopy) => Promise<boolean>;
}

/** The building panel's presses as orders, each gated on the seat owning the building; a household
 *  policy only on the seat whose policy it is. A demolition asks first. */
export function buildingPanelActions(host: BuildingPanelHost): BuildingPanelActions {
  const order = ownedOrder(host.snapshot, host.viewer, host.cue);
  const send = host.enqueue;
  const confirm = host.confirm ?? confirmDialog;
  return {
    upgrade: order((id) => send({ kind: 'upgradeBuilding', building: id as Entity })),
    cancelUpgrade: order((id) => send({ kind: 'cancelUpgrade', building: id as Entity })),
    demolish: order((id, name: string) => {
      const copy = messages().hud.buildingPanel;
      void confirm({
        message: formatMessage(copy.demolishQuestion, { name }),
        confirmLabel: copy.orders.demolish,
        cancelLabel: copy.demolishKeep,
      }).then((confirmed) => {
        if (confirmed) send({ kind: 'demolish', building: id as Entity });
      });
    }),
    setAlarm: order((id, enabled: boolean) =>
      send({ kind: 'setDefenceMode', building: id as Entity, enabled }),
    ),
    setHouseholdGoodUse: (player, effect, allowed) => {
      if (player !== host.viewer.seat()) {
        host.cue('fail');
        return;
      }
      host.cue('confirm');
      send({ kind: 'setHouseholdGoodUse', player, effect, allowed });
    },
  };
}

/** The owner's buildings of `building`'s type, ascending: the kicker's browse. An index read. */
export function buildingPeers(snapshot: WorldSnapshot, building: number): readonly number[] {
  const ent = entityById(snapshot, building);
  return ent === undefined ? [] : buildingPeersOf(snapshot, ent);
}
