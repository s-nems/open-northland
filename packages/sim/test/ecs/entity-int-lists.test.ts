import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/ecs/component.js';
import { EntityIntLists } from '../../src/ecs/entity-int-lists.js';

const ENTITIES = 500;
/** Rewrites per entity: enough dead words to force several compactions and growths. */
const ROUNDS = 6;

const listOf = (e: number, round: number): number[] =>
  Array.from({ length: (e * 7 + round) % 13 }, (_, k) => e * 1000 + round * 100 + k - 50);

describe('EntityIntLists', () => {
  it('keeps every list through replacements, deletions and the compactions they force', () => {
    const lists = new EntityIntLists();
    const expected = new Map<Entity, number[]>();
    for (let round = 0; round < ROUNDS; round++) {
      for (let e = 1; e <= ENTITIES; e++) {
        const entity = e as Entity;
        if ((e + round) % 5 === 0) {
          expect(lists.delete(entity)).toBe(expected.delete(entity));
        } else {
          const values = listOf(e, round);
          lists.set(entity, values);
          expected.set(entity, values);
        }
      }
    }
    expect(lists.size).toBe(expected.size);
    const out: number[] = [];
    for (let e = 1; e <= ENTITIES; e++) {
      const entity = e as Entity;
      expect(lists.read(entity, out)).toBe(expected.has(entity));
      expect(out).toEqual(expected.get(entity) ?? []);
    }
  });

  it('holds an empty list apart from no list, and forgets everything on clear', () => {
    const lists = new EntityIntLists();
    const out = [7];
    lists.set(1 as Entity, []);
    expect(lists.read(1 as Entity, out)).toBe(true);
    expect(out).toEqual([]);
    lists.clear();
    expect(lists.has(1 as Entity)).toBe(false);
    expect(lists.read(1 as Entity, out)).toBe(false);
  });
});
