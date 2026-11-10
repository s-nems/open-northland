import { describe, expect, it } from 'vitest';
import { AliveEntities } from '../../src/ecs/alive-entities.js';
import type { Entity } from '../../src/ecs/component.js';

const WORD_EDGES = [1, 31, 32, 63, 64, 5000];
/** Past the bitset: only a crafted save names such an id. */
const FAR = [0x7fff0000, 20_000_000];

describe('AliveEntities', () => {
  it('lists the ids ascending across word edges and far ids, and forgets a deleted one', () => {
    const alive = new AliveEntities();
    for (const id of [...FAR, ...WORD_EDGES].reverse()) alive.add(id as Entity);
    alive.add(31 as Entity);
    expect(alive.size).toBe(WORD_EDGES.length + FAR.length);
    expect(alive.ascending()).toEqual([...WORD_EDGES, 20_000_000, 0x7fff0000]);
    expect(alive.has(33 as Entity)).toBe(false);
    expect(alive.has(-1 as Entity)).toBe(false);

    alive.delete(31 as Entity);
    alive.delete(20_000_000 as Entity);
    alive.delete(31 as Entity);
    expect(alive.has(31 as Entity)).toBe(false);
    expect(alive.ascending()).toEqual([1, 32, 63, 64, 5000, 0x7fff0000]);
    expect(alive.size).toBe(WORD_EDGES.length + FAR.length - 2);
  });
});
