import { diffSnapshots } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { inlineSessionHost } from '../src/session/index.js';

/**
 * The inline host reads snapshots off a delta-fed mirror, the path a worker host will serve. Every
 * registered scene, driven tick by tick, must read the same world through the mirror as
 * `Simulation.snapshot()` gives, with an untouched entity kept as the same object across ticks.
 */

/** Enough ticks past a scene's authored setup for its systems to create, mutate and destroy entities;
 *  the scene tests own the full runs. */
const PARITY_TICKS = 60;

describe('inline host mirror parity over the scene registry', () => {
  for (const scene of SCENES) {
    it(`reads '${scene.id}' through the mirror as the live snapshot`, () => {
      const sim = createSceneSim(scene);
      const host = inlineSessionHost(sim);
      const live = inlineSessionHost(sim, { snapshots: 'live' });
      let previous = new Map<number, unknown>();
      for (let tick = 0; tick < Math.min(scene.runTicks, PARITY_TICKS); tick++) {
        sim.step();
        const mirrored = host.snapshot();
        expect(host.snapshot()).toBe(mirrored); // a frame between ticks reads the same object
        const reference = live.snapshot();
        expect(mirrored.tick).toBe(reference.tick);
        const diff = diffSnapshots(mirrored, reference);
        expect(diff.added).toEqual([]);
        expect(diff.removed).toEqual([]);
        expect(diff.changed).toEqual([]);
        expect(JSON.stringify(mirrored.events)).toBe(JSON.stringify(reference.events));
        const next = new Map<number, unknown>();
        let kept = 0;
        for (const entity of mirrored.entities) {
          next.set(entity.id, entity);
          if (previous.get(entity.id) === entity) kept++;
        }
        // Identity across ticks is what a memo keyed by entity relies on; the exact contract is pinned
        // in the sim's mirror tests, here every tick must keep what rested.
        if (tick > 0) expect(kept).toBeGreaterThan(0);
        previous = next;
      }
    });
  }
});
