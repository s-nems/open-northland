import { describe, expect, it } from 'vitest';
import { Position, Vehicle } from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import { positionOfNode, Simulation } from '../../src/index.js';
import { hexDisc, vehicleFootprintNodes } from '../../src/systems/footprint/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

const VIKING = 1;
const P0 = 0;
const HANDCART = 1;
const CATAPULT = 5;
const MAP_CELLS = 8;
/** Half-cell nodes past the map edge the anchors reach, so the disc is clipped on every side. */
const OVERHANG = 2;

describe('vehicleFootprintNodes', () => {
  it('lists the disc around the anchor in ring order, clipped to the map, on both row parities', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('the fixture has a map');
    const ctx = ctxOf(sim);
    for (const vehicleType of [HANDCART, CATAPULT]) {
      const cart = createVehicle(sim.world, ctx, { vehicleType, x: 0, y: 0, tribe: VIKING, owner: P0 });
      if (cart === null) throw new Error(`vehicle type ${vehicleType} not in the fixture`);
      const size = contentIndex(sim.content).vehicles.get(
        sim.world.get(cart, Vehicle).vehicleType,
      )?.logicSize;
      if (size === undefined) throw new Error('the vehicle has a type');
      for (let hy = -OVERHANG; hy < terrain.height + OVERHANG; hy++) {
        for (let hx = -OVERHANG; hx < terrain.width + OVERHANG; hx++) {
          const moved = sim.world.mut(cart, Position);
          const at = positionOfNode(hx, hy);
          moved.x = at.x;
          moved.y = at.y;
          const expected = hexDisc({ hx, hy }, size)
            .filter((p) => terrain.inBounds(p.hx, p.hy))
            .map((p) => terrain.nodeAt(p.hx, p.hy));
          expect(vehicleFootprintNodes(sim.world, sim.content, terrain, cart)).toEqual(expected);
        }
      }
    }
  });
});
