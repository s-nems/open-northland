import { describe, expect, it } from 'vitest';
import { LostWay, Owner, Position, WALK_RANGE_NODES } from '../../src/components/index.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  Simulation,
  serializeSaveGame,
} from '../../src/index.js';
import { ownedWoodcutter } from '../conflict/orders/support.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';

/** A strip longer than the walk range, so a walk order to its far end is refused as beyond the signposts. */
const MAP_CELLS_WIDE = WALK_RANGE_NODES + 8;
const MAP_CELLS_HIGH = 4;
const AT_X = 2;
const ROW = 2;

describe('a lost mark through a save', () => {
  it('keeps its kind, tick, goal and pending work walk byte for byte', () => {
    const sim = new Simulation({
      seed: 7,
      content: testContent(),
      map: grassCellMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH),
    });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const u = ownedWoodcutter(sim, AT_X, ROW);
    sim.enqueueSetup({ kind: 'moveUnit', entity: u, x: 2 * MAP_CELLS_WIDE - 2, y: 2 * ROW });
    sim.step();
    const lost = sim.world.get(u, LostWay);
    expect(lost.goal).toBeGreaterThan(0);

    const bytes = serializeSaveGame(exportSaveGame(sim, {}));
    const restored = restoreSimulation(parseSaveGame(JSON.parse(bytes)), {
      content: testContent(),
      map: grassCellMap(MAP_CELLS_WIDE, MAP_CELLS_HIGH),
    });
    expect(restored.world.get(u, LostWay)).toEqual(lost);
    expect(restored.world.get(u, Position)).toEqual(sim.world.get(u, Position));
    expect(restored.world.get(u, Owner)).toEqual(sim.world.get(u, Owner));
    expect(serializeSaveGame(exportSaveGame(restored, {}))).toBe(bytes);
  });
});
