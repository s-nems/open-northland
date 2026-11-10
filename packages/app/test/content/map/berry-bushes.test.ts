import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../src/catalog/buildings.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { BUSH_WITH_FRUITS_LOGIC_TYPE } from '../../../src/content/map/resources.js';
import {
  BUILDING_WAREHOUSE_00,
  placeBuiltSandboxBuilding,
  spawnMapBerryBushes,
} from '../../../src/game/sandbox/index.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';

/**
 * The decoded-map -> sim BERRY BUSH join runs after the start buildings stand. Placing a building clears
 * the bushes in its reserved zone, so a bush the map authors there, as under a start building a changed
 * tribe widened, is never spawned and its static sprite is retired.
 */

const { BerryBush } = components;

/** `landscapetypes.ini` `bush naked` and `bush flowering`, the fruited bush's unripe stages. */
const BUSH_NAKED_LOGIC_TYPE = 9;
const BUSH_FLOWERING_LOGIC_TYPE = 10;

const MAP_CELLS = 40;
const WAREHOUSE = { x: 20, y: 20 } as const;
/** Half-cell nodes from the warehouse anchor to a bush well clear of its reserved zone. */
const CLEAR_OFFSET_NODES = 20;
const BUSH_GFX = 500;
const NAKED_BUSH_GFX = 501;
const FLOWERING_BUSH_GFX = 502;

function fixtureIr(): ContentIr {
  return {
    landscapeGfx: [
      { index: BUSH_GFX, editName: 'bush 01 fruits', logicType: BUSH_WITH_FRUITS_LOGIC_TYPE },
      { index: NAKED_BUSH_GFX, editName: 'bush 01 empty', logicType: BUSH_NAKED_LOGIC_TYPE },
      { index: FLOWERING_BUSH_GFX, editName: 'bush 01 flower', logicType: BUSH_FLOWERING_LOGIC_TYPE },
    ],
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
      types: ['bush 01 fruits'],
      placements: [anchor.hx, anchor.hy, 0, anchor.hx + CLEAR_OFFSET_NODES, anchor.hy, 0],
    };

    const result = spawnMapBerryBushes(sim, objects, fixtureIr());

    expect(result.spawned).toBe(1);
    expect(result.retiredPlacements).toEqual([0]);
    expect([...result.placementByEntity.values()]).toEqual([1]);
    expect([...sim.world.query(BerryBush)]).toHaveLength(1);
  });

  it('spawns a naked or flowering bush at its stage, drawn from its fruited twin', () => {
    const sim = warehouseSim();
    const anchor = cellAnchorNode(WAREHOUSE.x, WAREHOUSE.y);
    const clearHx = anchor.hx + CLEAR_OFFSET_NODES;
    const objects = {
      types: ['bush 01 empty', 'bush 01 flower'],
      placements: [clearHx, anchor.hy, 0, clearHx + 2, anchor.hy, 1],
    };

    const result = spawnMapBerryBushes(sim, objects, fixtureIr());

    expect(result.spawned).toBe(2);
    expect([...sim.world.query(BerryBush)].map((e) => sim.world.get(e, BerryBush))).toEqual([
      { stage: 'bare', gfxIndex: BUSH_GFX },
      { stage: 'flowering', gfxIndex: BUSH_GFX },
    ]);
  });
});
