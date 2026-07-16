import { describe, expect, it } from 'vitest';
import { CurrentAtomic } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  grassMap,
  groundHeapWood,
  makeWoodcutter,
  placeFellableTree,
  WIDE_RADIUS,
} from '../support.js';

/**
 * One digger per resource node at a time (user-specified rule, 2026-07-16): a crew converging on one
 * camp spreads over its free nodes — a node under a colleague's live harvest atomic is claimed and the
 * next gatherer picks another; when no free node remains the surplus waits instead of crowding a swing.
 */
describe('flag gatherers — one digger per node (harvest claims)', () => {
  /** The resource entity each settler's live harvest atomic targets, or null. */
  function harvestTargetOf(sim: Simulation, e: Entity): Entity | null {
    const atomic = sim.world.tryGet(e, CurrentAtomic);
    return atomic?.effect.kind === 'harvest' ? atomic.effect.resource : null;
  }

  it('a crew on one camp never runs two simultaneous harvests of the same node', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(40, 8) });
    // Three trees in a row, four woodcutters bound to one flag beside them — one more digger than nodes.
    const trees = [
      placeFellableTree(sim, 8, 2),
      placeFellableTree(sim, 10, 2),
      placeFellableTree(sim, 12, 2),
    ];
    const crew: Entity[] = [];
    for (let i = 0; i < 4; i++) {
      const g = makeWoodcutter(sim, 2 + i, 2);
      bindToFlag(sim, g, 6, 2, WIDE_RADIUS);
      crew.push(g);
    }

    for (let t = 0; t < 400; t++) {
      sim.step();
      const digging = new Map<Entity, Entity>();
      for (const g of crew) {
        const target = harvestTargetOf(sim, g);
        if (target === null) continue;
        expect(digging.has(target), `two gatherers harvest node ${target} at tick ${sim.tick}`).toBe(false);
        digging.set(target, g);
      }
    }
    // The claim spread the crew rather than stalling it: work actually happened (some tree got chopped,
    // or its yield reached the flag yard).
    const remaining = trees.filter((tree) => sim.world.isAlive(tree)).length;
    expect(remaining < trees.length || groundHeapWood(sim) > 0).toBe(true);
  });

  it('with one free node, exactly one gatherer ever digs it — the surplus never joins the swing', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(30, 6) });
    const tree = placeFellableTree(sim, 10, 2);
    const crew: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const g = makeWoodcutter(sim, 4 + i, 2);
      bindToFlag(sim, g, 7, 2, WIDE_RADIUS);
      crew.push(g);
    }
    // Assert the one-digger rule every tick AND witness digging actually starting — a fixture change
    // that stalls the walk past the budget must fail here, not silently void the ≤1 assertion. The
    // surplus is not pinned to a spot: while one digs, the others legitimately collect its chips (the
    // pile-collection rung), so the claim rule is exactly "never two swings on one node".
    const MAX_TICKS = 400;
    let sawDigger = false;
    for (let t = 0; t < MAX_TICKS; t++) {
      sim.step();
      const diggers = crew.filter((g) => harvestTargetOf(sim, g) === tree);
      expect(diggers.length, `tick ${sim.tick}`).toBeLessThanOrEqual(1);
      if (diggers.length === 1) sawDigger = true;
    }
    expect(sawDigger).toBe(true);
  });
});
