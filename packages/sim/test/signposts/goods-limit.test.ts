import { describe, expect, it } from 'vitest';
import { Position, ResourceFootprint } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { Simulation } from '../../src/simulation.js';
import { signpostLinksSystem } from '../../src/systems/signposts/links.js';
import { createSignpost } from '../../src/systems/signposts/placement.js';
import { goodsSearchLimitAt } from '../../src/systems/signposts/reach.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap } from '../fixtures/terrain.js';

function navigableSim(width: number, height: number) {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(width, height) });
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

describe('goods search limit', () => {
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
});
