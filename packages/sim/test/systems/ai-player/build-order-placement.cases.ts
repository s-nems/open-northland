import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/core/commands/index.js';
import { Simulation, type TerrainMap } from '../../../src/index.js';
import {
  BUILD_SEARCH_MAX_RADIUS_NODES,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
} from '../../../src/systems/ai-player/index.js';
import { aiContent } from '../../fixtures/ai-content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  aiSim,
  ctxOf,
  HQ_X,
  HQ_Y,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SAND,
  SEAT,
  STONE,
  STONE_HARVEST,
  VIKING,
  WELL_TYPE,
} from './support.js';

/** Where an entry's building lands: the affinity pulls, their band clamp, and the ground rules. */

describe('build-order placement - affinity and ground rules', () => {
  /** A half-cell node map that is grass except where `sandy(x, y)` says otherwise. */
  function mapWithSand(width: number, height: number, sandy: (x: number, y: number) => boolean): TerrainMap {
    const typeIds = new Array<number>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) typeIds[y * width + x] = sandy(x, y) ? SAND : 0;
    }
    return { resolution: 'half-cell', width, height, typeIds };
  }

  function firstCommandOf(sim: Simulation, order: readonly BuildOrderEntry[]): Command | undefined {
    return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
  }

  it('places the farm only on plantable ground - a barren pocket is skipped, a barren map stalls', () => {
    // Sand within 6 nodes of the HQ: the farm must land beyond it, on the first grass ring.
    const SAND_RADIUS = 6;
    const pocket = new Simulation({
      seed: 1,
      content: aiContent(),
      map: mapWithSand(64, 32, (x, y) => Math.abs(x - HQ_X) + Math.abs(y - HQ_Y) <= SAND_RADIUS),
    });
    placeHq(pocket);
    pocket.step();
    const farm = firstCommandOf(pocket, DEFAULT_BUILD_ORDER);
    if (farm?.kind !== 'placeBuilding') throw new Error('expected the farm placement');
    expect(Math.abs(farm.x - HQ_X) + Math.abs(farm.y - HQ_Y)).toBeGreaterThan(SAND_RADIUS);

    // An all-sand map stalls the farm (hard rule) even though the ground is buildable - proven by
    // a home entry placing fine on the same ground.
    const barren = new Simulation({ seed: 1, content: aiContent(), map: mapWithSand(64, 32, () => true) });
    placeHq(barren);
    barren.step();
    expect(firstCommandOf(barren, DEFAULT_BUILD_ORDER)).toBeUndefined();
    const home = firstCommandOf(barren, [{ kind: 'place', building: 'home_level_00', count: 1 }]);
    expect(home?.kind).toBe('placeBuilding');
  });

  it('pulls a resource-affinity placement toward the deposit while staying in the near-HQ band', () => {
    const sim = aiSim();
    placeHq(sim);
    placeResources(sim, [RESOURCE_SPOTS.stone]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    const toStone = Math.abs(spot.x - RESOURCE_SPOTS.stone.x) + Math.abs(spot.y - RESOURCE_SPOTS.stone.y);
    expect(toStone).toBeLessThanOrEqual(2); // beside the deposit, not beside the HQ
    expect(Math.abs(spot.x - HQ_X) + Math.abs(spot.y - HQ_Y)).toBeLessThanOrEqual(
      BUILD_SEARCH_MAX_RADIUS_NODES,
    );
  });

  it('pulls a building-affinity placement beside the named building', () => {
    const WELL_AT = { x: 44, y: 20 };
    const sim = aiSim();
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: WELL_TYPE,
      x: WELL_AT.x,
      y: WELL_AT.y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    const spot = firstCommandOf(sim, [
      {
        kind: 'place',
        building: 'work_bakery_00',
        count: 1,
        near: [{ kind: 'building', id: 'work_well_00' }],
      },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected an affinity placement');
    expect(Math.abs(spot.x - WELL_AT.x) + Math.abs(spot.y - WELL_AT.y)).toBeLessThanOrEqual(2);
  });

  it('pulls a mapCentre-affinity placement toward the middle of the map', () => {
    const HQ_FAR = { x: 20, y: 20 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_well_00', count: 1, near: [{ kind: 'mapCentre' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a centre-pulled placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // pulled hard toward the middle
    // The pull points at the map centre (128,128), east and south of this HQ.
    expect(spot.x).toBeGreaterThan(HQ_FAR.x);
    expect(spot.y).toBeGreaterThan(HQ_FAR.y);
  });

  it('clamps a far-off affinity centre back into the near-HQ band', () => {
    const HQ_FAR = { x: 20, y: 20 };
    const STONE_FAR = { x: 200, y: 200 };
    const sim = new Simulation({ seed: 1, content: aiContent(), map: grassNodeMap(256, 256) });
    placeHq(sim, HQ_FAR.x, HQ_FAR.y);
    placeResources(sim, [{ good: STONE, harvest: STONE_HARVEST, x: STONE_FAR.x, y: STONE_FAR.y }]);
    sim.step();
    const spot = firstCommandOf(sim, [
      { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
    ]);
    if (spot?.kind !== 'placeBuilding') throw new Error('expected a clamped placement');
    const toHq = Math.abs(spot.x - HQ_FAR.x) + Math.abs(spot.y - HQ_FAR.y);
    expect(toHq).toBeLessThanOrEqual(BUILD_SEARCH_MAX_RADIUS_NODES); // never outside the band
    expect(toHq).toBeGreaterThan(BUILD_SEARCH_MAX_RADIUS_NODES / 2); // yet pulled hard toward the deposit
  });
});
