import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import type { ContentIr } from '../src/content/ir/rows.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../src/content/map-resources.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnMapBerryBushes,
} from '../src/game/sandbox/index.js';
import { createSceneSim } from '../src/scenes/runtime.js';

/**
 * The decoded-map -> sim BERRY BUSH join runs after the start buildings stand. Placing a building clears
 * the bushes in its reserved zone, so a bush the map authors there, as under a start building a changed
 * tribe widened, is never spawned and its static sprite is retired.
 */

const { BerryBush } = components;

const MAP_CELLS = 40;
const WAREHOUSE = { x: 20, y: 20 } as const;
/** Half-cell nodes from the warehouse anchor to a bush well clear of its reserved zone. */
const CLEAR_OFFSET_NODES = 20;
const BUSH_GFX = 500;

function fixtureIr(): ContentIr {
  return {
    landscapeGfx: [{ index: BUSH_GFX, editName: 'bush fruits 01', logicType: BUSH_WITH_FRUITS_LOGIC_TYPE }],
  };
}

function warehouseSim(): Simulation {
  return createSceneSim({
    seed: 1,
    terrain: grassTerrain(MAP_CELLS, MAP_CELLS),
    build: (s: Simulation) => {
      placeBuiltSandboxBuilding(s, BUILDING_WAREHOUSE_00, WAREHOUSE.x, WAREHOUSE.y);
    },
  });
}

describe('spawnMapBerryBushes', () => {
  it('leaves out a bush in a standing building reserved zone and retires its placement', () => {
    const sim = warehouseSim();
    const anchor = cellAnchorNode(WAREHOUSE.x, WAREHOUSE.y);
    const objects = {
      types: ['bush fruits 01'],
      placements: [anchor.hx, anchor.hy, 0, anchor.hx + CLEAR_OFFSET_NODES, anchor.hy, 0],
    };

    const result = spawnMapBerryBushes(sim, objects, fixtureIr());

    expect(result.spawned).toBe(1);
    expect(result.retiredPlacements).toEqual([0]);
    expect([...result.placementByEntity.values()]).toEqual([1]);
    expect([...sim.world.query(BerryBush)]).toHaveLength(1);
  });
});
