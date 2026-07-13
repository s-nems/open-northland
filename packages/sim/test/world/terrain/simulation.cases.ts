import { describe, expect, it } from 'vitest';
import { Simulation, TerrainGraph, type TerrainMap } from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { crossMap } from './support.js';

describe('terrain wired as a world resource on the Simulation', () => {
  it('builds the graph from the map and exposes it on the sim', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: crossMap() });
    expect(sim.terrain).toBeInstanceOf(TerrainGraph);
    expect(sim.terrain?.nodeCount).toBe(36);
    expect(sim.terrain?.isWalkable(sim.terrain.nodeAt(2, 2))).toBe(false); // centre water block
  });

  it('a mapless sim has no terrain resource', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    expect(sim.terrain).toBeUndefined();
  });

  it('a bad map propagates the builder guard at construction', () => {
    const bad: TerrainMap = { resolution: 'half-cell', width: 1, height: 1, typeIds: [99] };
    expect(() => new Simulation({ seed: 1, content: testContent(), map: bad })).toThrow(/typeId 99 absent/);
  });

  it('two sims with the same seed + map stay determinism-equal (terrain is not hashed state)', () => {
    const a = new Simulation({ seed: 5, content: testContent(), map: crossMap() });
    const b = new Simulation({ seed: 5, content: testContent(), map: crossMap() });
    a.run(100);
    b.run(100);
    expect(a.hashState()).toBe(b.hashState());
  });
});
