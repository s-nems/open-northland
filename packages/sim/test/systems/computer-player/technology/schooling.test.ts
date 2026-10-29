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
  MILL_TYPE,
  MILLER,
  MILLER_GATE_XP,
  placeHq,
  SCHOOL_TYPE,
  SEAT,
  spawnMen,
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
