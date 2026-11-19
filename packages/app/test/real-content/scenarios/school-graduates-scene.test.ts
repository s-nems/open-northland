import { components, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BAKER, JOB_SMITH, JOB_TAILOR } from '../../../src/catalog/jobs.js';
import { createSceneSim } from '../../../src/scenes/index.js';
import {
  CAKE_GOOD,
  graduateJoiners,
  LEATHER_ARMOR_GOOD,
  methodPupil,
  PLATE_ARMOR_GOOD,
  schoolGraduatesScene,
} from '../../../src/scenes/settlers/school-graduates.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

let graduated: Promise<Simulation> | undefined;

/** The scene run to its end once; the cases only read it. */
function graduatedScene(): Promise<Simulation> {
  graduated ??= loadContentUnderTest().then(({ merge }) => {
    const sim = createSceneSim(schoolGraduatesScene, { content: merge.content });
    sim.run(schoolGraduatesScene.runTicks);
    return sim;
  });
  return graduated;
}

/** The `jobType` graduate works at a `buildingId` and makes `good` alone of its products. */
function expectStartsOn(sim: Simulation, jobType: number, buildingId: string, good: string): void {
  const pupil = methodPupil(sim, jobType);
  if (pupil === undefined) throw new Error(`no settler of job ${jobType} in the scene`);
  const workplace = sim.world.get(pupil, components.JobAssignment).workplace;
  const building = sim.content.buildings.find(
    (b) => b.typeId === sim.world.get(workplace, components.Building).buildingType,
  );
  expect(building?.id).toBe(buildingId);
  const counters = sim.world.get(pupil, components.ProductionCounters);
  const started = sim.content.goods.find((g) => g.id === good)?.typeId ?? -1;
  for (const recipe of building?.recipes ?? []) {
    const product = recipe.outputs[0]?.goodType ?? -1;
    const expected = product === started ? components.PRODUCTION_UNLIMITED : 0;
    expect(components.productionCountOf(counters, product), `good ${product}`).toBe(expected);
  }
}

/** The assistant's graduate posting over REAL content, where the joinery employs the joiner id the school
 *  teaches (the sandbox rebases workshop slots clear of it). */
describe.runIf(hasRealIr())('school graduates on real content', () => {
  it('posts one graduate to the joinery and leaves the other by the school', {
    timeout: 30_000,
  }, async () => {
    const sim = await graduatedScene();
    for (const check of schoolGraduatesScene.checks) expect(check.predicate(sim), check.label).toBe(true);
    const posted = graduateJoiners(sim).filter((e) => sim.world.has(e, components.JobAssignment));
    expect(posted).toHaveLength(1);
  });

  it('posts a smith taught plate armour to the smithy that makes it, forging plate', {
    timeout: 30_000,
  }, async () => {
    const sim = await graduatedScene();
    expectStartsOn(sim, JOB_SMITH, 'work_smithy_01', PLATE_ARMOR_GOOD);
  });

  it('posts a baker taught cakes to the bakery, baking cakes', {
    timeout: 30_000,
  }, async () => {
    const sim = await graduatedScene();
    expectStartsOn(sim, JOB_BAKER, 'work_bakery_01', CAKE_GOOD);
  });

  it('teaches a tailor leather armour, which he then makes', {
    timeout: 30_000,
  }, async () => {
    const sim = await graduatedScene();
    expectStartsOn(sim, JOB_TAILOR, 'work_sewery_01', LEATHER_ARMOR_GOOD);
  });
});
