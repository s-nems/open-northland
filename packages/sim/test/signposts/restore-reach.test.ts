import { describe, expect, it } from 'vitest';
import {
  exportSaveGame,
  parseSaveGame,
  reachContains,
  restoreSimulation,
  serializeSaveGame,
} from '../../src/index.js';
import { Simulation } from '../../src/simulation.js';
import { layRoad } from '../../src/systems/roads/index.js';
import { createSignpost } from '../../src/systems/signposts/placement.js';
import { testContent } from '../fixtures/content.js';
import { roughNodeMap } from '../fixtures/terrain.js';

/** Resistance 5 spends the goods search's 80-point budget within 16 steps, so the west post's search
 *  reaches the east post only along a road. */
const ROUGH = 5;
const MAP_NODES = 160;
const WEST = { hx: 50, hy: 50 };
const EAST = { hx: 74, hy: 50 };
const TICKS = 20;

function roughMap() {
  return roughNodeMap(MAP_NODES, MAP_NODES, () => ROUGH);
}

/** Whether the west post's goods search takes in the east post's node. */
function westReachesEast(sim: Simulation): boolean {
  const west = sim.signpostReach(0)?.posts[0];
  if (west === undefined) throw new Error('west post expected');
  return reachContains(west.area, EAST.hx, EAST.hy);
}

describe('signpost reaches across a restore', () => {
  it('searches and hashes as the continuous world does once a road changes the warmed reaches', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughMap() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    createSignpost(sim.world, terrain, terrain.nodeAt(WEST.hx, WEST.hy), 0);
    createSignpost(sim.world, terrain, terrain.nodeAt(EAST.hx, EAST.hy), 0);
    sim.run(TICKS);
    expect(westReachesEast(sim)).toBe(false);

    const restored = restoreSimulation(parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim)))), {
      content: testContent(),
      map: roughMap(),
    });
    const restoredTerrain = restored.terrain;
    if (restoredTerrain === undefined) throw new Error('terrain');
    for (const [run, graph] of [
      [sim, terrain],
      [restored, restoredTerrain],
    ] as const) {
      const road = Array.from({ length: EAST.hx - WEST.hx + 1 }, (_, i) =>
        graph.nodeAt(WEST.hx + i, WEST.hy),
      );
      layRoad(run.world, graph, road);
    }
    sim.run(TICKS);
    restored.run(TICKS);

    expect(westReachesEast(sim)).toBe(true);
    expect(westReachesEast(restored)).toBe(true);
    expect(restored.hashState()).toBe(sim.hashState());
  });
});
