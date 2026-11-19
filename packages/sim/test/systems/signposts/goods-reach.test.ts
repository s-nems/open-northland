import { describe, expect, it } from 'vitest';
import {
  Owner,
  Position,
  ResourceFootprint,
  Signpost,
  Stockpile,
  stampOwner,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { intersectReach, reachContains, searchReach } from '../../../src/nav/range-search.js';
import { buildTerrainGraph } from '../../../src/nav/terrain/map.js';
import { Simulation } from '../../../src/simulation.js';
import { layRoad, liftRoad } from '../../../src/systems/roads/index.js';
import { collectTargets, nearestStoreHolding } from '../../../src/systems/settlers/targets/index.js';
import { GroupCoverage } from '../../../src/systems/signposts/group-coverage.js';
import { signpostLinksSystem } from '../../../src/systems/signposts/links.js';
import { createSignpost, razeSignpost } from '../../../src/systems/signposts/placement.js';
import { goodsReachAt, goodsSearchLimitAt } from '../../../src/systems/signposts/reach.js';
import { GOODS_SEARCH_SPAN } from '../../../src/systems/signposts/terrain-reach.js';
import { collectSupplyTally } from '../../../src/systems/stores/index.js';
import { testContent } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { grassNodeMap, roughNodeMap } from '../../fixtures/terrain.js';

const empty = { size: 0, has: () => false };

describe('terrain-aware goods reach', () => {
  it('refreshes local road resistance without discarding searches after distant road edits', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughNodeMap(240, 240, () => 5) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const read = () => goodsReachAt(sim.world, sim.content, terrain, 50, 50);
    const before = read();
    expect(reachContains(before, 89, 50)).toBe(false);
    layRoad(sim.world, terrain, [terrain.nodeAt(220, 220)]);
    expect(read()).toBe(before);
    const road = Array.from({ length: 40 }, (_, i) => terrain.nodeAt(50 + i, 50));
    layRoad(sim.world, terrain, road);
    expect(reachContains(read(), 89, 50)).toBe(true);
    liftRoad(sim.world, terrain, road);
    expect(reachContains(read(), 89, 50)).toBe(false);
  });
  it('holds the most recently asked spots and evicts the least recently asked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughNodeMap(200, 200, () => 5) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const read = (i: number) => goodsReachAt(sim.world, sim.content, terrain, i % 200, Math.floor(i / 200));
    const SPOTS_HELD = 1024;
    const first = read(0);
    for (let i = 1; i < SPOTS_HELD; i++) read(i);
    expect(read(0)).toBe(first);
    for (let i = SPOTS_HELD; i < 2 * SPOTS_HELD - 1; i++) read(i);
    expect(read(0)).toBe(first);
    for (let i = 2 * SPOTS_HELD; i < 3 * SPOTS_HELD; i++) read(i);
    const again = read(0);
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
  it('keeps a search through block changes past the nodes its flood inspected', () => {
    // Resistance 5 spends the 80-point budget within 16 steps, far inside the 80-node outer bound.
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughNodeMap(240, 240, () => 5) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const read = () => goodsReachAt(sim.world, sim.content, terrain, 50, 50);
    const block = (hx: number, hy: number) => {
      const id = sim.world.create();
      sim.world.add(id, Position, positionOfNode(hx, hy));
      sim.world.add(id, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    };
    const before = read();
    expect(reachContains(before, 60, 50)).toBe(true);
    block(100, 50);
    expect(read()).toBe(before);
    // Inside the flood's box, but a corner its hexagon of entered nodes never reaches.
    block(66, 34);
    expect(read()).toBe(before);
    block(59, 50);
    const after = read();
    expect(after).not.toBe(before);
    expect(reachContains(after, 59, 50)).toBe(false);
  });
  it('keeps post coverage through a remote block and cuts a near block out of it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(500, 150) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    for (let i = 0; i < 20; i++) {
      const post = sim.world.create();
      sim.world.add(post, Owner, { player: 0 });
      sim.world.add(post, Position, positionOfNode(30 + Math.floor(i / 2) * 45 + (i % 2) * 20, 40));
      sim.world.add(post, Signpost, { links: [] });
    }
    signpostLinksSystem(sim.world, ctxOf(sim));
    const before = sim.signpostReach(0);
    const block = (hx: number, hy: number) => {
      const id = sim.world.create();
      sim.world.add(id, Position, positionOfNode(hx, hy));
      sim.world.add(id, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
      signpostLinksSystem(sim.world, ctxOf(sim));
      return sim.signpostReach(0);
    };
    const remote = block(480, 140);
    expect(remote?.posts.map((p) => p.area)).toEqual(before?.posts.map((p) => p.area));
    expect(remote?.posts[0]?.area).toBe(before?.posts[0]?.area);
    const local = block(36, 40);
    const area = local?.posts[0]?.area;
    if (area === undefined) throw new Error('post coverage');
    expect(reachContains(area, 36, 40)).toBe(false);
    expect(local?.posts.at(-1)?.area).toBe(remote?.posts.at(-1)?.area);
  });
  it('relinks the posts a wall splits and keeps the far pair linked', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(500, 150) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const posts = [30, 60, 330, 360].map((hx) => {
      const post = sim.world.create();
      sim.world.add(post, Owner, { player: 0 });
      sim.world.add(post, Position, positionOfNode(hx, 40));
      sim.world.add(post, Signpost, { links: [] });
      return post;
    });
    signpostLinksSystem(sim.world, ctxOf(sim));
    const wall = (hx: number) => {
      const id = sim.world.create();
      sim.world.add(id, Position, positionOfNode(hx, 0));
      sim.world.add(id, ResourceFootprint, {
        walk: Array.from({ length: 150 }, (_, dy) => ({ dx: 0, dy })),
        build: [],
        work: [],
      });
      signpostLinksSystem(sim.world, ctxOf(sim));
    };
    wall(480);
    wall(45);
    expect(posts.map((p) => sim.world.get(p, Signpost).links)).toEqual([[], [], [posts[3]], [posts[2]]]);
  });
  it('links as a fresh pass would after an owner change and a post added and razed', () => {
    type Edit = (sim: Simulation) => void;
    const P0 = 0;
    const P1 = 1;
    const POST_HY = 40;
    const postAt =
      (hx: number): Edit =>
      (sim) => {
        const post = sim.world.create();
        sim.world.add(post, Owner, { player: P0 });
        sim.world.add(post, Position, positionOfNode(hx, POST_HY));
        sim.world.add(post, Signpost, { links: [] });
      };
    const farWall: Edit = (sim) => {
      const wall = sim.world.create();
      sim.world.add(wall, Position, positionOfNode(480, 0));
      sim.world.add(wall, ResourceFootprint, {
        walk: Array.from({ length: 150 }, (_, dy) => ({ dx: 0, dy })),
        build: [],
        work: [],
      });
    };
    const postsOf = (sim: Simulation): readonly Entity[] =>
      sim.world.canonicalQuery(Signpost, Position, Owner);
    const linksOf = (sim: Simulation) => postsOf(sim).map((p) => [p, sim.world.get(p, Signpost).links]);
    const edits: Edit[][] = [
      [30, 60, 90, 330, 360].map(postAt),
      // Meets no post's read box, so every post keeps its links unasked.
      [farWall],
      [(sim) => stampOwner(sim.world, postsOf(sim)[1] as Entity, P1)],
      [postAt(120), (sim) => razeSignpost(sim.world, postsOf(sim)[0] as Entity)],
    ];
    const newSim = () => new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(500, 150) });
    const reused = newSim();
    edits.forEach((step, i) => {
      for (const edit of step) edit(reused);
      signpostLinksSystem(reused.world, ctxOf(reused));
      const fresh = newSim();
      for (const edit of edits.slice(0, i + 1).flat()) edit(fresh);
      signpostLinksSystem(fresh.world, ctxOf(fresh));
      expect(linksOf(reused), `after edit ${i}`).toEqual(linksOf(fresh));
    });
  });
  it('answers coverage as a fresh one does after a block lands beside its posts', () => {
    // Resistance 5 spends the 80-point budget within 16 steps, so each post reads about 17 nodes around it.
    const sim = new Simulation({ seed: 1, content: testContent(), map: roughNodeMap(300, 100, () => 5) });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const posts = [40, 70, 100, 130].map((hx) => {
      const entity = sim.world.create();
      sim.world.add(entity, Owner, { player: 0 });
      sim.world.add(entity, Position, positionOfNode(hx, 30));
      sim.world.add(entity, Signpost, { links: [] });
      return { entity, hx, hy: 30, group: 0 };
    });
    const coverage = new GroupCoverage(sim.world, sim.content, terrain, posts, GOODS_SEARCH_SPAN);
    expect(coverage.covers(100, 30, 0)).toBe(true);
    const block = sim.world.create();
    sim.world.add(block, Position, positionOfNode(145, 30));
    sim.world.add(block, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
    expect(coverage.covers(100, 30, 1)).toBe(true);
    const fresh = new GroupCoverage(sim.world, sim.content, terrain, posts, GOODS_SEARCH_SPAN);
    for (let hx = 90; hx < 160; hx++) expect(coverage.covers(hx, 30, 1)).toBe(fresh.covers(hx, 30, 1));
    expect(coverage.covers(145, 30, 1)).toBe(false);
  });
  it('rebuilds a group coverage when one of its posts searches again', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(200, 100) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    const a = createSignpost(sim.world, terrain, terrain.nodeAt(35, 30), 0, sim.content);
    const b = createSignpost(sim.world, terrain, terrain.nodeAt(65, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const allows = (hx: number) =>
      goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30)?.allowsNode(terrain.nodeAt(hx, 30));
    expect(allows(95)).toBe(true);
    const wall = sim.world.create();
    sim.world.add(wall, Position, positionOfNode(80, 0));
    sim.world.add(wall, ResourceFootprint, {
      walk: Array.from({ length: 100 }, (_, dy) => ({ dx: 0, dy })),
      build: [],
      work: [],
    });
    signpostLinksSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(a, Signpost).links).toEqual([b]);
    expect(allows(95)).toBe(false);
    expect(allows(75)).toBe(true);
  });
  it('refuses a node no post search reaches and allows one a caught post covers', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(300, 100) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    createSignpost(sim.world, terrain, terrain.nodeAt(40, 30), 0, sim.content);
    createSignpost(sim.world, terrain, terrain.nodeAt(70, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const limit = goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30);
    expect(limit?.allowsNode(terrain.nodeAt(200, 30))).toBe(false);
    expect(limit?.allowsNode(terrain.nodeAt(100, 30))).toBe(true);
  });
  it('rules out a neighbourhood only when no node in it passes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(240, 100) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('terrain');
    createSignpost(sim.world, terrain, terrain.nodeAt(40, 30), 0, sim.content);
    createSignpost(sim.world, terrain, terrain.nodeAt(70, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const limit = goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30);
    if (limit?.mayAllowNear === undefined) throw new Error('a goods search answers neighbourhoods');
    const RADIUS = 3;
    const STEP = 4;
    let ruledOut = 0;
    for (let y = 0; y < terrain.height; y += STEP)
      for (let x = 0; x < terrain.width; x += STEP) {
        if (limit.mayAllowNear(x, y, RADIUS)) continue;
        ruledOut++;
        for (let dy = -RADIUS; dy <= RADIUS; dy++)
          for (let dx = Math.abs(dy) - RADIUS; dx <= RADIUS - Math.abs(dy); dx++) {
            if (!terrain.inBounds(x + dx, y + dy)) continue;
            expect(limit.allowsNode(terrain.nodeAt(x + dx, y + dy))).toBe(false);
          }
      }
    expect(ruledOut).toBeGreaterThan(0);
    const wide = intersectReach({ bounds: limit.bounds, allowsNode: () => true }, limit);
    expect(wide?.mayAllowNear?.(200, 30, RADIUS)).toBe(false);
  });
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
    expect(
      nearestStoreHolding(
        targets.bands,
        sim.world,
        terrain.nodeAt(35, 30),
        terrain.nodeAt(35, 30),
        1,
        0,
        collectSupplyTally(sim.world),
      ),
    ).toBeNull();
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
        terrain.nodeAt(35, 30),
        1,
        0,
        collectSupplyTally(sim.world),
      ),
    ).toBe(goods);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
