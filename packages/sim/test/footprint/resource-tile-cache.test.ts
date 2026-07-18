import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { resourceAtTile } from '../../src/systems/footprint/resource-tile-cache.js';
import { testContent } from '../fixtures/content.js';

/**
 * The resource TILE index (`systems/footprint/resource-tile-cache.ts`) — the O(1) "standing resource of
 * this good on this node" join behind the ground-drop → deposit work-cell match. Pinned here: the pick is
 * the LOWEST id on the tile, an incremental removal surfaces the runner-up (each tile list keeps every
 * co-tile resource, not just the winner), and a value-overwriting re-`add` re-keys the good.
 */

const { Position, Resource } = components;
const WOOD = 1;
const STONE = 2;
const ATOMIC = 24;

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent() });
}

function resourceAt(sim: Simulation, hx: number, hy: number, good: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Resource, { goodType: good, remaining: 3, harvestAtomic: ATOMIC });
  return e;
}

describe('resourceAtTile (the ground-drop deposit join index)', () => {
  it('picks the lowest id per (tile, good) and misses cleanly elsewhere', () => {
    const sim = newSim();
    const wood = resourceAt(sim, 5, 5, WOOD);
    const laterWood = resourceAt(sim, 5, 5, WOOD);
    const stone = resourceAt(sim, 5, 5, STONE);
    expect(resourceAtTile(sim.world, 5, 5, WOOD)).toBe(wood);
    expect(laterWood).toBeGreaterThan(wood);
    expect(resourceAtTile(sim.world, 5, 5, STONE)).toBe(stone);
    expect(resourceAtTile(sim.world, 6, 5, WOOD)).toBeNull();
  });

  it('surfaces the runner-up when the winner is destroyed between reads (incremental removal)', () => {
    const sim = newSim();
    const winner = resourceAt(sim, 7, 7, WOOD);
    const runnerUp = resourceAt(sim, 7, 7, WOOD);
    expect(resourceAtTile(sim.world, 7, 7, WOOD)).toBe(winner); // build the index
    sim.world.destroy(winner);
    expect(resourceAtTile(sim.world, 7, 7, WOOD)).toBe(runnerUp);
    sim.world.destroy(runnerUp);
    expect(resourceAtTile(sim.world, 7, 7, WOOD)).toBeNull();
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('re-keys the good when a Resource row is overwritten in place (a journaled re-add)', () => {
    const sim = newSim();
    const e = resourceAt(sim, 9, 9, WOOD);
    expect(resourceAtTile(sim.world, 9, 9, WOOD)).toBe(e);
    sim.world.add(e, Resource, { goodType: STONE, remaining: 3, harvestAtomic: ATOMIC });
    expect(resourceAtTile(sim.world, 9, 9, WOOD)).toBeNull();
    expect(resourceAtTile(sim.world, 9, 9, STONE)).toBe(e);
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
