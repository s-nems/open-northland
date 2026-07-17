import { CORE_INVARIANTS, checkInvariants } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';

/**
 * The headless half of the acceptance-scene system: every registered scene is run with NO screen and
 * its mechanic checks are asserted. This is the part an AGENT can self-validate — the browser
 * (`?scene=<id>`) view is for the HUMAN to judge the pixels (see docs/SCENES.md). Each `createSceneSim`
 * builds an independent sim (its own component stores), so the cases are isolated regardless of order.
 */
/** A full-scene sim run is seconds-long (the heaviest, sandbox, measures ~9s wall / ~5s CPU per run
 *  at 1200 ticks — see docs/tickets/sim/confined-idle-worker-dormancy.md for the perf follow-up), so
 *  the sim-running cases carry their own budget instead of Vitest's 5s default. The budget is a
 *  hang-guard, not a benchmark: it is sized ~13× the heaviest measured run because on a machine
 *  shared by several agent sessions a full parallel suite has been observed to stretch wall time to
 *  >6× CPU time. The determinism case runs each scene twice, so it gets twice the budget. */
const SCENE_RUN_TIMEOUT_MS = 120_000;
const DETERMINISM_TIMEOUT_MS = 2 * SCENE_RUN_TIMEOUT_MS;

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

      it('is byte-identical from the same seed (determinism)', { timeout: DETERMINISM_TIMEOUT_MS }, () => {
        const a = createSceneSim(scene);
        a.run(scene.runTicks);
        const first = a.hashState();
        const b = createSceneSim(scene);
        b.run(scene.runTicks);
        expect(b.hashState()).toBe(first);
      });
    });
  }
});
