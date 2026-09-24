import { parseContentSet } from '@open-northland/data';
import { expect, it } from 'vitest';
import {
  Building,
  discoverTechnology,
  Owner,
  Position,
  Settler,
  setMapPermission,
  TrainingOrder,
} from '../../src/components/index.js';
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
const PLANK = 2;
const WOOD_TRACK = 1;

it('refuses a school course until the profession is discovered', () => {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((t) => ({
      ...t,
      technology: { houses: [] },
      jobEnables: [{ jobType: WOODCUTTER, kind: 'job', targetId: CARPENTER }],
      jobRequirements: [
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'need',
          amount: 1,
          experienceTypes: [WOOD_TRACK],
        },
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'train',
          amount: 1,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
      ],
    })),
  });
  const sim = new Simulation({ seed: 3, content, map: grassCellMap(12, 12) });
  const pupil = settlerAt(sim, { jobType: WOODCUTTER, tribe: TRIBE });
  sim.world.add(pupil, Owner, { player: 0 });
  const school = sim.world.create();
  sim.world.add(school, Building, { buildingType: SCHOOL, tribe: TRIBE, built: ONE, level: 0 });
  sim.world.add(school, Position, { x: fx.fromInt(SCHOOL_AT.x), y: fx.fromInt(SCHOOL_AT.y) });
  sim.world.add(school, Owner, { player: 0 });
  const command = { kind: 'learn', entity: pupil, house: school, target: 'job', typeId: CARPENTER } as const;

  learn(sim.world, ctxOf(sim), command);
  expect(sim.world.has(pupil, TrainingOrder)).toBe(false);

  discoverTechnology(sim.world, 0, TRIBE, 'job', CARPENTER);
  learn(sim.world, ctxOf(sim), command);
  expect(sim.world.get(pupil, TrainingOrder).lesson).toEqual({ kind: 'job', typeId: CARPENTER });
});

it('a school lesson qualifies only its chosen target and survives a saved in-progress lesson', () => {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((t) => ({
      ...t,
      jobEnables: [{ jobType: CARPENTER, kind: 'good', targetId: PLANK }],
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
        {
          target: 'good',
          targetId: PLANK,
          requirement: 'train',
          amount: 1,
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

  const restored = restoreSimulation(exportSaveGame(sim), { content, map });
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
  expect(restored.events.current()).toContainEqual({
    kind: 'settlerTrained',
    entity: pupil,
    course: 'school',
    target: 'job',
    typeId: CARPENTER,
  });
  const subject = needSubjectOf(restored.world, pupil);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', CARPENTER)).toBe(true);
  expect(settlerMeetsNeed(restored.world, ctxOf(restored), subject, 'job', SMITH)).toBe(false);
  expect(restored.world.get(pupil, Settler).experience.size).toBe(0);

  learn(restored.world, ctxOf(restored), {
    kind: 'learn',
    entity: pupil,
    house: school,
    target: 'good',
    typeId: PLANK,
  });
  expect(restored.world.has(pupil, TrainingOrder)).toBe(true);
  restored.world.mut(pupil, TrainingOrder).drillTicksLeft = 0;
  restored.events.clear();
  planTraining(
    restored.world,
    ctxOf(restored),
    terrain,
    pupil,
    restored.world.get(pupil, Settler),
    terrain.nodeAt(2, 2),
    null,
  );
  expect(restored.world.get(pupil, Settler).learned?.good).toContain(PLANK);
  expect(restored.events.current()).toContainEqual({
    kind: 'settlerTrained',
    entity: pupil,
    course: 'school',
    target: 'good',
    typeId: PLANK,
  });
});

it.each([false, true])(
  'a method course grants its trade only while it remains permitted (ban: %s)',
  (banned) => {
    const base = testContent();
    const content = parseContentSet({
      ...base,
      buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
      tribes: base.tribes.map((tribe) => ({
        ...tribe,
        jobEnables: [{ jobType: CARPENTER, kind: 'good', targetId: PLANK }],
        jobRequirements: [
          {
            target: 'job',
            targetId: CARPENTER,
            requirement: 'need',
            amount: 50,
            experienceTypes: [WOOD_TRACK],
          },
          { target: 'good', targetId: PLANK, requirement: 'need', amount: 50, experienceTypes: [WOOD_TRACK] },
          {
            target: 'good',
            targetId: PLANK,
            requirement: 'train',
            amount: 1,
            experienceTypes: [TRAINING_EXPERIENCE_TYPE],
          },
        ],
      })),
    });
    const sim = new Simulation({ seed: 4, content, map: grassCellMap(12, 12) });
    const pupil = settlerAt(sim, { jobType: WOODCUTTER, tribe: TRIBE });
    sim.world.add(pupil, Owner, { player: 0 });
    const school = sim.world.create();
    sim.world.add(school, Building, { buildingType: SCHOOL, tribe: TRIBE, built: ONE, level: 0 });
    sim.world.add(school, Position, { x: fx.fromInt(SCHOOL_AT.x), y: fx.fromInt(SCHOOL_AT.y) });
    sim.world.add(school, Owner, { player: 0 });
    discoverTechnology(sim.world, 0, TRIBE, 'good', PLANK);
    expect(sim.canChooseJob(pupil, CARPENTER)).toBe(false);
    learn(sim.world, ctxOf(sim), {
      kind: 'learn',
      entity: pupil,
      house: school,
      target: 'good',
      typeId: PLANK,
    });
    expect(sim.world.get(pupil, TrainingOrder).lesson).toEqual({ kind: 'good', typeId: PLANK });
    sim.world.mut(pupil, TrainingOrder).drillTicksLeft = 0;
    if (banned)
      setMapPermission(sim.world, {
        player: 0,
        tribe: TRIBE,
        kind: 'job',
        typeId: CARPENTER,
        allowed: false,
      });
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('missing terrain');
    planTraining(
      sim.world,
      ctxOf(sim),
      terrain,
      pupil,
      sim.world.get(pupil, Settler),
      terrain.nodeAt(2, 2),
      null,
    );
    if (banned) {
      expect(sim.world.get(pupil, Settler).jobType).toBe(WOODCUTTER);
      expect(sim.world.get(pupil, Settler).learned?.good ?? []).toEqual([]);
      expect(sim.world.has(pupil, TrainingOrder)).toBe(false);
      return;
    }
    expect(sim.world.get(pupil, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.get(pupil, Settler).learned?.job).toContain(CARPENTER);
    expect(sim.world.get(pupil, Settler).learned?.good).toEqual([PLANK]);
    expect(sim.canChooseJob(pupil, CARPENTER)).toBe(true);
  },
);

it('keeps a served lesson when the school is razed before the pupil plans again', () => {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((tribe) => ({
      ...tribe,
      jobRequirements: [
        {
          target: 'job',
          targetId: CARPENTER,
          requirement: 'train',
          amount: 1,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
      ],
    })),
  });
  const sim = new Simulation({ seed: 5, content, map: grassCellMap(12, 12) });
  const pupil = settlerAt(sim, { jobType: WOODCUTTER, tribe: TRIBE });
  sim.world.add(pupil, Owner, { player: 0 });
  const school = sim.world.create();
  sim.world.add(school, Building, { buildingType: SCHOOL, tribe: TRIBE, built: ONE, level: 0 });
  sim.world.add(school, Position, { x: fx.fromInt(SCHOOL_AT.x), y: fx.fromInt(SCHOOL_AT.y) });
  sim.world.add(school, Owner, { player: 0 });
  discoverTechnology(sim.world, 0, TRIBE, 'job', CARPENTER);
  learn(sim.world, ctxOf(sim), {
    kind: 'learn',
    entity: pupil,
    house: school,
    target: 'job',
    typeId: CARPENTER,
  });
  sim.world.mut(pupil, TrainingOrder).drillTicksLeft = 0; // the last repetition just completed
  sim.world.destroy(school);

  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  planTraining(
    sim.world,
    ctxOf(sim),
    terrain,
    pupil,
    sim.world.get(pupil, Settler),
    terrain.nodeAt(2, 2),
    null,
  );

  expect(sim.world.get(pupil, Settler).jobType).toBe(CARPENTER);
  expect(sim.world.get(pupil, Settler).learned?.job).toContain(CARPENTER);
  expect(sim.world.has(pupil, TrainingOrder)).toBe(false);
});
