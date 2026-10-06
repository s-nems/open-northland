import { describe, expect, it } from 'vitest';
import { GOODS_SEARCH_RANGE_NODES, Position, ResourceFootprint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { intersectReach, reachContains, searchReach } from '../../src/nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { Simulation } from '../../src/simulation.js';
import { walkBlockMask } from '../../src/systems/footprint/walk-block-mask.js';
import { layRoad } from '../../src/systems/roads/index.js';
import { signpostLinksSystem } from '../../src/systems/signposts/links.js';
import { networkLimitAt, signpostNetwork } from '../../src/systems/signposts/network.js';
import { createSignpost, razeSignpost } from '../../src/systems/signposts/placement.js';
import { goodsReachAt, goodsSearchLimitAt } from '../../src/systems/signposts/reach.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap, roughNodeMap } from '../fixtures/terrain.js';

const RANGE = GOODS_SEARCH_RANGE_NODES;
/** Every how many nodes a whole-map comparison samples, on both axes. */
const SAMPLE_STEP = 3;

function navigableSim(width: number, height: number, roughness?: (hx: number, hy: number) => number) {
  const sim = new Simulation({
    seed: 1,
    content: testContent(),
    map: roughness === undefined ? grassNodeMap(width, height) : roughNodeMap(width, height, roughness),
  });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('terrain');
  return { sim, terrain };
}

function blockNodes(sim: Simulation, hx: number, hy: number, cells: { dx: number; dy: number }[]): Entity {
  const id = sim.world.create();
  sim.world.add(id, Position, positionOfNode(hx, hy));
  sim.world.add(id, ResourceFootprint, { walk: cells, build: [], work: [] });
  return id;
}

/** The goods search rule spelled out eagerly from fresh floods: the local reach, plus every group of the
 *  player with a post inside it. */
function eagerAllows(sim: Simulation, terrain: TerrainGraph, player: number, hx: number, hy: number) {
  const blocked = walkBlockMask(sim.world, { content: sim.content }, terrain).levelled();
  const local = searchReach(terrain, blocked, hx, hy, RANGE);
  const posts = signpostNetwork(sim.world).get(player) ?? [];
  const caught = new Set(posts.filter((p) => reachContains(local, p.hx, p.hy)).map((p) => p.group));
  const coverage = posts
    .filter((p) => caught.has(p.group))
    .map((p) => searchReach(terrain, blocked, p.hx, p.hy, RANGE));
  return (x: number, y: number) =>
    reachContains(local, x, y) || coverage.some((area) => reachContains(area, x, y));
}

function expectLimitMatchesRule(
  sim: Simulation,
  terrain: TerrainGraph,
  player: number,
  hx: number,
  hy: number,
) {
  const limit = goodsSearchLimitAt(sim.world, sim.content, terrain, player, hx, hy);
  if (limit === null) throw new Error('signpost navigation is on');
  const rule = eagerAllows(sim, terrain, player, hx, hy);
  let allowed = 0;
  for (let y = 0; y < terrain.height; y += SAMPLE_STEP)
    for (let x = 0; x < terrain.width; x += SAMPLE_STEP) {
      const expected = rule(x, y);
      expect(limit.allowsNode(terrain.nodeAt(x, y)), `(${x}, ${y}) from (${hx}, ${hy})`).toBe(expected);
      if (expected) allowed++;
    }
  return allowed;
}

describe('goods search limit', () => {
  it('answers every node as the eager rule does over posts, groups, blockers and roads', () => {
    const { sim, terrain } = navigableSim(300, 160, (hx, hy) => 1 + ((hx * 7 + hy * 3) % 4));
    for (const [hx, hy] of [
      [40, 40],
      [70, 40],
      [100, 45],
      [200, 120],
      [230, 120],
    ] as const)
      createSignpost(sim.world, terrain, terrain.nodeAt(hx, hy), 0, sim.content);
    createSignpost(sim.world, terrain, terrain.nodeAt(60, 70), 1, sim.content);
    blockNodes(
      sim,
      85,
      0,
      Array.from({ length: 60 }, (_, dy) => ({ dx: 0, dy })),
    );
    layRoad(
      sim.world,
      terrain,
      Array.from({ length: 50 }, (_, i) => terrain.nodeAt(110 + i, 50)),
    );
    signpostLinksSystem(sim.world, ctxOf(sim));
    let allowed = 0;
    for (const [hx, hy] of [
      [30, 40],
      [75, 60],
      [120, 50],
      [210, 110],
      [150, 140],
    ] as const)
      allowed += expectLimitMatchesRule(sim, terrain, 0, hx, hy);
    expect(allowed).toBeGreaterThan(0);
  });

  it("never opens another player's group, even with its post inside the range", () => {
    const { sim, terrain } = navigableSim(240, 100);
    createSignpost(sim.world, terrain, terrain.nodeAt(40, 30), 1, sim.content);
    createSignpost(sim.world, terrain, terrain.nodeAt(70, 30), 1, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const far = terrain.nodeAt(100, 30);
    expect(goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30)?.allowsNode(far)).toBe(false);
    expect(goodsSearchLimitAt(sim.world, sim.content, terrain, 1, 20, 30)?.allowsNode(far)).toBe(true);
  });

  it('follows a group gaining and losing posts, and changing members at an unchanged count', () => {
    const { sim, terrain } = navigableSim(320, 100);
    const post = (hx: number) => createSignpost(sim.world, terrain, terrain.nodeAt(hx, 30), 0, sim.content);
    const allows = (hx: number) => {
      signpostLinksSystem(sim.world, ctxOf(sim));
      return goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30)?.allowsNode(
        terrain.nodeAt(hx, 30),
      );
    };
    post(35);
    const b = post(65);
    post(135);
    expect(allows(170)).toBe(false);
    const bridge = post(100);
    expect(allows(170)).toBe(true);
    razeSignpost(sim.world, bridge);
    expect(allows(170)).toBe(false);
    post(100);
    razeSignpost(sim.world, b);
    // Three posts again, but the start's group is now the lone post at 35.
    expect(allows(80)).toBe(false);
    expect(allows(170)).toBe(false);
  });

  it('throws when asked after a world write moved the reach key', () => {
    const { sim, terrain } = navigableSim(200, 100);
    createSignpost(sim.world, terrain, terrain.nodeAt(40, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const limit = goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30);
    if (limit === null) throw new Error('signpost navigation is on');
    sim.world.create(); // a write that leaves the key alone
    expect(limit.allowsNode(terrain.nodeAt(25, 30))).toBe(true);
    blockNodes(sim, 150, 80, [{ dx: 0, dy: 0 }]);
    expect(() => limit.allowsNode(terrain.nodeAt(25, 30))).toThrow(/reach key moved/);
    expect(() => limit.mayAllowNear?.(25, 30, 1)).toThrow(/reach key moved/);
  });

  it('keeps a signpost confinement and a goods search sound when one gate rules a neighbourhood out', () => {
    const { sim, terrain } = navigableSim(240, 100);
    createSignpost(sim.world, terrain, terrain.nodeAt(40, 30), 0, sim.content);
    createSignpost(sim.world, terrain, terrain.nodeAt(70, 30), 0, sim.content);
    signpostLinksSystem(sim.world, ctxOf(sim));
    const confinement = networkLimitAt(sim.world, terrain, 0, 150, 30);
    const goods = goodsSearchLimitAt(sim.world, sim.content, terrain, 0, 20, 30);
    if (confinement === null || goods === null) throw new Error('signpost navigation is on');
    expect(confinement.mayAllowNear).toBeDefined();
    const both = intersectReach(confinement, goods);
    const near = both?.mayAllowNear;
    if (both === undefined || near === undefined) throw new Error('the intersection answers neighbourhoods');
    const RADIUS = 2;
    const STEP = 4;
    let ruledOut = 0;
    for (let y = 0; y < terrain.height; y += STEP)
      for (let x = 0; x < terrain.width; x += STEP) {
        if (near(x, y, RADIUS)) continue;
        ruledOut++;
        for (let dy = -RADIUS; dy <= RADIUS; dy++)
          for (let dx = Math.abs(dy) - RADIUS; dx <= RADIUS - Math.abs(dy); dx++) {
            if (terrain.inBounds(x + dx, y + dy))
              expect(both.allowsNode(terrain.nodeAt(x + dx, y + dy))).toBe(false);
          }
      }
    expect(ruledOut).toBeGreaterThan(0);
    // Each side alone would admit a node the other rules out.
    expect(near(130, 30, RADIUS)).toBe(false);
    expect(near(10, 30, RADIUS)).toBe(false);
  });
});

describe('held goods reach', () => {
  it('answers anew when a blocked start opens', () => {
    const { sim, terrain } = navigableSim(200, 100);
    const read = () => goodsReachAt(sim.world, sim.content, terrain, 60, 40);
    const stone = blockNodes(sim, 60, 40, [{ dx: 0, dy: 0 }]);
    const shut = read();
    expect(reachContains(shut, 60, 40)).toBe(false);
    expect(reachContains(shut, 61, 40)).toBe(false);
    sim.world.destroy(stone);
    expect(reachContains(read(), 61, 40)).toBe(true);
  });

  it('matches a fresh flood after blocks and roads change on the ring just outside its entered nodes', () => {
    const { sim, terrain } = navigableSim(200, 120, () => 4);
    const [hx, hy] = [80, 60];
    const fresh = () =>
      searchReach(
        terrain,
        walkBlockMask(sim.world, { content: sim.content }, terrain).levelled(),
        hx,
        hy,
        RANGE,
      );
    const held = goodsReachAt(sim.world, sim.content, terrain, hx, hy);
    // Resistance 4 spends the budget within 19 steps, so the ring 20 nodes out is inspected, not entered.
    const ring: NodeId[] = [
      terrain.nodeAt(hx + 20, hy),
      terrain.nodeAt(hx - 20, hy),
      terrain.nodeAt(hx, hy + 20),
    ];
    expect(reachContains(held, hx + 20, hy)).toBe(true);
    blockNodes(sim, hx + 20, hy, [{ dx: 0, dy: 0 }]);
    const blocked = goodsReachAt(sim.world, sim.content, terrain, hx, hy);
    expect(blocked.cells).toEqual(fresh().cells);
    expect(reachContains(blocked, hx + 20, hy)).toBe(false);
    layRoad(sim.world, terrain, ring.slice(1));
    expect(goodsReachAt(sim.world, sim.content, terrain, hx, hy).cells).toEqual(fresh().cells);
    layRoad(
      sim.world,
      terrain,
      Array.from({ length: 31 }, (_, i) => terrain.nodeAt(hx - i, hy)),
    );
    const roadOut = goodsReachAt(sim.world, sim.content, terrain, hx, hy);
    expect(roadOut.cells).toEqual(fresh().cells);
    expect(reachContains(roadOut, hx - 30, hy)).toBe(true);
  });
});
