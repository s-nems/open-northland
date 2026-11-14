import type { VehicleType } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { SHIP_HITPOINTS, withShipHitpoints } from '../../../src/stages/ir/ship-hitpoints.js';

const SMALL_SHIP = 3;
const BIG_SHIP = 4;
const CATAPULT = 5;
const ORIGINAL_SHIP_HITPOINTS = 5000;
const CATAPULT_HITPOINTS = 3000;

function row(typeId: number, hitpoints: number): VehicleType {
  return { typeId, id: `vehicle_${typeId}`, hitpoints } as VehicleType;
}

describe('the ship hit points', () => {
  it('raises both ships to the owner’s pool', () => {
    expect(withShipHitpoints(row(SMALL_SHIP, ORIGINAL_SHIP_HITPOINTS)).hitpoints).toBe(SHIP_HITPOINTS);
    expect(withShipHitpoints(row(BIG_SHIP, ORIGINAL_SHIP_HITPOINTS)).hitpoints).toBe(SHIP_HITPOINTS);
  });

  it('leaves every other vehicle as the table wrote it', () => {
    const catapult = row(CATAPULT, CATAPULT_HITPOINTS);
    expect(withShipHitpoints(catapult)).toBe(catapult);
  });
});
