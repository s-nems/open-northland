import type { VehicleType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { withBigShipCartSlot } from '../../../src/stages/ir/big-ship-cart-slot.js';

const SAILOR_JOB = 6;
const HANDCART_JOB = 50;
const OXCART_JOB = 51;
const CATAPULT_JOB = 54;
const SMALL_SHIP = 3;
const BIG_SHIP = 4;

function row(typeId: number, vehicleSlots: number): VehicleType {
  return { typeId, id: `ship_${typeId}`, vehicleSlots, passengerJobs: [SAILOR_JOB] } as VehicleType;
}

describe('the big ship cart slot', () => {
  it('gives the big ship one slot for carts and no catapult job', () => {
    const big = withBigShipCartSlot(row(BIG_SHIP, 0));
    expect(big.vehicleSlots).toBe(1);
    expect(big.passengerJobs).toEqual([SAILOR_JOB, HANDCART_JOB, OXCART_JOB]);
    expect(big.passengerJobs).not.toContain(CATAPULT_JOB);
  });

  it('leaves every other vehicle as the source wrote it', () => {
    const small = row(SMALL_SHIP, 1);
    expect(withBigShipCartSlot(small)).toBe(small);
  });
});
