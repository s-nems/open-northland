import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE_INVARIANTS, checkInvariants, exportSaveGame } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';
import type { SceneDefinition } from '../../src/scenes/types.js';

export const SCENE_TEST_SUFFIX = '.test.ts';

/** A hang-guard, not a budget: scene runs are seconds of CPU, but this suite spreads 26 of them over
 *  the worker pool, so any one of them can wait out most of its wall time on a busy machine. */
const SCENE_RUN_TIMEOUT_MS = 300_000;

/**
 * Runs one acceptance scene headlessly and asserts its mechanic checks. A caller imports its own scene
 * module rather than `src/scenes/index.js`: the barrel would make every worker evaluate all 26 scenes.
 * `testFileUrl` is checked against `scene.id` so a copied stub cannot run a scene its file is not named
 * for, which `registry.test.ts` alone would not notice.
 */
export function sceneAcceptance(scene: SceneDefinition, testFileUrl: string): void {
  it(`${scene.id} is the scene its file is named for`, () => {
    expect(basename(fileURLToPath(testFileUrl), SCENE_TEST_SUFFIX)).toBe(scene.id);
  });

  it(`${scene.id} satisfies its mechanic checks and holds the core invariants`, {
    timeout: SCENE_RUN_TIMEOUT_MS,
  }, () => {
    const sim = createSceneSim(scene);
    sim.run(scene.runTicks);
    expect(checkInvariants(sim.world, sim.content, CORE_INVARIANTS)).toEqual([]);
    for (const check of scene.checks) {
      expect(check.predicate(sim), check.label).toBe(true);
    }
    // The export rejects a component payload shared with another component or a module constant, and
    // it is the player's Save button that would hit it. These scenes reach far more systems than the
    // save suite's own worlds do, so each one proves its own state is saveable.
    expect(() => exportSaveGame(sim)).not.toThrow();
  });
}
