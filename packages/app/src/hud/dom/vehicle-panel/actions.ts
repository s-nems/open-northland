import type { VehicleOrder, VehicleStance } from '../../details-panel/model/index.js';
import type { SettlerPanelDeps } from '../settler-panel/actions.js';

/** The panel controls that arm a pick of their own besides the order buttons. */
export type VehiclePick = VehicleOrder | 'seatRider' | 'loadVehicle';

/**
 * What the vehicle panel's controls ask for. The owner checks the viewer's ownership before a command
 * leaves; the panel only decides which control was pressed.
 */
export interface VehiclePanelActions {
  /** An order button: a spot or target order arms its pick, stop and leave issue at once. */
  readonly order: (vehicle: number, order: VehicleOrder) => void;
  readonly setStance: (vehicle: number, stance: VehicleStance) => void;
  /** Arm the pick of an own settler to seat: the commander's seat first. */
  readonly seatRider: (vehicle: number) => void;
  readonly leave: (rider: number) => void;
  readonly unloadPeople: (vehicle: number) => void;
  /** Arm the pick of an own land vehicle to drive onto the ship's deck. */
  readonly loadVehicle: (ship: number) => void;
  /** Drive a carried vehicle off the deck. */
  readonly unloadVehicle: (carried: number) => void;
  readonly setWanted: (vehicle: number, goodType: number, amount: number) => void;
  readonly clearWanted: (vehicle: number) => void;
}

/** What the panel reads besides its model: the settler panel's parts (its Trade section acts on the
 *  trader through them) and the vehicle's own. */
export interface VehiclePanelDeps extends SettlerPanelDeps {
  readonly vehicle: VehiclePanelActions;
  /** The seat's own vehicles of one class, ascending; read on a selection change and at most every
   *  few seconds, never per tick. */
  readonly vehiclePeers: (vehicle: number) => readonly number[];
  /** The pick a panel control armed for `vehicle` and still waits for its target; read once a frame. */
  readonly armedPick: (vehicle: number) => VehiclePick | null;
}
