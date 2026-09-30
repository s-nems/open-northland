import { describe, expect, it } from 'vitest';
import { idleWorkScene } from '../../src/scenes/idle-work.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('idle work on real content', () => {
  it('reports all four blockers with the loaded recipes and stock capacities', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(idleWorkScene, { content: merge.content });
    sim.run(idleWorkScene.runTicks);
    for (const check of idleWorkScene.checks) expect(check.predicate(sim), check.label).toBe(true);
  });
});
