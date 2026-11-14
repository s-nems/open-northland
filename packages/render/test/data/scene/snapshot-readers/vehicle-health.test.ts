import { describe, expect, it } from 'vitest';
import type { StaticDrawFields } from '../../../../src/data/scene/draw-item.js';
import { readVehicleStaticFields } from '../../../../src/data/scene/snapshot-readers/index.js';

const read = (health: unknown): StaticDrawFields => {
  const fields: StaticDrawFields = {};
  readVehicleStaticFields(fields, { Vehicle: { vehicleType: 3, tribe: 1, facing: 0 }, Health: health });
  return fields;
};

describe('a vehicle draw item carries its damage', () => {
  it('reports the remaining share of a hurt hull and nothing for a whole one', () => {
    expect(read({ hitpoints: 750, max: 3000 }).hpFrac).toBe(0.25);
    expect(read({ hitpoints: 3000, max: 3000 }).hpFrac).toBeUndefined();
    expect(read(undefined).hpFrac).toBeUndefined();
  });
});
