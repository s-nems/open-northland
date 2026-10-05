import { describe, expect, it } from 'vitest';
import { Owner, Position, ResourceFootprint, Signpost, Stockpile } from '../../src/components/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { reachContains, searchReach } from '../../src/nav/range-search.js';
import { buildTerrainGraph } from '../../src/nav/terrain/map.js';
import { Simulation } from '../../src/simulation.js';
import { collectTargets, nearestStoreHolding } from '../../src/systems/settlers/targets/index.js';
import { signpostLinksSystem } from '../../src/systems/signposts/links.js';
import { createSignpost } from '../../src/systems/signposts/placement.js';
import { goodsSearchLimitAt } from '../../src/systems/signposts/reach.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, roughNodeMap } from '../fixtures/terrain.js';

const empty = { size: 0, has: () => false };

describe('terrain-aware goods reach', () => {
  it('uses the strict 40-node boundary on plain land and a smaller reach on resistant ground', () => {
    const grass = buildTerrainGraph(testContent(), grassNodeMap(120, 100));
    const area = searchReach(grass, empty, 50, 50, 40);
    expect(reachContains(area, 89, 50)).toBe(true);
    expect(reachContains(area, 90, 50)).toBe(false);
    const rough = buildTerrainGraph(
      testContent(),
      roughNodeMap(120, 100, () => 5),
    );
    const short = searchReach(rough, empty, 50, 50, 40);
    expect(reachContains(short, 66, 50)).toBe(true);
    expect(reachContains(short, 67, 50)).toBe(false);
    rough.syncRoads(
      1,
      Array.from({ length: 40 }, (_, i) => rough.nodeAt(50 + i, 50)),
    );
    expect(reachContains(searchReach(rough, empty, 50, 50, 40), 89, 50)).toBe(true);
  });

  it('rejects nearby goods behind an obstacle whose only detour exceeds the search budget', () => {
    const terrain = buildTerrainGraph(testContent(), grassNodeMap(100, 110));
    const wall = new Set(Array.from({ length: 95 }, (_, y) => terrain.nodeAt(40, y)));
    const area = searchReach(terrain, wall, 30, 20, 40);
    expect(reachContains(area, 35, 20)).toBe(true);
    expect(reachContains(area, 45, 20)).toBe(false);
    wall.delete(terrain.nodeAt(40, 20));
    expect(reachContains(searchReach(terrain, wall, 30, 20, 40), 45, 20)).toBe(true);
  });

  it('updates existing links and goods reach when an obstacle appears and disappears, without owner-churn invalidation', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(130, 100) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const a = createSignpost(sim.world, terrain, terrain.nodeAt(35, 30), 0, sim.content);
    const b = createSignpost(sim.world, terrain, terrain.nodeAt(65, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Signpost).links).toEqual([b]);
    const first = sim.signpostReach(0);
    const unrelated = sim.world.create();
    sim.world.add(unrelated, Owner, { player: 0 });
    signpostLinksSystem(sim.world, ctxOf(sim));
    expect(sim.signpostReach(0)).toBe(first);
    const limit = goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30);
    expect(limit?.allowsNode(terrain.nodeAt(95, 30))).toBe(true);
    const barrier = sim.world.create();
    sim.world.add(barrier, Position, positionOfNode(50, 0));
    sim.world.add(barrier, ResourceFootprint, {
      walk: Array.from({ length: 100 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [],
    });
    signpostLinksSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Signpost).links).toEqual([]);
    expect(sim.world.get(b, Signpost).links).toEqual([]);
    expect(
      goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30)?.allowsNode(terrain.nodeAt(95, 30)),
    ).toBe(false);
    const goods = sim.world.create();
    sim.world.add(goods, Position, positionOfNode(65, 30));
    sim.world.add(goods, Stockpile, { amounts: new Map([[1, 5]]) });
    const targets = collectTargets(sim.world, ctxOf(sim), terrain);
    expect(nearestStoreHolding(targets.bands, sim.world, terrain.nodeAt(35, 30), 1, 0)).toBeNull();
    const cut = sim.signpostReach(0);
    expect(cut?.posts.every((p) => !reachContains(p.area, 50, 30))).toBe(true);
    sim.world.destroy(barrier);
    signpostLinksSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Signpost).links).toEqual([b]);
    expect(
      nearestStoreHolding(
        collectTargets(sim.world, ctxOf(sim), terrain).bands,
        sim.world,
        terrain.nodeAt(35, 30),
        1,
        0,
      ),
    ).toBe(goods);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
