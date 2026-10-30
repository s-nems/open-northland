import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  noteSettlerProgress,
  Settler,
  SettlerProgress,
  TrainingOrder,
} from '../../../../src/components/index.js';
import type { PlayerCommand } from '../../../../src/core/commands/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import type { Simulation } from '../../../../src/index.js';
import { ownedBuildings } from '../../../../src/systems/ai-shared/seat-roster.js';
import { Schooling } from '../../../../src/systems/computer-player/technology/schooling.js';
import {
  aiSim,
  CIVILIST,
  collectModule,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  FARMER_TRACK,
  HQ_X,
  HQ_Y,
  JOINER,
  JOINERY_TYPE,
  MILL_TYPE,
  MILLER,
  MILLER_GATE_XP,
  placeHq,
  SCHOOL_TYPE,
  SEAT,
  spawnMen,
  TOOL_IRON,
  technologyContent,
  VIKING,
} from '../support.js';

/** {@link technologyContent} with a one-seat school, so a second pupil waits for the first. */
function smallSchoolContent(): ContentSet {
  const base = technologyContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) => (b.typeId === SCHOOL_TYPE ? { ...b, schoolSize: 1 } : b)),
  });
}

const content = smallSchoolContent();

/** A seat with a standing farm, two mills and a school, its farmer past the miller's gate, so the miller
 *  is discovered and the mills wait for millers. */
function seat(): { sim: Simulation; farmer: Entity; run: () => PlayerCommand[] } {
  const sim = aiSim(1, content);
  placeHq(sim);
  for (const [buildingType, dx, dy] of [
    [FARM_TYPE, 8, 6],
    [MILL_TYPE, -8, 6],
    [MILL_TYPE, -8, -6],
    [SCHOOL_TYPE, 8, -6],
  ] as const)
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      x: HQ_X + dx,
      y: HQ_Y + dy,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
  spawnMen(sim, 12);
  sim.step();
  const farmer = [...sim.world.query(Settler)].find((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  if (farmer === undefined) throw new Error('setup: no spawned man');
  sim.enqueueSetup({
    kind: 'assignWorker',
    entity: farmer,
    building: entityOfBuilding(sim, FARM_TYPE),
    jobPriority: [FARMER],
  });
  sim.step();
  sim.world.mut(farmer, SettlerProgress).experience.set(FARMER_TRACK, MILLER_GATE_XP);
  noteSettlerProgress(sim.world, farmer);
  sim.step();
  const run = (): PlayerCommand[] => [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)];
  return { sim, farmer, run };
}

const lessons = (commands: readonly PlayerCommand[]): PlayerCommand[] =>
  commands.filter((c) => c.kind === 'learn');

describe('technology schooling', () => {
  it('sends a spare man to school for a discovered trade instead of promoting the working farmer', () => {
    const { sim, farmer, run } = seat();
    const first = run();
    const school = entityOfBuilding(sim, SCHOOL_TYPE);
    const sent = lessons(first);
    // One seat in the school: the second mill's miller waits for it.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'learn', house: school, target: 'job', typeId: MILLER });
    expect(sent[0]?.kind === 'learn' && sent[0].entity !== farmer).toBe(true);
    expect(first.some((c) => c.kind === 'assignWorker' && c.entity === farmer)).toBe(false);

    for (const c of sent) sim.enqueueSetup(c);
    sim.step();
    const pupil = sent[0]?.kind === 'learn' ? sent[0].entity : undefined;
    expect(pupil !== undefined && sim.world.get(pupil, TrainingOrder).lesson).toEqual({
      kind: 'job',
      typeId: MILLER,
    });
    // The pupil in his lesson stands for one mill's slot and holds the only seat: nobody else is sent,
    // and the farmer stays at the farm.
    const next = run();
    expect(lessons(next)).toEqual([]);
    expect(next.some((c) => c.kind === 'assignWorker' && c.entity === farmer)).toBe(false);
  });
});

/** The joiner's track and the iron tool gate on it in {@link methodContent}; one repeat is 100 raw XP. */
const JOINER_TRACK = 46;
const JOINER_TRACK_FACTOR = 100;
const IRON_TOOL_GATE_REPEATS = 10;
const TRAINING_TRACK = 77;
const WOODEN_TOOL = 6;

/** {@link technologyContent} where the joiner earns the iron tool at {@link IRON_TOOL_GATE_REPEATS} repeats
 *  and the school teaches it, as the shipped smith rows gate the long sword. */
function methodContent(): ContentSet {
  const base = technologyContent();
  return parseContentSet({
    ...base,
    jobExperience: [
      ...base.jobExperience,
      {
        typeId: JOINER_TRACK,
        id: 'joiner_general',
        jobType: JOINER,
        goodTypes: [],
        experienceFactor: JOINER_TRACK_FACTOR,
      },
    ],
    tribes: base.tribes.map((t) =>
      t.typeId !== VIKING
        ? t
        : {
            ...t,
            jobEnables: [
              ...t.jobEnables,
              { jobType: JOINER, kind: 'good', targetId: WOODEN_TOOL },
              { jobType: JOINER, kind: 'good', targetId: TOOL_IRON },
            ],
            jobRequirements: [
              ...t.jobRequirements,
              {
                requirement: 'need',
                target: 'good',
                targetId: TOOL_IRON,
                amount: IRON_TOOL_GATE_REPEATS,
                experienceTypes: [JOINER_TRACK],
              },
              {
                requirement: 'train',
                target: 'good',
                targetId: TOOL_IRON,
                amount: IRON_TOOL_GATE_REPEATS,
                experienceTypes: [TRAINING_TRACK],
              },
            ],
          },
    ),
  });
}

/** A seat with a joinery and a school: a fresh joiner listed on `goods` and, when `veteran`, a second
 *  joiner past the iron tool's gate, whose work discovers it for the seat. */
function joinerySeat(
  goods: readonly number[],
  veteran: boolean,
): { sim: Simulation; fresh: Entity; lessons: () => PlayerCommand[] } {
  const methods = methodContent();
  const sim = aiSim(1, methods);
  placeHq(sim);
  for (const [buildingType, dx, dy] of [
    [JOINERY_TYPE, -8, 6],
    [SCHOOL_TYPE, 8, -6],
  ] as const)
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      x: HQ_X + dx,
      y: HQ_Y + dy,
      tribe: VIKING,
      owner: SEAT,
      force: true,
    });
  spawnMen(sim, 2);
  sim.step();
  const men = [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === CIVILIST);
  const [fresh, old] = men;
  if (fresh === undefined || old === undefined) throw new Error('setup: two spawned men expected');
  const joinery = entityOfBuilding(sim, JOINERY_TYPE);
  for (const e of veteran ? [fresh, old] : [fresh])
    sim.enqueueSetup({ kind: 'assignWorker', entity: e, building: joinery, jobPriority: [JOINER] });
  sim.enqueueSetup({ kind: 'setProductionGoods', entity: fresh, goods });
  sim.step();
  if (veteran) {
    sim.world
      .mut(old, SettlerProgress)
      .experience.set(JOINER_TRACK, IRON_TOOL_GATE_REPEATS * JOINER_TRACK_FACTOR);
    noteSettlerProgress(sim.world, old);
    sim.step();
  }
  const lessons = (): PlayerCommand[] =>
    new Schooling(
      sim.world,
      { ...ctxOf(sim), content: methods },
      SEAT,
      ownedBuildings(sim.world, SEAT),
    ).teachMethods();
  return { sim, fresh, lessons };
}

describe('technology method lessons', () => {
  it('teaches a fresh operator the discovered product his list waits on instead of the grind', () => {
    const { sim, fresh, lessons } = joinerySeat([TOOL_IRON], true);
    const sent = lessons();
    expect(sent).toEqual([
      {
        kind: 'learn',
        entity: fresh,
        house: entityOfBuilding(sim, SCHOOL_TYPE),
        target: 'good',
        typeId: TOOL_IRON,
      },
    ]);
    for (const c of sent) sim.enqueueSetup(c);
    sim.step();
    expect(sim.world.get(fresh, TrainingOrder).lesson).toEqual({ kind: 'good', typeId: TOOL_IRON });
    // The pupil is not sent twice.
    expect(lessons()).toEqual([]);
  });

  it('sends nobody while a listed product is open to him or the good is undiscovered', () => {
    expect(joinerySeat([WOODEN_TOOL, TOOL_IRON], true).lessons()).toEqual([]);
    expect(joinerySeat([TOOL_IRON], false).lessons()).toEqual([]);
  });
});
