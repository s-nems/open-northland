import { describe, expect, it } from 'vitest';
import { PathFollow } from '../../../src/components/index.js';
import type { SystemContext } from '../../../src/systems/index.js';
import { collectColliders } from '../../../src/systems/movement/collision/separation/colliders.js';
import { separationScratch } from '../../../src/systems/movement/collision/separation/scratch.js';
import { P0, settlerAt, sim, WOODCUTTER, walkStraightTo } from './support.js';

describe('unit body collision - scratch lifetime', () => {
  it('keeps a walking mover snapshot and pools it once the mover stops', () => {
    const s = sim();
    const walker = settlerAt(s, 2, 2, WOODCUTTER, P0);
    const other = settlerAt(s, 6, 2, WOODCUTTER, P0);
    walkStraightTo(s, walker, 4, 2);
    walkStraightTo(s, other, 8, 2);
    const ctx: SystemContext = {
      content: s.content,
      rng: s.rng,
      tick: 0,
      events: s.events,
      commands: s.commands,
    };
    const scratch = separationScratch(s.world);

    collectColliders(s.world, ctx, scratch);
    const kept = scratch.before.get(walker);
    expect(kept).toBeDefined();
    collectColliders(s.world, ctx, separationScratch(s.world));
    expect(scratch.before.get(walker)).toBe(kept);

    s.world.remove(walker, PathFollow);
    collectColliders(s.world, ctx, separationScratch(s.world));
    expect(scratch.before.has(walker)).toBe(false);
    expect(scratch.before.has(other)).toBe(true);
    expect(scratch.snapshotPool).toContain(kept);
    expect(scratch.movers).toEqual([other]);
  });
});
