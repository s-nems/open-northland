import { describe, expect, it } from 'vitest';
import { Position, ResourceFootprint } from '../../../src/components/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../src/nav/terrain/index.js';
import { Simulation } from '../../../src/simulation.js';
import { HeldFloods } from '../../../src/systems/ai-player/held-floods.js';
import { WalkFlood } from '../../../src/systems/ai-player/walk-distance.js';
import { walkBlockMask } from '../../../src/systems/footprint/walk-block-mask.js';
import { testContent } from '../../fixtures/content.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

const MAP_NODES = 64;
const SEED = { hx: 32, hy: 32 };
/** Settles a disc well inside the map, so a far corner lies past it. */
const BUDGET = 300;
/** Every how many node ids the floods are compared. */
const PROBE_STRIDE = 5;

function setup() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const mask = walkBlockMask(sim.world, { content: sim.content }, terrain);
  return { sim, terrain, mask, seed: terrain.nodeAt(SEED.hx, SEED.hy) };
}

function block(sim: Simulation, hx: number, hy: number): void {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
}

function answers(terrain: TerrainGraph, flood: WalkFlood): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  for (let id = 0; id < terrain.nodeCount; id += PROBE_STRIDE) out.push(flood.costTo(id as NodeId));
  return out;
}

describe('held walk floods', () => {
  it('resumes a flood while no node it read flipped, and answers as a fresh flood either way', () => {
    const { sim, terrain, mask, seed } = setup();
    const held = new HeldFloods(terrain, mask);
    const first = held.floodOf(seed, BUDGET);
    const fresh = () => answers(terrain, new WalkFlood(terrain, mask, [seed], BUDGET));
    expect(answers(terrain, first)).toEqual(fresh());

    // A block far past the settled disc: nothing the flood read changed.
    block(sim, MAP_NODES - 2, 2);
    const resumed = held.floodOf(seed, BUDGET);
    expect(resumed).toBe(first);
    expect(answers(terrain, resumed)).toEqual(fresh());

    // A block beside the seed: the flood read that node, so it starts over.
    block(sim, SEED.hx + 1, SEED.hy + 1);
    const restarted = held.floodOf(seed, BUDGET);
    expect(restarted).not.toBe(first);
    expect(answers(terrain, restarted)).toEqual(fresh());
  });
});
