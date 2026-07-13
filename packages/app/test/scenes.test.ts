import { CORE_INVARIANTS, checkInvariants } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';

/**
 * The headless half of the acceptance-scene system: every registered scene is run with NO screen and
 * its mechanic checks are asserted. This is the part an AGENT can self-validate — the browser
 * (`?scene=<id>`) view is for the HUMAN to judge the pixels (see docs/SCENES.md). `createSceneSim`
 * resets the singleton component stores on each call, so the cases are isolated regardless of order.
 */
/** A full-scene sim run is seconds-long (battle is ~3s per run, and the determinism case runs each
 *  scene twice), so the sim-running cases carry their own budget instead of Vitest's 5s default. */
const SCENE_RUN_TIMEOUT_MS = 30_000;

describe('acceptance scenes', () => {
  for (const scene of SCENES) {
    describe(scene.id, () => {
      it('satisfies its mechanic checks and holds the core invariants', {
        timeout: SCENE_RUN_TIMEOUT_MS,
      }, () => {
        const sim = createSceneSim(scene);
        sim.run(scene.runTicks);
        expect(checkInvariants(sim.world, CORE_INVARIANTS)).toEqual([]);
        for (const check of scene.checks) {
          expect(check.predicate(sim), check.label).toBe(true);
        }
      });

      it('is byte-identical from the same seed (determinism)', { timeout: SCENE_RUN_TIMEOUT_MS }, () => {
        const a = createSceneSim(scene);
        a.run(scene.runTicks);
        const first = a.hashState();
        const b = createSceneSim(scene);
        b.run(scene.runTicks);
        expect(b.hashState()).toBe(first);
      });

      it('has a non-empty acceptance checklist for the human reviewer', () => {
        expect(scene.checklist.length).toBeGreaterThan(0);
      });
    });
  }
});
