import { describe, expect, it } from 'vitest';
import { Building, Owner, Position } from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { calmZonesByPlayer } from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The calm zones follow buildings and their owners, not the tick: a stretch with no building or
 * building-ownership change leaves the zones' revision alone, and a building add, removal or change of
 * hands re-stamps that building's diamond. Zones are read-path derived state - never hashed.
 */

const P0 = 0;
const P1 = 1;
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

function zonedSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassMap(20, 20) });
}

describe('calmZonesByPlayer', () => {
  it('keeps one object and revision across ticks while buildings and ownership stand still', () => {
    const sim = zonedSim();
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    const revision = zones.revision;
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(true); // the building's own node (tile 5,5)
    for (let t = 0; t < 5; t++) sim.step();
    expect(calmZonesByPlayer(sim.world, terrain)).toBe(zones);
    expect(zones.revision).toBe(revision);
  });

  it('grows on a building add and shrinks on its removal, keeping the overlap', () => {
    const sim = zonedSim();
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    const before = zones.revision;
    const FAR = { x: 30, y: 30 }; // node coords of tile (15,15) - outside the first zone's r=8 diamond
    const SHARED = { x: 13, y: 13 }; // inside the first diamond and the one added at tile (8,8)
    expect(zones.has(P0, terrain.nodeAt(FAR.x, FAR.y))).toBe(false);

    const added = ownedBuildingAt(sim, 8, 8);
    const far = ownedBuildingAt(sim, 15, 15);
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.revision).not.toBe(before);
    expect(zones.has(P0, terrain.nodeAt(FAR.x, FAR.y))).toBe(true);

    sim.world.destroy(far);
    sim.world.destroy(added);
    const grown = zones.revision;
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.revision).not.toBe(grown);
    expect(zones.has(P0, terrain.nodeAt(FAR.x, FAR.y))).toBe(false);
    expect(zones.has(P0, terrain.nodeAt(SHARED.x, SHARED.y))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps the revision when a building lands inside a zone it already covers', () => {
    const sim = zonedSim();
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    const revision = zones.revision;
    const twin = ownedBuildingAt(sim, 5, 5);
    calmZonesByPlayer(sim.world, terrain);
    sim.world.destroy(twin);
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.revision).toBe(revision);
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps the zones while owned settlers are born and die', () => {
    const sim = zonedSim();
    ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    const revision = zones.revision;
    const settler = sim.world.create();
    sim.world.add(settler, Owner, { player: P0 });
    calmZonesByPlayer(sim.world, terrain);
    sim.world.destroy(settler);
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.revision).toBe(revision);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('moves the zone when a building changes hands, by re-add or in place', () => {
    const sim = zonedSim();
    const building = ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    const settler = sim.world.create();
    sim.world.add(settler, Owner, { player: P0 }); // unrelated churn in the same span
    sim.world.add(building, Owner, { player: P1 });
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(false);
    expect(zones.has(P1, terrain.nodeAt(10, 10))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);

    sim.world.mut(building, Owner).player = P0;
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(true);
    expect(zones.has(P1, terrain.nodeAt(10, 10))).toBe(false);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('drops the zone when a building loses its owner', () => {
    const sim = zonedSim();
    const building = ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    sim.world.remove(building, Owner);
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(false);
  });

  it('re-stamps every building after a journal gap, matching a fresh derive', () => {
    const sim = zonedSim();
    const building = ownedBuildingAt(sim, 5, 5);
    const terrain = terrainOf(sim);
    const zones = calmZonesByPlayer(sim.world, terrain);
    for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) sim.world.mut(building, Owner).player = i % 2;
    calmZonesByPlayer(sim.world, terrain);
    expect(zones.has(P0, terrain.nodeAt(10, 10))).toBe(true);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('the verifier flags a building moved outside the tracked seams', () => {
    const sim = zonedSim();
    const building = ownedBuildingAt(sim, 5, 5);
    calmZonesByPlayer(sim.world, terrainOf(sim));
    // Positions are immutable once placed; defeating that is the bug the verifier exists to catch.
    (sim.world.get(building, Position) as { x: Fixed }).x = fx.fromInt(15);
    expect(sim.world.verifyCaches().join('\n')).toContain('calmZonesByPlayer');
  });
});
