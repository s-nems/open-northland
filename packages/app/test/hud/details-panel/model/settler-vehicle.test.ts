import { ONE } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import { VEHICLE_HANDCART, VEHICLE_SHIP_SMALL } from '../../../../src/game/sandbox/index.js';
import { vehicleRow } from '../../../../src/hud/details-panel/model/settler-vehicle.js';
import { sandboxCtx, snapshotOf } from '../../../support/sandbox.js';

const TRADER = 1;
const SHIP = 2;
const CART = 3;

const vehicle = (id: number, vehicleType: number) => ({
  id,
  components: {
    Vehicle: { vehicleType, tribe: 1, passengers: [], vehicles: [], carrier: null, hauler: TRADER },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: ONE, y: ONE },
  },
});

/** The trader aboard the small ship with its handcart; `pinned` pins the ship to its route. */
function rowOf(pinned: boolean) {
  const trader = {
    id: TRADER,
    components: {
      Settler: { tribe: 1, jobType: JOB_TRADER },
      Owner: { player: HUMAN_PLAYER },
      Rider: { vehicle: SHIP },
      HaulingCart: { vehicle: CART, taken: true },
      ...(pinned ? { TradeShip: { vehicle: SHIP } } : {}),
    },
  };
  const snapshot = snapshotOf([trader, vehicle(SHIP, VEHICLE_SHIP_SMALL), vehicle(CART, VEHICLE_HANDCART)]);
  return vehicleRow(sandboxCtx(), snapshot, trader, 'worker', true);
}

it('shows the cart with no remove in the Vehicle row while the trader rides its pinned ship', () => {
  const row = rowOf(true);
  expect(row?.target?.id).toBe(CART);
  expect(row?.remove).toBeNull();
});

it('shows a ship the trader rides but has not pinned, with its remove', () => {
  const row = rowOf(false);
  expect(row?.target?.id).toBe(SHIP);
  expect(row?.remove).toBe(true);
});
