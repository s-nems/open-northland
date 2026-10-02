import { parseContentSet } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { Building, Position, ResourceFootprint } from '../../src/components/index.js';
import { writeLandscapeEdits } from '../../src/components/landscape.js';
import { CHANGE_FEED_LIMIT } from '../../src/ecs/change-feed.js';
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
import type { Component } from '../../src/ecs/world.js';
import { fx, ONE, positionOfNode, Simulation } from '../../src/index.js';
import { ClearanceField } from '../../src/nav/clearance.js';
import type { NodeId } from '../../src/nav/terrain/index.js';
import { dynamicBlockOverlay } from '../../src/systems/footprint/blocked.js';
import { vehicleClearance } from '../../src/systems/footprint/vehicle-clearance.js';
import { removeLandscapes } from '../../src/systems/landscape/edits.js';
import { landscapeBlocks, RETAINED_VIEWS } from '../../src/systems/landscape/view.js';
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

it('keeps the clearance field through landscape changes after sparse reads', () => {
  const source = siteSim();
  const sim = new Simulation({
    seed: 1,
    content: source.content,
    map: {
      ...grassNodeMap(24, 12),
      landscapes: {
        types: [{ typeId: 1, walk: [{ dx: 0, dy: 0 }], build: [], groups: [] }],
        placements: [{ id: 0, typeId: 1, hx: 10, hy: 6, level: 0 }],
      },
    },
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('map missing');
  const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
  const node = terrain.nodeAt(10, 6);
  expect(field.classOf(node)).toBe(0);
  removeLandscapes(sim.world, terrain, { hx: 10, hy: 6 }, 0);
  expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
  expect(field.classOf(node)).toBeGreaterThan(0);
  expect(sim.world.verifyCaches()).toEqual([]);
});

it('replays landscape cells after the retained view chain is lost', () => {
  const source = siteSim();
  const sim = new Simulation({
    seed: 1,
    content: source.content,
    map: {
      ...grassNodeMap(24, 12),
      landscapes: {
        types: [{ typeId: 1, walk: [{ dx: 0, dy: 0 }], build: [], groups: [] }],
        placements: [],
      },
    },
  });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('map missing');
  const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
  for (let i = 0; i < RETAINED_VIEWS + 4; i++) {
    writeLandscapeEdits(sim.world, (state) => {
      state.topologyRevision++;
      state.added = i % 2 === 0 ? [{ id: 1, typeId: 1, hx: 10, hy: 6, level: 0 }] : [];
    });
    landscapeBlocks(sim.world, terrain);
  }
  writeLandscapeEdits(sim.world, (state) => {
    state.topologyRevision++;
    state.added = [{ id: 1, typeId: 1, hx: 10, hy: 6, level: 0 }];
  });
  expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
  expect(field.classOf(terrain.nodeAt(10, 6))).toBe(0);
  expect(sim.world.verifyCaches()).toEqual([]);
});

function resourceFootprint(dx = 0) {
  return { walk: [{ dx, dy: 0 }], build: [], work: [] };
}

function expectFreshClearance(sim: Simulation): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('map missing');
  const overlay = dynamicBlockOverlay(sim.world, ctxOf(sim), terrain);
  const fresh = new ClearanceField(
    terrain,
    (node) => (terrain.isWalkable(node) || terrain.isWater(node)) && !overlay.has(node),
  );
  const held = vehicleClearance(sim.world, ctxOf(sim), terrain);
  for (let index = 0; index < terrain.nodeCount; index++) {
    const node = index as NodeId;
    expect(held.classOf(node)).toBe(fresh.classOf(node));
  }
  expect(sim.world.verifyCaches()).toEqual([]);
}

describe('vehicle resource changes', () => {
  it('keeps a small unread span local across the membership journal ring wrap', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const resource = sim.world.create();
    sim.world.add(resource, Position, positionOfNode(10, 6));
    sim.world.add(resource, ResourceFootprint, resourceFootprint());
    sim.world.journalMembership(ResourceFootprint);
    const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
    for (let i = 0; i < GENERATION_JOURNAL_LIMIT - 2; i++) {
      sim.world.add(resource, ResourceFootprint, resourceFootprint(i % 2));
      expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
    }
    const generation = sim.world.componentGeneration(ResourceFootprint);
    for (let i = 0; i < 4; i++) sim.world.add(resource, ResourceFootprint, resourceFootprint(i % 2));
    expect(sim.world.membershipDeltasSince(ResourceFootprint, generation)).toEqual([
      resource,
      resource,
      resource,
      resource,
    ]);
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
    expectFreshClearance(sim);
  });

  it('updates old and new cells while retaining overlapping blockers', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const first = sim.world.create();
    const second = sim.world.create();
    for (const entity of [first, second]) {
      sim.world.add(entity, Position, positionOfNode(10, 6));
      sim.world.add(entity, ResourceFootprint, resourceFootprint());
    }
    const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
    sim.world.remove(first, ResourceFootprint);
    sim.world.add(first, ResourceFootprint, resourceFootprint(2));
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
    expect(field.classOf(terrain.nodeAt(10, 6))).toBe(0);
    expect(field.classOf(terrain.nodeAt(12, 6))).toBe(0);
    expectFreshClearance(sim);
    sim.world.remove(second, ResourceFootprint);
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).toBe(field);
    expect(field.classOf(terrain.nodeAt(10, 6))).toBeGreaterThan(0);
    expectFreshClearance(sim);
  });

  it('rebuilds on overflow and reuses its subscription through replacement memos', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const watches = vi.spyOn(sim.world, 'watchChanges');
    const first = sim.world.create();
    const second = sim.world.create();
    for (const entity of [first, second]) sim.world.add(entity, Position, positionOfNode(10, 6));
    const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
    for (let i = 0; i <= CHANGE_FEED_LIMIT; i++) {
      sim.world.add(i % 2 === 0 ? first : second, ResourceFootprint, resourceFootprint(i % 2));
    }
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).not.toBe(field);
    expectFreshClearance(sim);
    const replacement = siteSim().terrain;
    if (replacement === undefined) throw new Error('map missing');
    vehicleClearance(sim.world, ctxOf(sim), replacement);
    vehicleClearance(sim.world, ctxOf(sim), terrain);
    expect(watches.mock.calls.filter(([members]) => members.includes(ResourceFootprint))).toHaveLength(1);
    watches.mockRestore();
  });

  it('rebuilds when a bulk resource store fill loses individual changes', () => {
    const sim = siteSim();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('map missing');
    const entity = sim.world.create();
    sim.world.add(entity, Position, positionOfNode(10, 6));
    const field = vehicleClearance(sim.world, ctxOf(sim), terrain);
    sim.world.restoreStore(ResourceFootprint, [[entity, resourceFootprint()]]);
    expect(vehicleClearance(sim.world, ctxOf(sim), terrain)).not.toBe(field);
    expectFreshClearance(sim);
  });
});
