import { describe, expect, it } from 'vitest';
import { ZERO } from '../../../src/core/fixed.js';
import { World } from '../../../src/ecs/world.js';
import { separationScratch } from '../../../src/systems/movement/collision/separation/scratch.js';

describe('unit body collision — scratch lifetime', () => {
  it('recycles active snapshots without retaining historical entity ids', () => {
    const world = new World();
    const entity = world.create();
    const first = separationScratch(world);
    const snapshot = { x: ZERO, y: ZERO, hx: ZERO, hy: ZERO };
    first.before.set(entity, snapshot);

    const next = separationScratch(world);

    expect(next.before.size).toBe(0);
    expect(next.snapshotPool).toEqual([snapshot]);
  });
});
