import { describe, expect, it, vi } from 'vitest';
import { Engagement } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { combatSystem, SIGHT_RADIUS_NODES } from '../../src/systems/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { NodeBuckets } from '../../src/systems/spatial/nodes.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { combatantAtNode, ctxOf, P0, P1 } from './stances/support.js';

/**
 * The combat index's build cost tracks ACTIVE conflict, not map population: the coarse presence layer spans
 * every combatant, but the fine ring-search buckets are built per coarse cell only where a seeker actually
 * searches. A settlement nowhere near an enemy is gated out and costs no bucket at all.
 */

/** The entities the tick bucketed into the fine ring-search layer. */
function bucketed(run: () => void): Set<Entity> {
  const spy = vi.spyOn(NodeBuckets.prototype, 'insert');
  try {
    run();
    return new Set(spy.mock.calls.map(([e]) => e));
  } finally {
    spy.mockRestore();
  }
}

describe('combat index - the fine build follows the fight', () => {
  const bigMap = () => grassCellMap(64, 64); // 128×128 half-cell nodes, 4×4 coarse cells

  it('buckets only the coarse cells a seeker searches, not every combatant on the map', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    // The fight: two enemies inside sight of each other, in the map's first coarse cell.
    const attacker = combatantAtNode(sim, 4, 4, P0, MILITARY_MODE.ATTACK);
    const enemy = combatantAtNode(sim, 4 + SIGHT_RADIUS_NODES - 1, 4, P1, MILITARY_MODE.IGNORE);
    // The peaceful settlement: one player's own crowd, coarse cells away from any enemy.
    const bystanders = [100, 104, 108, 112].map((hy) =>
      combatantAtNode(sim, 100, hy, P0, MILITARY_MODE.FLEE),
    );

    const inserted = bucketed(() => combatSystem(sim.world, ctxOf(sim)));

    expect(sim.world.has(attacker, Engagement)).toBe(true); // the fight resolved as usual…
    expect(inserted).toEqual(new Set([attacker, enemy])); // …and nothing else was ever bucketed
    for (const e of bystanders) expect(inserted.has(e)).toBe(false);
  });

  it('buckets a bystander once its own cell comes into a seeker’s search box', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: bigMap() });
    const attacker = combatantAtNode(sim, 40, 40, P0, MILITARY_MODE.ATTACK);
    combatantAtNode(sim, 40 + SIGHT_RADIUS_NODES - 1, 40, P1, MILITARY_MODE.IGNORE);
    // A friend of the attacker's, too far to be a target but inside the same coarse cells the search
    // realizes: it costs a bucket, which is the granularity the box query pays for.
    const friend = combatantAtNode(sim, 40, 44, P0, MILITARY_MODE.IGNORE);

    const inserted = bucketed(() => combatSystem(sim.world, ctxOf(sim)));

    expect(sim.world.has(attacker, Engagement)).toBe(true);
    expect(inserted.has(friend)).toBe(true);
  });
});
