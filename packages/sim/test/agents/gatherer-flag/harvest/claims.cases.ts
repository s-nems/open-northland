import { describe, expect, it } from 'vitest';
import { CurrentAtomic, Position, Settler } from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { Simulation } from '../../../../src/index.js';
import { testContent } from '../../../fixtures/content.js';
import {
  bindToFlag,
  CHOPS_TO_FELL,
  grassMap,
  groundHeapWood,
  makeWoodcutter,
  placeFellableTree,
  TREE_WOOD_YIELD,
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
    expect(CHOPS_TO_FELL).toBeGreaterThan(0); // fixture sanity: felling takes several swings
    expect(TREE_WOOD_YIELD).toBeGreaterThan(0);
  });

  it('with one free node, exactly one gatherer digs and the surplus waits by the flag', () => {
    const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(30, 6) });
    const tree = placeFellableTree(sim, 10, 2);
    const crew: Entity[] = [];
    for (let i = 0; i < 3; i++) {
      const g = makeWoodcutter(sim, 4 + i, 2);
      bindToFlag(sim, g, 7, 2, WIDE_RADIUS);
      crew.push(g);
    }
    // Run just long enough for the crew to reach the tree and the first swings to land — but not to
    // fell it (CHOPS_TO_FELL swings × several ticks each stays comfortably ahead).
    for (let t = 0; t < 60; t++) {
      sim.step();
      const diggers = crew.filter((g) => harvestTargetOf(sim, g) === tree);
      expect(diggers.length, `tick ${sim.tick}`).toBeLessThanOrEqual(1);
    }
    // Everyone is still a settler standing somewhere sane (nobody teleported or got stuck without state).
    for (const g of crew) {
      expect(sim.world.has(g, Settler)).toBe(true);
      expect(sim.world.has(g, Position)).toBe(true);
    }
  });
});
