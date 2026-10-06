import { describe, expect, it } from 'vitest';
import { Signpost } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { exportSaveGame, parseSaveGame, restoreSimulation, serializeSaveGame } from '../../src/index.js';
import { Simulation } from '../../src/simulation.js';
import { layRoad } from '../../src/systems/roads/index.js';
import { createSignpost } from '../../src/systems/signposts/placement.js';
import { testContent } from '../fixtures/content.js';
import { roughNodeMap } from '../fixtures/terrain.js';

/** Resistance 5 spends the 80-point budget within 16 steps, so the two posts link only along a road. */
const ROUGH = 5;
const MAP_NODES = 160;
const WEST = { hx: 50, hy: 50 };
const EAST = { hx: 74, hy: 50 };
const TICKS = 20;

function roughMap() {
  return roughNodeMap(MAP_NODES, MAP_NODES, () => ROUGH);
}

function linksOf(sim: Simulation, post: Entity): readonly Entity[] {
  return sim.world.get(post, Signpost).links;
}

describe('signpost reaches across a restore', () => {
  it('links and hashes as the continuous world does once a road changes the warmed reaches', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughMap() });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const west = createSignpost(sim.world, terrain, terrain.nodeAt(WEST.hx, WEST.hy), 0);
    const east = createSignpost(sim.world, terrain, terrain.nodeAt(EAST.hx, EAST.hy), 0);
    sim.run(TICKS);
    expect(linksOf(sim, west)).toEqual([]);

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

    expect(linksOf(sim, west)).toEqual([east]);
    expect(linksOf(restored, west)).toEqual([east]);
    expect(restored.hashState()).toBe(sim.hashState());
  });
});
