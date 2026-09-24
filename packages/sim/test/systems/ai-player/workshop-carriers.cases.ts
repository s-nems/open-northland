import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { CompletedCycles, JobAssignment, Settler } from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { BUILDER_CAP } from '../../../src/systems/ai-player/index.js';
import { CRAFT_OPENING_RUN_BY_BUILDING_ID } from '../../../src/systems/ai-player/workforce/craft.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BUILDER,
  CARRIER,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  placeHq,
  SEAT,
  spawnMen,
  VIKING,
} from './support.js';

/** The first potter's and mason's carrier: hired beside the level-1 workshop, handed back once it is
 *  upgraded, and at the pottery replaced by a second potter only after the opening run. */

const POTTER = 12;
const MASON = 13;
const BRICK = 50;
const TILE = 51;
const CROCKERY = 52;
const PILLAR = 53;
const ORNAMENT = 54;
const POTTERY = 50;
const POTTERY_UPGRADED = 51;
const MASON_HUT = 52;
const MASON_HUT_UPGRADED = 53;
/** Enough men that the pool still has a spare hand after the builder reserve and every early post. */
const SPARE_MEN = 20;

function workshop(
  typeId: number,
  id: string,
  craft: number,
  crafters: number,
  outputs: readonly number[],
  upgradeTarget?: number,
) {
  return {
    typeId,
    id,
    kind: 'workplace' as const,
    workers: [
      { jobType: craft, count: crafters },
      { jobType: CARRIER, count: 1 },
    ],
    recipes: outputs.map((goodType) => ({ inputs: [], outputs: [{ goodType, amount: 1 }] })),
    stock: outputs.map((goodType) => ({ goodType, capacity: 10 })),
    construction: [{ goodType: 1, amount: 1 }],
    ...(upgradeTarget === undefined ? {} : { upgradeTarget }),
  };
}

function workshopsContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      ...(
        [
          [BRICK, 'brick'],
          [TILE, 'tile'],
          [CROCKERY, 'crockery'],
          [PILLAR, 'pillar'],
          [ORNAMENT, 'ornament'],
        ] as const
      ).map(([typeId, id]) => ({ typeId, id })),
    ],
    jobs: [...base.jobs, { typeId: POTTER, id: 'potter' }, { typeId: MASON, id: 'mason' }],
    buildings: [
      ...base.buildings,
      workshop(POTTERY, 'work_pottery_00', POTTER, 1, [BRICK], POTTERY_UPGRADED),
      workshop(POTTERY_UPGRADED, 'work_pottery_01', POTTER, 2, [BRICK, TILE, CROCKERY]),
      workshop(MASON_HUT, 'work_mason_hut_00', MASON, 1, [PILLAR], MASON_HUT_UPGRADED),
      workshop(MASON_HUT_UPGRADED, 'work_mason_hut_01', MASON, 2, [PILLAR, ORNAMENT]),
    ],
  });
}

interface Seat {
  readonly sim: Simulation;
  decide(): Command[];
  apply(commands: readonly Command[]): void;
  crew(building: Entity, job: number): Entity[];
}

function workshopSeat(men = BUILDER_CAP + SPARE_MEN): Seat {
  const content = workshopsContent();
  const sim = aiSim(1, content);
  placeHq(sim);
  for (const [buildingType, x] of [
    [POTTERY, 40],
    [MASON_HUT, 50],
  ] as const) {
    sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y: 16, tribe: VIKING, owner: SEAT });
  }
  spawnMen(sim, men, BUILDER);
  sim.step();
  return {
    sim,
    decide: () => [...collectModule.run(sim.world, { ...ctxOf(sim), content }, SEAT)],
    apply(commands) {
      for (const c of commands) sim.enqueueSetup(c);
      sim.step();
    },
    crew: (building, job) =>
      [...sim.world.query(Settler, JobAssignment)].filter(
        (e) =>
          sim.world.get(e, JobAssignment).workplace === building && sim.world.get(e, Settler).jobType === job,
      ),
  };
}

describe('workforce module - the first workshops carriers', () => {
  it('hires a carrier beside the first potter and mason, and hands both back after the upgrades', () => {
    const seat = workshopSeat();
    seat.apply(seat.decide());
    const pottery = entityOfBuilding(seat.sim, POTTERY);
    const hut = entityOfBuilding(seat.sim, MASON_HUT);
    for (const [building, craft] of [
      [pottery, POTTER],
      [hut, MASON],
    ] as const) {
      expect(seat.crew(building, craft)).toHaveLength(1);
      expect(seat.crew(building, CARRIER)).toHaveLength(1);
    }
    const carriers = [...seat.crew(pottery, CARRIER), ...seat.crew(hut, CARRIER)];

    seat.apply([
      { kind: 'upgradeBuilding', building: pottery },
      { kind: 'upgradeBuilding', building: hut },
    ]);
    completeSites(seat.sim);
    const released = seat.decide().filter((c) => c.kind === 'setJob' && carriers.includes(c.entity));
    expect(released).toEqual(carriers.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })));
  });

  it('adds the second potter once the opening run is done, ahead of the builder reserve', () => {
    // No man beyond the builder reserve, so only a minimum post can still claim one.
    const seat = workshopSeat(BUILDER_CAP);
    seat.apply(seat.decide());
    const pottery = entityOfBuilding(seat.sim, POTTERY);
    seat.apply([{ kind: 'upgradeBuilding', building: pottery }]);
    completeSites(seat.sim);

    const potterHires = () =>
      seat
        .decide()
        .filter((c) => c.kind === 'assignWorker' && c.building === pottery && c.jobPriority.includes(POTTER));
    // The same decision with only the run's tally changed, so the pool that hires below is there now too.
    expect(potterHires()).toEqual([]);
    const cycles = CRAFT_OPENING_RUN_BY_BUILDING_ID.work_pottery_01?.cycles ?? 0;
    seat.sim.world.add(pottery, CompletedCycles, { byGood: new Map([[TILE, cycles]]) });
    expect(potterHires()).toHaveLength(1);
  });
});
