import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import { Building, Owner, Position, Settler, TrainingOrder } from '../../src/components/index.js';
import { exportSaveGame, fx, ONE, restoreSimulation, Simulation } from '../../src/index.js';
import { learn } from '../../src/systems/orders/education.js';
import {
  needSubjectOf,
  settlerMeetsNeed,
  TRAINING_EXPERIENCE_TYPE,
} from '../../src/systems/progression/index.js';
import { planTraining } from '../../src/systems/settlers/drives/training.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

const SCHOOL = 91;
const SCHOOL_AT = { x: 4, y: 4 };
const TRIBE = 1;
const WOODCUTTER = 1;
const CARPENTER = 2;
const SMITH = 5;
const WOOD_TRACK = 1;

it('a school lesson qualifies only its chosen target and survives a saved in-progress lesson', () => {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((t) => ({
      ...t,
      jobEnables: [],
      jobRequirements: [
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'need',
          amount: 50,
          experienceTypes: [WOOD_TRACK],
        },
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'train',
          amount: 2,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
        { target: 'job', targetId: SMITH, requirement: 'need', amount: 50, experienceTypes: [WOOD_TRACK] },
      ],
    })),
  });
  const map = grassCellMap(12, 12);
  const sim = new Simulation({ seed: 2, content, map });
  const pupil = settlerAt(sim, { jobType: WOODCUTTER, tribe: TRIBE });
  sim.world.add(pupil, Owner, { player: 0 });
  const school = sim.world.create();
  sim.world.add(school, Building, { buildingType: SCHOOL, tribe: TRIBE, built: ONE, level: 0 });
  sim.world.add(school, Position, { x: fx.fromInt(SCHOOL_AT.x), y: fx.fromInt(SCHOOL_AT.y) });
  sim.world.add(school, Owner, { player: 0 });
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: pupil,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });
  expect(sim.world.has(pupil, TrainingOrder)).toBe(true);
  sim.world.mut(pupil, TrainingOrder).drillTicksLeft = 1;
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: pupil,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });
  expect(sim.world.get(pupil, TrainingOrder).drillTicksLeft).toBe(1);
  const other = settlerAt(sim, { jobType: WOODCUTTER, tribe: TRIBE });
  sim.world.add(other, Owner, { player: 0 });
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: other,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });
  expect(sim.world.has(other, TrainingOrder)).toBe(false);
  sim.world.remove(pupil, TrainingOrder);
  sim.world.mut(other, Owner).player = 1;
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: other,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });
  expect(sim.world.has(other, TrainingOrder)).toBe(false);
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: pupil,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });

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
  expect(restored.world.get(pupil, Settler).jobType).toBe(CARPENTER);
  const subject = needSubjectOf(restored.world, pupil);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', CARPENTER)).toBe(true);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', SMITH)).toBe(false);
  expect(restored.world.get(pupil, Settler).experience.size).toBe(0);
});
