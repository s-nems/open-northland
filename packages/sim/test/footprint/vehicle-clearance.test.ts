import { parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Building, Position } from '../../src/components/index.js';
import type { Component } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

/**
 * The vehicle free-size classes over the ground walk-block: a construction site's progress is a Building
 * value write that moves no cell, so the memo keeps its classes without walking every building, while a
 * type swap in place still re-derives the region around the building.
 */

const BLOCK_TYPE = 30; // walk-blocks its anchor node
const OPEN_TYPE = 31; // no walk-block
const VIKING = 1;
const SITE_AT = { hx: 10, hy: 6 };
/** More Building value writes than the world's value journal keeps, so the catch-up meets a gap. */
const JOURNAL_OVERFLOW_WRITES = 1100;

function siteSim(): Simulation {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      { typeId: BLOCK_TYPE, id: 'block', kind: 'storage', footprint: { blocked: [{ dx: 0, dy: 0 }] } },
      { typeId: OPEN_TYPE, id: 'open', kind: 'storage' },
    ],
  });
  return new Simulation({ seed: 1, content, map: grassNodeMap(24, 12) });
}

describe('vehicleClearance', () => {
  it('keeps its classes through construction progress without walking the buildings', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(SITE_AT.hx, SITE_AT.hy));
    sim.world.add(site, Building, {
      buildingType: BLOCK_TYPE,
      tribe: VIKING,
      built: fx.fromInt(0),
      level: 0,
    });
    const node = terrain.nodeAt(SITE_AT.hx, SITE_AT.hy);
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain).classOf(node)).toBe(0);

    const queries = vi.spyOn(sim.world, 'query');
    sim.world.mut(site, Building).built = ONE;
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain).classOf(node)).toBe(0);
    const walkedBuildings = queries.mock.calls.some((args) => args.includes(Building as Component<unknown>));
    expect(walkedBuildings).toBe(false);
    queries.mockRestore();

    sim.world.mut(site, Building).buildingType = OPEN_TYPE;
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain).classOf(node)).toBeGreaterThan(0);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('keeps its field through more progress writes than the value journal holds', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const site = sim.world.create();
    sim.world.add(site, Position, positionOfNode(SITE_AT.hx, SITE_AT.hy));
    sim.world.add(site, Building, {
      buildingType: BLOCK_TYPE,
      tribe: VIKING,
      built: fx.fromInt(0),
      level: 0,
    });
    const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
    for (let i = 0; i < JOURNAL_OVERFLOW_WRITES; i++) sim.world.mut(site, Building).built = fx.fromInt(i % 2);
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
