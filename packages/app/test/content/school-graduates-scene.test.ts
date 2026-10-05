import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/index.js';
import {
  graduateJoiners,
  methodSmith,
  PLATE_ARMOR_GOOD,
  schoolGraduatesScene,
} from '../../src/scenes/school-graduates.js';
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

  it('posts a smith taught plate armour to the smithy that makes it, forging plate', {
    timeout: 30_000,
  }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(schoolGraduatesScene, { content: merge.content });
    sim.run(schoolGraduatesScene.runTicks);
    const smith = methodSmith(sim);
    if (smith === undefined) throw new Error('no smith in the scene');
    const workplace = sim.world.get(smith, components.JobAssignment).workplace;
    const smithy = sim.content.buildings.find(
      (b) => b.typeId === sim.world.get(workplace, components.Building).buildingType,
    );
    expect(smithy?.id).toBe('work_smithy_01');
    const counters = sim.world.get(smith, components.ProductionCounters);
    const plate = sim.content.goods.find((g) => g.id === PLATE_ARMOR_GOOD)?.typeId ?? -1;
    for (const recipe of smithy?.recipes ?? []) {
      const good = recipe.outputs[0]?.goodType ?? -1;
      const expected = good === plate ? components.PRODUCTION_UNLIMITED : 0;
      expect(components.productionCountOf(counters, good), `good ${good}`).toBe(expected);
    }
  });
});
