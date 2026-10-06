import { describe, expect, it } from 'vitest';
import { Position, ResourceFootprint } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
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
const ORIGINS = 12;
const ROUNDS = 80;
const RANDOM_BUDGETS = [40, BUDGET, 4000];
/** Asks that leave a flood partial; a prime spread scatters them over the map. */
const PARTIAL_ASKS = 60;
const PROBE_SPREAD = 7919;
const RANDOM_SEED = 99;
const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 12345;
const LCG_MODULUS = 2 ** 31;

function setup() {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_NODES, MAP_NODES) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped sim expected');
  const mask = walkBlockMask(sim.world, { content: sim.content }, terrain);
  return { sim, terrain, mask, seed: terrain.nodeAt(SEED.hx, SEED.hy) };
}

function block(sim: Simulation, hx: number, hy: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, ResourceFootprint, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
  return e;
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

  it('refuses an ask after the mask changed within the pass it was handed out for', () => {
    const { sim, terrain, mask, seed } = setup();
    const held = new HeldFloods(terrain, mask);
    const flood = held.floodOf(seed, BUDGET);
    expect(flood.costTo(seed)).toBe(0);
    block(sim, MAP_NODES - 2, 2);
    expect(() => flood.costTo(terrain.nodeAt(SEED.hx + 3, SEED.hy))).toThrow(/mask changed/);
    // Handed out anew, the flood serves the next pass.
    const next = held.floodOf(seed, BUDGET);
    expect(next.costTo(terrain.nodeAt(SEED.hx + 3, SEED.hy))).toBe(
      new WalkFlood(terrain, mask, [seed], BUDGET).costTo(terrain.nodeAt(SEED.hx + 3, SEED.hy)),
    );
  });

  it('answers as a fresh flood under random blocks added and removed, partial and saturated, past eviction', () => {
    const { sim, terrain, mask } = setup();
    const held = new HeldFloods(terrain, mask);
    let state = RANDOM_SEED;
    const draw = (bound: number): number => {
      state = (state * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
      return state % bound;
    };
    // More origins than the holder keeps, so some are evicted and flooded afresh.
    const seeds = Array.from({ length: ORIGINS }, () => terrain.nodeAt(draw(MAP_NODES), draw(MAP_NODES)));
    const blocks: Entity[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      if (blocks.length > 0 && draw(2) === 0) {
        const at = draw(blocks.length);
        const [gone] = blocks.splice(at, 1);
        if (gone !== undefined) sim.world.destroy(gone);
      } else {
        blocks.push(block(sim, draw(MAP_NODES), draw(MAP_NODES)));
      }
      const seed = seeds[draw(seeds.length)] ?? seeds[0];
      if (seed === undefined) throw new Error('origins drawn');
      const budget = RANDOM_BUDGETS[draw(RANDOM_BUDGETS.length)] ?? BUDGET;
      const flood = held.floodOf(seed, budget);
      const fresh = new WalkFlood(terrain, mask, [seed], budget);
      // A short ask leaves the flood partial; a long one saturates it.
      const asks = draw(2) === 0 ? PARTIAL_ASKS : terrain.nodeCount;
      for (let i = 0; i < asks; i += PROBE_STRIDE) {
        const node = ((i * PROBE_SPREAD) % terrain.nodeCount) as NodeId;
        expect(flood.costTo(node)).toBe(fresh.costTo(node));
        expect(flood.costFloor(node) ?? 0).toBeLessThanOrEqual(
          fresh.costTo(node) ?? Number.POSITIVE_INFINITY,
        );
      }
    }
  });
});
