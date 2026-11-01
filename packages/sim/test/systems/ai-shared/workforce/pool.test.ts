import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../../src/ecs/world.js';
import { SpareForce } from '../../../../src/systems/ai-shared/workforce/pool.js';

const POOL = [5, 3, 8, 2] as Entity[];
const VETERAN = 8 as Entity;
const UNWED = new Set<Entity>([3 as Entity, 2 as Entity]);

describe('SpareForce.take', () => {
  it('lets a preferred man win only among equal ranks, first in pool order on a tie', () => {
    const prefer = (e: Entity): boolean => UNWED.has(e);
    expect(new SpareForce(POOL).take(undefined, () => 0, prefer)).toBe(3);
    expect(new SpareForce(POOL).take(undefined, undefined, prefer)).toBe(3);
    expect(new SpareForce(POOL).take(undefined, (e) => (e === VETERAN ? 1 : 0), prefer)).toBe(VETERAN);
    expect(new SpareForce(POOL).take(undefined, () => 0)).toBe(5);
  });
});
