import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../../../../src/catalog/buildings.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
} from '../../../../src/game/sandbox/index.js';
import { buildUnitPanelModel } from '../../../../src/hud/details-panel/index.js';
import { createSceneSim } from '../../../../src/scenes/index.js';
import { ctxOf } from '../../../support/sandbox.js';

/** A storage factor the lobby offers. */
const STORAGE_FACTOR = 3;

describe('the stock rows of a building panel', () => {
  it('size a storehouse slot by the storage factor the sim plays', () => {
    let hq = -1;
    const sim = createSceneSim({
      seed: 1,
      terrain: grassTerrain(24, 16),
      build: (s) => {
        hq = placeBuiltSandboxBuilding(s, BUILDING_HEADQUARTERS, 12, 6, HUMAN_PLAYER);
      },
    });
    sim.enqueueSetup({ kind: 'setStorageCapacity', factor: STORAGE_FACTOR });
    sim.step();
    const model = buildUnitPanelModel(sim.snapshot(), new Set([hq]), ctxOf(sim));
    if (model.kind !== 'building') throw new Error('expected a building model');
    const declared =
      sim.content.buildings
        .find((b) => b.typeId === BUILDING_HEADQUARTERS)
        ?.stock.find((slot) => slot.goodType === GOOD_WOOD)?.capacity ?? 0;
    expect(declared).toBeGreaterThan(0);
    expect(model.stock.find((row) => row.goodType === GOOD_WOOD)?.capacity).toBe(STORAGE_FACTOR * declared);
  });
});
