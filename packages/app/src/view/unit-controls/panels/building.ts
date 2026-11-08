import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import {
  type ConstructionPriority,
  type Entity,
  entityById,
  type PlayerCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { ownerPlayerOf } from '../../../game/snapshot/index.js';
import type { ViewerSeat } from '../../../game/viewer-seat.js';
import { buildingPeersOf } from '../../../hud/details-panel/model/index.js';
import type { BuildingPanelActions } from '../../../hud/dom/building-panel/actions.js';
import type { SystemConfirmCopy } from '../../../hud/dom/system/confirm.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { globalDefenceOrders } from '../keyboard-picks.js';
import { ownedOrder } from '../orders/owned.js';

export interface BuildingPanelHost {
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly viewer: ViewerSeat;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly cue: (cue: UiCue) => void;
  readonly selectGroup: (ids: readonly number[]) => void;
  /** Arm the planting of `building`'s rally flag. */
  readonly armRallyPoint: (building: number) => void;
  /** The question a demolition asks first. */
  readonly confirm: (copy: SystemConfirmCopy) => Promise<boolean>;
}

/** The building panel's presses as orders, each gated on the seat owning the building; a household
 *  policy only on the seat whose policy it is. A demolition asks first. */
export function buildingPanelActions(host: BuildingPanelHost): BuildingPanelActions {
  const order = ownedOrder(host.snapshot, host.viewer, host.cue);
  const send = host.enqueue;
  return {
    upgrade: order((id, target?: number) =>
      send({ kind: 'upgradeBuilding', building: id as Entity, ...(target === undefined ? {} : { target }) }),
    ),
    cancelUpgrade: order((id) => send({ kind: 'cancelUpgrade', building: id as Entity })),
    demolish: order((id, name: string) => {
      const copy = messages().hud.buildingPanel;
      void host
        .confirm({
          title: copy.demolishTitle,
          message: formatMessage(copy.demolishQuestion, { name }),
          cancel: copy.demolishKeep,
          confirm: copy.orders.demolish,
        })
        .then((confirmed) => {
          if (confirmed) send({ kind: 'demolish', building: id as Entity });
        });
    }),
    armRallyPoint: order((id) => host.armRallyPoint(id)),
    clearRallyPoint: order((id) => send({ kind: 'clearRallyPoint', building: id as Entity })),
    setAlarm: order((id, enabled: boolean) =>
      send({ kind: 'setDefenceMode', building: id as Entity, enabled }),
    ),
    setAlarmEverywhere: order((id, enabled: boolean) => {
      const snapshot = host.snapshot();
      const ent = entityById(snapshot, id);
      const owner = ent === undefined ? undefined : ownerPlayerOf(ent);
      if (owner === undefined) return;
      for (const command of globalDefenceOrders(snapshot, host.content, owner, enabled)) send(command);
    }),
    releaseGarrison: order((_id, garrison: readonly number[]) => {
      for (const entity of garrison) send({ kind: 'unassignWorker', entity: entity as Entity });
      host.selectGroup(garrison);
    }),
    setHouseholdGoodUse: (player, effect, allowed) => {
      if (player !== host.viewer.seat()) {
        host.cue('fail');
        return;
      }
      host.cue('confirm');
      send({ kind: 'setHouseholdGoodUse', player, effect, allowed });
    },
    setStorePriority: order((id, goodType: number, priority: boolean) =>
      send({ kind: 'setStorePriority', building: id as Entity, goodType, priority }),
    ),
    setConstructionPriority: order((id, priority: ConstructionPriority) =>
      send({ kind: 'setConstructionPriority', building: id as Entity, priority }),
    ),
    setStorageMinimum: (player, goodType, amount) => {
      if (player !== host.viewer.seat()) {
        host.cue('fail');
        return;
      }
      host.cue('confirm');
      send({ kind: 'setStorageMinimum', player, goodType, amount });
    },
  };
}

/** The owner's buildings of `building`'s type, ascending: the kicker's browse. An index read. */
export function buildingPeers(snapshot: WorldSnapshot, building: number): readonly number[] {
  const ent = entityById(snapshot, building);
  return ent === undefined ? [] : buildingPeersOf(snapshot, ent);
}
