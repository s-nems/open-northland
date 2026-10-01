import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  discoverTechnology,
  GraduateWait,
  JobAssignment,
  Owner,
  Position,
  Settler,
  setNeedsEnabled,
  TrainingOrder,
} from '../../src/components/index.js';
import { playerCommand } from '../../src/core/commands/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation, type TerrainMap } from '../../src/index.js';
import { nodeOfPosition } from '../../src/nav/halfcell.js';
import { learn } from '../../src/systems/orders/education.js';
import { TRAINING_EXPERIENCE_TYPE } from '../../src/systems/progression/index.js';
import { planTraining } from '../../src/systems/settlers/drives/training.js';
import { IdleStands } from '../../src/systems/settlers/planner/idle-replan.js';
import { PlannerSpacing } from '../../src/systems/settlers/planner/spacing.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { hexNodeDistance } from '../../src/systems/spatial/metric.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap, waterColumnMap } from '../fixtures/terrain.js';

const SEAT = 0;
const TRIBE = 1;
const SCHOOL = 91;
const SAWMILL = 2; // the fixture workshop with one carpenter slot
const HEADQUARTERS = 1; // the fixture store with three collector slots
const COLLECTOR = 1;
const CARPENTER = 2;
const SCHOOL_AT = { x: 10, y: 10 };
const MAP_CELLS = 24;
/** The school yard's reach in half-cell steps, matching the planner's loiter yard. */
const YARD_RADIUS_NODES = 4;
/** Long enough for an idle graduate to walk back across the fixture map. */
const WALK_BACK_TICKS = 600;
/** A river column east of the school, cutting off the far bank. */
const RIVER_COLUMN = 13;

/** A world with a built school teaching `course`, discovered for the seat, and the seat's pupil of `jobType`. */
function school(
  jobType: number,
  course: number,
  map: TerrainMap = grassCellMap(MAP_CELLS, MAP_CELLS),
): { sim: Simulation; pupil: Entity; house: Entity } {
  const base = testContent();
  const content = parseContentSet({
    ...base,
    buildings: [...base.buildings, { typeId: SCHOOL, id: 'school', kind: 'training', schoolSize: 1 }],
    tribes: base.tribes.map((tribe) => ({
      ...tribe,
      jobRequirements: [
        {
          target: 'job',
          targetId: course,
          requirement: 'train',
          amount: 1,
          experienceTypes: [TRAINING_EXPERIENCE_TYPE],
        },
      ],
    })),
  });
  const sim = new Simulation({ seed: 7, content, map });
  setNeedsEnabled(sim.world, false); // keep the needs drives off the idle tail
  const pupil = settlerAt(sim, {
    jobType,
    tribe: TRIBE,
    position: { x: fx.fromInt(SCHOOL_AT.x), y: fx.fromInt(SCHOOL_AT.y + 1) },
  });
  sim.world.add(pupil, Owner, { player: SEAT });
  const house = building(sim, SCHOOL, SCHOOL_AT);
  discoverTechnology(sim.world, SEAT, TRIBE, 'job', course);
  return { sim, pupil, house };
}

function building(sim: Simulation, buildingType: number, at: { x: number; y: number }): Entity {
  const b = sim.world.create();
  sim.world.add(b, Building, { buildingType, tribe: TRIBE, built: ONE, level: 0 });
  sim.world.add(b, Position, { x: fx.fromInt(at.x), y: fx.fromInt(at.y) });
  sim.world.add(b, Owner, { player: SEAT });
  return b;
}

/** Serve the whole course and let the pupil's drill rung settle it, as it would leaving the school. */
function graduate(sim: Simulation, pupil: Entity, house: Entity, course: number): void {
  learn(sim.world, ctxOf(sim), { kind: 'learn', entity: pupil, house, target: 'job', typeId: course });
  expect(sim.world.has(pupil, TrainingOrder)).toBe(true);
  sim.world.mut(pupil, TrainingOrder).drillTicksLeft = 0;
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const p = sim.world.get(pupil, Position);
  const node = nodeOfPosition(p.x, p.y);
  planTraining(
    sim.world,
    ctxOf(sim),
    terrain,
    pupil,
    sim.world.get(pupil, Settler),
    terrain.nodeAtClamped(node.hx, node.hy),
    null,
    PlannerSpacing.forTick(sim.world, ctxOf(sim), terrain),
    new IdleStands(),
  );
}

function postGraduates(sim: Simulation, enabled: boolean): void {
  sim.enqueue(playerCommand(SEAT, { kind: 'setAssistantPostGraduates', player: SEAT, enabled }));
  sim.step();
}

/** Half-cell steps between `e` and the school's door. */
function stepsFromSchoolDoor(sim: Simulation, e: Entity, house: Entity): number {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('missing terrain');
  const p = sim.world.get(e, Position);
  const node = nodeOfPosition(p.x, p.y);
  const here = terrain.nodeAtClamped(node.hx, node.hy);
  return hexNodeDistance(terrain, here, interactionCell(sim.world, ctxOf(sim), terrain, house, here));
}

describe('school graduates', () => {
  it('waits by the school when the assistant does not post graduates', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    building(sim, SAWMILL, { x: 4, y: 4 });
    graduate(sim, pupil, house, CARPENTER);
    expect(sim.world.get(pupil, Settler).jobType).toBe(CARPENTER);
    expect(sim.world.has(pupil, JobAssignment)).toBe(false);
    expect(sim.world.get(pupil, GraduateWait).school).toBe(house);
  });

  it('walks back to the school yard once idle elsewhere', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    graduate(sim, pupil, house, CARPENTER);
    const away = sim.world.mut(pupil, Position);
    away.x = fx.fromInt(2);
    away.y = fx.fromInt(2);
    expect(stepsFromSchoolDoor(sim, pupil, house)).toBeGreaterThan(YARD_RADIUS_NODES);
    for (let i = 0; i < WALK_BACK_TICKS; i++) sim.step();
    expect(stepsFromSchoolDoor(sim, pupil, house)).toBeLessThanOrEqual(YARD_RADIUS_NODES);
    expect(sim.world.has(pupil, GraduateWait)).toBe(true);
  });

  it('stays where a move order sends it', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    graduate(sim, pupil, house, CARPENTER);
    sim.enqueue(playerCommand(SEAT, { kind: 'moveUnit', entity: pupil, x: 4, y: 4 }));
    sim.step();
    expect(sim.world.has(pupil, GraduateWait)).toBe(false);
  });

  it('stops waiting once the school is gone', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    graduate(sim, pupil, house, CARPENTER);
    sim.world.destroy(house);
    for (let i = 0; i < WALK_BACK_TICKS; i++) sim.step();
    expect(sim.world.has(pupil, GraduateWait)).toBe(false);
  });

  it('posts a graduate to the nearest workplace with a free slot in its trade', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    postGraduates(sim, true);
    const far = building(sim, SAWMILL, { x: 20, y: 20 });
    const staffed = building(sim, SAWMILL, { x: 12, y: 10 });
    const near = building(sim, SAWMILL, { x: 8, y: 12 });
    const worker = settlerAt(sim, { jobType: CARPENTER, tribe: TRIBE });
    sim.world.add(worker, Owner, { player: SEAT });
    sim.world.add(worker, JobAssignment, { workplace: staffed });
    graduate(sim, pupil, house, CARPENTER);
    expect(sim.world.get(pupil, JobAssignment).workplace).toBe(near);
    expect(sim.world.has(pupil, GraduateWait)).toBe(false);
    expect(sim.world.has(far, JobAssignment)).toBe(false);
  });

  it('skips a nearer workplace it cannot walk to', () => {
    const { sim, pupil, house } = school(
      COLLECTOR,
      CARPENTER,
      waterColumnMap(MAP_CELLS, MAP_CELLS, RIVER_COLUMN),
    );
    postGraduates(sim, true);
    building(sim, SAWMILL, { x: RIVER_COLUMN + 2, y: SCHOOL_AT.y });
    const landward = building(sim, SAWMILL, { x: 3, y: SCHOOL_AT.y });
    graduate(sim, pupil, house, CARPENTER);
    expect(sim.world.get(pupil, JobAssignment).workplace).toBe(landward);
  });

  it('stops waiting once the school is out of reach', () => {
    const { sim, pupil, house } = school(
      COLLECTOR,
      CARPENTER,
      waterColumnMap(MAP_CELLS, MAP_CELLS, RIVER_COLUMN),
    );
    graduate(sim, pupil, house, CARPENTER);
    const across = sim.world.mut(pupil, Position);
    across.x = fx.fromInt(RIVER_COLUMN + 4);
    for (let i = 0; i < WALK_BACK_TICKS; i++) sim.step();
    expect(sim.world.has(pupil, GraduateWait)).toBe(false);
  });

  it('leaves a graduate with no free slot waiting by the school', () => {
    const { sim, pupil, house } = school(COLLECTOR, CARPENTER);
    postGraduates(sim, true);
    graduate(sim, pupil, house, CARPENTER);
    expect(sim.world.has(pupil, JobAssignment)).toBe(false);
    expect(sim.world.get(pupil, GraduateWait).school).toBe(house);
  });

  it('never posts a collector', () => {
    const { sim, pupil, house } = school(CARPENTER, COLLECTOR);
    postGraduates(sim, true);
    building(sim, HEADQUARTERS, { x: 8, y: 12 });
    graduate(sim, pupil, house, COLLECTOR);
    expect(sim.world.get(pupil, Settler).jobType).toBe(COLLECTOR);
    expect(sim.world.has(pupil, JobAssignment)).toBe(false);
  });

  it('switches off again', () => {
    const { sim } = school(COLLECTOR, CARPENTER);
    postGraduates(sim, true);
    expect(sim.assistantPostsGraduates(SEAT)).toBe(true);
    postGraduates(sim, false);
    expect(sim.assistantPostsGraduates(SEAT)).toBe(false);
  });
});
