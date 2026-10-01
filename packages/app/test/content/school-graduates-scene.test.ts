import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/index.js';
import { graduateJoiners, schoolGraduatesScene } from '../../src/scenes/school-graduates.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/** The assistant's graduate posting over REAL content, where the joinery employs the joiner id the school
 *  teaches (the sandbox rebases workshop slots clear of it). */
describe.runIf(hasRealIr())('school graduates on real content', () => {
  it('posts one graduate to the joinery and leaves the other by the school', {
    timeout: 30_000,
  }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(schoolGraduatesScene, { content: merge.content });
    sim.run(schoolGraduatesScene.runTicks);
    for (const check of schoolGraduatesScene.checks) expect(check.predicate(sim), check.label).toBe(true);
    const posted = graduateJoiners(sim).filter((e) => sim.world.has(e, components.JobAssignment));
    expect(posted).toHaveLength(1);
  });
});
