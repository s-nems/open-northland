import { describe, expect, it } from 'vitest';
import { Building, Owner, Position } from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { calmZonesByPlayer } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The calm-zone memo is keyed on the Building + Owner generations, not the tick: a stretch of ticks
 * with no building/ownership change must reuse one derivation (instance identity proves it), and any
 * building add or remove must rebuild. Zones are read-path derived state — never hashed.
 */

const P0 = 0;
const ANY_BUILDING_TYPE = 1;

function ownedBuildingAt(sim: Simulation, x: number, y: number): Entity {
  const b = sim.world.create();
  sim.world.add(b, Building, { buildingType: ANY_BUILDING_TYPE, tribe: 1, built: ONE, level: 0 });
  sim.world.add(b, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(b, Owner, { player: P0 });
  return b;
}

function terrainOf(sim: Simulation) {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  return terrain;
}

describe('calmZonesByPlayer memo', () => {
  it('reuses one derivation across ticks while buildings and ownership stand still', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    expect(zones.get(P0)?.has(terrain.nodeAt(10, 10))).toBe(true); // the building's own node (tile 5,5)
    for (let t = 0; t < 5; t++) sim.step();
    expect(calmZonesByPlayer(sim.world, terrain)).toBe(zones); // same instance — no per-tick rebuild
  });

  it('rebuilds on a building add and again on its removal', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const before = calmZonesByPlayer(sim.world, terrain);
    const FAR = { x: 30, y: 30 }; // node coords of tile (15,15) — outside the first zone's r=8 diamond
    expect(before.get(P0)?.has(terrain.nodeAt(FAR.x, FAR.y))).toBe(false);

    const added = ownedBuildingAt(sim, 15, 15);
    const grown = calmZonesByPlayer(sim.world, terrain);
    expect(grown).not.toBe(before);
    expect(grown.get(P0)?.has(terrain.nodeAt(FAR.x, FAR.y))).toBe(true);

    sim.world.destroy(added);
    const shrunk = calmZonesByPlayer(sim.world, terrain);
    expect(shrunk).not.toBe(grown);
    expect(shrunk.get(P0)?.has(terrain.nodeAt(FAR.x, FAR.y))).toBe(false);
  });
});
