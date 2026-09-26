import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';
import { inlineSessionHost } from '../src/session/index.js';

/**
 * The inline host reads snapshots off a delta-fed mirror, the path a worker host will serve. Every
 * registered scene, driven tick by tick, must read the same world through the mirror as
 * `Simulation.snapshot()` gives, with untouched entities kept as the same objects.
 */

/** Enough ticks past a scene's authored setup for its systems to create, mutate and destroy entities;
 *  the scene tests own the full runs. */
const PARITY_TICKS = 60;

function canonical(snapshot: WorldSnapshot): string {
  return JSON.stringify(snapshot);
}

describe('inline host mirror parity over the scene registry', () => {
  for (const scene of SCENES) {
    it(`reads '${scene.id}' through the mirror as the live snapshot`, () => {
      const sim = createSceneSim(scene);
      const host = inlineSessionHost(sim);
      const live = inlineSessionHost(sim, { snapshots: 'live' });
      for (let tick = 0; tick < Math.min(scene.runTicks, PARITY_TICKS); tick++) {
        sim.step();
        const mirrored = host.snapshot();
        expect(host.snapshot()).toBe(mirrored); // a frame between ticks reads the same object
        const reference = live.snapshot();
        expect(canonical(mirrored)).toBe(canonical(reference));
        // One clone cache on this thread: the mirror holds the very objects the live snapshot does,
        // so every memo keyed by entity identity sees the same reuse either way.
        for (const [i, entity] of mirrored.entities.entries()) expect(entity).toBe(reference.entities[i]);
      }
    });
  }
});
