import { describe, expect, it } from 'vitest';
import { amuletsScene } from '../../src/scenes/amulets.js';
import { createSceneSim } from '../../src/scenes/index.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The amulet effects over REAL content: the merge's `equip` overlay has to reach the real amulet ids
 *  (50-55, not the sandbox 150-155) and act beside the extracted weapons and walk data. */
describe.runIf(hasRealIr())('amulets on real content', () => {
  it('every amulet trial passes', { timeout: 30_000 }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(amuletsScene, { content: merge.content });
    sim.run(amuletsScene.runTicks);
    for (const check of amuletsScene.checks) expect(check.predicate(sim), check.label).toBe(true);
  });
});
