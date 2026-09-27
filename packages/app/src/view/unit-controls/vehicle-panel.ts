import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import { type Entity, entityById, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import { isVehicle, num, ownerPlayerOf } from '../../game/snapshot.js';
import { pickableSeat, type ViewerSeat } from '../../game/viewer-seat.js';
import {
  type VehicleOrder,
  type VehicleStance,
  vehicleClassOf,
} from '../../hud/details-panel/model/index.js';
import type { VehiclePanelActions, VehiclePick } from '../../hud/dom/vehicle-panel/actions.js';
import type { PickMode } from './pick-mode.js';

/** The pick an order button arms, or null for an order that issues at once. */
export function orderPick(vehicle: number, order: VehicleOrder): PickMode | null {
  switch (order) {
    case 'goTo':
      return { kind: 'vehicle-destination', vehicle };
    case 'dock':
      return { kind: 'vehicle-dock', vehicle };
    case 'boardShip':
      return { kind: 'vehicle-carrier', vehicle };
    case 'attackSettler':
      return { kind: 'vehicle-attack-settler', vehicle };
    case 'attackBuilding':
      return { kind: 'vehicle-attack-building', vehicle };
    case 'attackVehicle':
      return { kind: 'vehicle-attack-vehicle', vehicle };
    case 'attackPosition':
      return { kind: 'vehicle-attack-position', vehicle };
    case 'stop':
    case 'leaveShip':
      return null;
    default: {
      const unreachable: never = order;
      throw new Error(`unhandled vehicle order: ${String(unreachable)}`);
    }
  }
}

/** The panel control whose pick `mode` is, while it is armed for `vehicle`; null for any other. */
export function armedVehiclePick(mode: PickMode | null, vehicle: number): VehiclePick | null {
  if (mode === null || !('vehicle' in mode) || mode.vehicle !== vehicle) return null;
  switch (mode.kind) {
    case 'vehicle-destination':
      return 'goTo';
    case 'vehicle-dock':
      return 'dock';
    case 'vehicle-carrier':
      return 'boardShip';
    case 'vehicle-attack-settler':
      return 'attackSettler';
    case 'vehicle-attack-building':
      return 'attackBuilding';
    case 'vehicle-attack-vehicle':
      return 'attackVehicle';
    case 'vehicle-attack-position':
      return 'attackPosition';
    case 'vehicle-rider':
      return 'seatRider';
    case 'vehicle-deck':
      return 'loadVehicle';
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

/** The seat's own vehicles of `vehicle`'s class, ascending: the kicker's browse. One walk over the
 *  snapshot, which the panel runs on a selection change and at most every few seconds. */
export function vehiclePeersOf(
  snapshot: WorldSnapshot,
  content: Pick<ContentSet, 'vehicles'>,
  vehicle: number,
): number[] {
  const self = entityById(snapshot, vehicle);
  if (self === undefined) return [];
  const owner = ownerPlayerOf(self);
  const classOf = (e: WorldSnapshot['entities'][number]) => {
    const typeId = num((e.components.Vehicle as { vehicleType?: unknown } | undefined)?.vehicleType);
    return vehicleClassOf(content.vehicles.find((v) => v.typeId === typeId));
  };
  const kind = classOf(self);
  const ids: number[] = [];
  for (const e of snapshot.entities) {
    if (isVehicle(e) && ownerPlayerOf(e) === owner && classOf(e) === kind) ids.push(e.id);
  }
  return ids.sort((a, b) => a - b);
}

export interface VehiclePanelHost {
  readonly snapshot: () => WorldSnapshot;
  readonly viewer: ViewerSeat;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly arm: (mode: PickMode) => void;
  readonly cue: (cue: UiCue) => void;
}

/**
 * The vehicle panel's presses as orders. Every order first checks that the viewer's seat owns the
 * vehicle or rider (the whole-map view owns everything): a refused press fails with the GUI click and
 * sends nothing.
 */
export function vehiclePanelActions(host: VehiclePanelHost): VehiclePanelActions {
  const owns = (id: number): boolean => {
    const ent = entityById(host.snapshot(), id);
    if (ent === undefined) return false;
    const seat = pickableSeat(host.viewer);
    return seat === null || ownerPlayerOf(ent) === seat;
  };
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
  const send = host.enqueue;
  return {
    order: order((id, next: VehicleOrder) => {
      const pick = orderPick(id, next);
      if (pick !== null) host.arm(pick);
      else if (next === 'stop') send({ kind: 'stopVehicle', vehicle: id as Entity });
      else if (next === 'leaveShip') send({ kind: 'leaveCarrier', vehicle: id as Entity });
    }),
    setStance: order((id, stance: VehicleStance) =>
      send({ kind: 'setVehicleStance', vehicle: id as Entity, stance }),
    ),
    seatRider: order((id) => host.arm({ kind: 'vehicle-rider', vehicle: id })),
    leave: order((id) => send({ kind: 'detachFromVehicle', entity: id as Entity })),
    unloadPeople: order((id) => send({ kind: 'unloadPeople', vehicle: id as Entity })),
    loadVehicle: order((id) => host.arm({ kind: 'vehicle-deck', vehicle: id })),
    unloadVehicle: order((id) => send({ kind: 'leaveCarrier', vehicle: id as Entity })),
    setWanted: order((id, goodType: number, amount: number) =>
      send({ kind: 'setVehicleWanted', vehicle: id as Entity, goodType, amount }),
    ),
    clearWanted: order((id) => send({ kind: 'clearVehicleWanted', vehicle: id as Entity })),
  };
}
