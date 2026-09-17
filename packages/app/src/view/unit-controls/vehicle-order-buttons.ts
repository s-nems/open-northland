import type { Entity, PlayerCommand } from '@open-northland/sim';
import type { VehicleOrder } from '../../hud/details-panel/index.js';
import type { PickModeController } from './pick-mode.js';

export interface VehicleOrderButtonDeps {
  readonly enqueue: (command: PlayerCommand) => void;
  readonly pickMode: PickModeController;
}

/** Turn one vehicle-window button into an order: a spot or target order arms its pick mode, the rest
 *  issue at once. The panel already hides the buttons the vehicle's type does not take. */
export function issueVehicleOrder(vehicle: number, order: VehicleOrder, deps: VehicleOrderButtonDeps): void {
  const entity = vehicle as Entity;
  switch (order) {
    case 'goTo':
      deps.pickMode.arm({ kind: 'vehicle-destination', vehicle });
      return;
    case 'dock':
      deps.pickMode.arm({ kind: 'vehicle-dock', vehicle });
      return;
    case 'unloadPeople':
      deps.enqueue({ kind: 'unloadPeople', vehicle: entity });
      return;
    case 'stop':
      deps.enqueue({ kind: 'stopVehicle', vehicle: entity });
      return;
    case 'attackInhabitants':
      deps.pickMode.arm({ kind: 'vehicle-attack-settler', vehicle });
      return;
    case 'attackBuilding':
      deps.pickMode.arm({ kind: 'vehicle-attack-building', vehicle });
      return;
    case 'attackVehicle':
      deps.pickMode.arm({ kind: 'vehicle-attack-vehicle', vehicle });
      return;
    case 'attackPosition':
      deps.pickMode.arm({ kind: 'vehicle-attack-position', vehicle });
      return;
    case 'stanceAttack':
      deps.enqueue({ kind: 'setVehicleStance', vehicle: entity, stance: 'attack' });
      return;
    case 'stanceDefence':
      deps.enqueue({ kind: 'setVehicleStance', vehicle: entity, stance: 'defence' });
      return;
    case 'stanceHold':
      deps.enqueue({ kind: 'setVehicleStance', vehicle: entity, stance: 'hold' });
      return;
    case 'loadIntoShip':
      deps.pickMode.arm({ kind: 'vehicle-carrier', vehicle });
      return;
    case 'leaveShip':
      deps.enqueue({ kind: 'leaveCarrier', vehicle: entity });
      return;
    case 'unloadGoods':
      deps.enqueue({ kind: 'clearVehicleWanted', vehicle: entity });
      return;
    default: {
      const unreachable: never = order;
      throw new Error(`unhandled vehicle order: ${String(unreachable)}`);
    }
  }
}
