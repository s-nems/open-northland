import type { UiCue } from '@open-northland/audio';
import { type Entity, entityById, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { buildingPeersOf } from '../../hud/details-panel/model/index.js';
import type { BuildingPanelActions } from '../../hud/dom/building-panel/actions.js';
import { ownedOrder } from './owned-order.js';

export interface BuildingPanelHost {
  readonly snapshot: () => WorldSnapshot;
  readonly viewer: ViewerSeat;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly cue: (cue: UiCue) => void;
}

/** The building panel's presses as orders, each gated on the seat owning the building; a household
 *  policy only on the seat whose policy it is. */
export function buildingPanelActions(host: BuildingPanelHost): BuildingPanelActions {
  const order = ownedOrder(host.snapshot, host.viewer, host.cue);
  const send = host.enqueue;
  return {
    upgrade: order((id) => send({ kind: 'upgradeBuilding', building: id as Entity })),
    cancelUpgrade: order((id) => send({ kind: 'cancelUpgrade', building: id as Entity })),
    demolish: order((id) => send({ kind: 'demolish', building: id as Entity })),
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
