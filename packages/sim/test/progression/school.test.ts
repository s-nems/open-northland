import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { Building, Owner, Settler, TrainingOrder } from '../../src/components/index.js';
import { exportSaveGame, ONE, restoreSimulation, Simulation } from '../../src/index.js';
import { learn } from '../../src/systems/orders/education.js';
import { needSubjectOf, settlerMeetsNeed } from '../../src/systems/progression/index.js';
import { planTraining } from '../../src/systems/settlers/drives/training.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

it('a school lesson qualifies only its chosen target and survives a saved in-progress lesson', () => {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: 91, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((t) => ({
      ...t,
      jobEnables: [],
      jobRequirements: [
        { target: 'job', targetId: 2, requirement: 'need', amount: 50, experienceTypes: [1] },
        { target: 'job', targetId: 2, requirement: 'train', amount: 2, experienceTypes: [77] },
        { target: 'job', targetId: 5, requirement: 'need', amount: 50, experienceTypes: [1] },
      ],
    })),
  });
  const map = grassCellMap(12, 12);
  const sim = new Simulation({ seed: 2, content, map });
  const pupil = settlerAt(sim, { jobType: 1, tribe: 1 });
  sim.world.add(pupil, Owner, { player: 0 });
  const school = sim.world.create();
  sim.world.add(school, Building, { buildingType: 91, tribe: 1, built: ONE, level: 0 });
  sim.world.add(school, Owner, { player: 0 });
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: pupil, house: school, target: 'job', typeId: 2 });
  expect(sim.world.has(pupil, TrainingOrder)).toBe(true);
  sim.world.mut(pupil, TrainingOrder).drillTicksLeft = 1;
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: pupil, house: school, target: 'job', typeId: 2 });
  expect(sim.world.get(pupil, TrainingOrder).drillTicksLeft).toBe(1);
  const other = settlerAt(sim, { jobType: 1, tribe: 1 });
  sim.world.add(other, Owner, { player: 0 });
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: other, house: school, target: 'job', typeId: 2 });
  expect(sim.world.has(other, TrainingOrder)).toBe(false);
  sim.world.remove(pupil, TrainingOrder);
  sim.world.mut(other, Owner).player = 1;
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: other, house: school, target: 'job', typeId: 2 });
  expect(sim.world.has(other, TrainingOrder)).toBe(false);
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: pupil, house: school, target: 'job', typeId: 2 });

  const restored = restoreSimulation(exportSaveGame(sim), { content, map }).sim;
  restored.world.mut(pupil, TrainingOrder).drillTicksLeft = 0;
  const terrain = restored.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  planTraining(
    restored.world,
    ctxOf(restored),
    terrain,
    pupil,
    restored.world.get(pupil, Settler),
    terrain.nodeAt(2, 2),
    null,
  );
  expect(restored.world.get(pupil, Settler).jobType).toBe(2);
  const subject = needSubjectOf(restored.world, pupil);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', 2)).toBe(true);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', 5)).toBe(false);
  expect(restored.world.get(pupil, Settler).experience.size).toBe(0);
});
