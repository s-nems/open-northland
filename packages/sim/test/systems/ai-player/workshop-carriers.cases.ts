import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CompletedCycles,
  CraftSelection,
  JobAssignment,
  Settler,
  setStockAmount,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import { BUILDER_CAP, FLAG_MAX_DISTANCE_NODES } from '../../../src/systems/ai-player/index.js';
import { anchorNodeOf } from '../../../src/systems/ai-player/node-geometry.js';
import { collectorAnchors, seatHolders } from '../../../src/systems/ai-player/workforce/collectors/anchor.js';
import { FLAG_RELOCATE_EVERY_DECISIONS } from '../../../src/systems/ai-player/workforce/collectors/index.js';
import {
  CRAFT_OPENING_RUN_BY_BUILDING_ID,
  LATE_CRAFT_FROM_TICK,
  tuneCraftSelections,
} from '../../../src/systems/ai-player/workforce/craft.js';
import { claimFlagNode, flagSpotNear } from '../../../src/systems/ai-player/workforce/flag-spots.js';
import {
  SUPPLY_COMFORT_UNITS,
  SUPPLY_SHORT_UNITS,
} from '../../../src/systems/ai-player/workforce/staffing-plan.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BUILDER,
  CARRIER,
  COLLECTOR,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  HQ_TYPE,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STONE,
  spawnMen,
  VIKING,
} from './support.js';

/** The pottery's and mason hut's crews: the first craftsman's carrier, the supply carrier an upgraded
 *  workshop keeps while its goods run short, the second potter after the opening run, and the potters'
 *  product split. */

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
  /** Put `units` of each good into the headquarters. */
  stock(goods: readonly number[], units: number): void;
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
    stock(goods, units) {
      for (const good of goods) setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), good, units);
    },
  };
}

/** A seat whose pottery and mason hut are both upgraded, their first carriers still at their posts. */
function upgradedSeat(men?: number): Seat & { readonly pottery: Entity; readonly hut: Entity } {
  const seat = workshopSeat(men);
  seat.apply(seat.decide());
  const pottery = entityOfBuilding(seat.sim, POTTERY);
  const hut = entityOfBuilding(seat.sim, MASON_HUT);
  seat.apply([
    { kind: 'upgradeBuilding', building: pottery },
    { kind: 'upgradeBuilding', building: hut },
  ]);
  completeSites(seat.sim);
  return { ...seat, pottery, hut };
}

/** The pottery's and the mason hut's supply goods. */
const SUPPLY_GOODS = [BRICK, TILE, PILLAR, ORNAMENT];

describe('workforce module - the pottery and mason hut crews', () => {
  it('hires a carrier beside the first potter and mason, and keeps him after the upgrade until supplies are plentiful', () => {
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
    const released = () => seat.decide().filter((c) => c.kind === 'setJob' && carriers.includes(c.entity));
    // The upgrade spent the stock, so both carriers stay on.
    expect(released()).toEqual([]);
    seat.stock(SUPPLY_GOODS, SUPPLY_COMFORT_UNITS);
    expect(released()).toEqual(carriers.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })));
  });

  it('puts a carrier back into an upgraded workshop while its goods run short', () => {
    const seat = upgradedSeat();
    seat.stock(SUPPLY_GOODS, SUPPLY_COMFORT_UNITS);
    seat.apply(seat.decide());
    expect(seat.crew(seat.pottery, CARRIER)).toEqual([]);
    const carrierHires = () =>
      seat
        .decide()
        .filter(
          (c) => c.kind === 'assignWorker' && c.building === seat.pottery && c.jobPriority.includes(CARRIER),
        );

    // Between short and comfortable: nobody is hired.
    seat.stock([TILE], SUPPLY_SHORT_UNITS);
    expect(carrierHires()).toEqual([]);
    seat.stock([TILE], SUPPLY_SHORT_UNITS - 1);
    expect(carrierHires()).toHaveLength(1);
    seat.apply(seat.decide());
    const [carrier] = seat.crew(seat.pottery, CARRIER);
    if (carrier === undefined) throw new Error('expected the supply carrier');

    // Once hired he stays through the same band, and leaves only when the tiles are plentiful again.
    seat.stock([TILE], SUPPLY_COMFORT_UNITS - 1);
    expect(seat.decide().filter((c) => c.kind === 'setJob' && c.entity === carrier)).toEqual([]);
    seat.stock([TILE], SUPPLY_COMFORT_UNITS);
    expect(seat.decide().filter((c) => c.kind === 'setJob' && c.entity === carrier)).toEqual([
      { kind: 'setJob', entity: carrier, jobType: BUILDER },
    ]);
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

  it('splits the potters between bricks and tiles, and adds the crockery to both only late', () => {
    const seat = upgradedSeat();
    const cycles = CRAFT_OPENING_RUN_BY_BUILDING_ID.work_pottery_01?.cycles ?? 0;
    seat.sim.world.add(seat.pottery, CompletedCycles, { byGood: new Map([[TILE, cycles]]) });
    const content = workshopsContent();
    // The potters' live selections, in id order, once the decision at `tick` has applied.
    const selections = (tick: number) => {
      seat.apply(tuneCraftSelections(seat.sim.world, { ...ctxOf(seat.sim, tick), content }, SEAT));
      return seat
        .crew(seat.pottery, POTTER)
        .sort((a, b) => a - b)
        .map((e) => seat.sim.world.tryGet(e, CraftSelection)?.goods);
    };

    // A lone potter keeps both building materials going.
    expect(selections(0)).toEqual([[BRICK, TILE]]);
    const second = [...seat.sim.world.query(Settler)].find(
      (e) => seat.sim.world.get(e, Settler).jobType === BUILDER && !seat.sim.world.has(e, JobAssignment),
    );
    if (second === undefined) throw new Error('expected a spare man');
    seat.apply([{ kind: 'assignWorker', entity: second, building: seat.pottery, jobPriority: [POTTER] }]);
    expect(selections(0)).toEqual([[BRICK], [TILE]]);
    expect(selections(LATE_CRAFT_FROM_TICK)).toEqual([
      [BRICK, CROCKERY],
      [TILE, CROCKERY],
    ]);
  });
});

describe('workforce module - the clay gatherer serves the pottery', () => {
  /** A clay deposit nearest the base and another nearest the pottery, which stands off to the east. */
  const BASE_CLAY = { ...RESOURCE_SPOTS.mud, x: 22, y: 16 };
  const POTTERY_CLAY = { ...RESOURCE_SPOTS.mud, x: 56, y: 20 };
  const POTTERY_AT = { x: 52, y: 8 };
  // Clay is the only good with a live resource here, so the one flag the decision plants is the clay one.
  const clayFlag = (commands: readonly Command[]) => commands.find((c) => c.kind === 'setWorkFlag');

  it('posts the clay flag beside the base first, then moves it to the deposit nearest the pottery', () => {
    const content = workshopsContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    placeResources(sim, [BASE_CLAY, POTTERY_CLAY]);
    spawnMen(sim, 1, BUILDER);
    sim.step();
    const run = (tick: number) => [...collectModule.run(sim.world, { ...ctxOf(sim, tick), content }, SEAT)];
    const near = (flag: Command | undefined, spot: { x: number; y: number }) =>
      flag?.kind === 'setWorkFlag' &&
      Math.abs(flag.x - spot.x) + Math.abs(flag.y - spot.y) <= FLAG_MAX_DISTANCE_NODES;

    const hire = run(0);
    expect(near(clayFlag(hire), BASE_CLAY)).toBe(true);
    for (const c of hire) sim.enqueueSetup(c);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: POTTERY,
      ...POTTERY_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();

    // An ordinary decision leaves the working flag be; the periodic upkeep moves it to the pottery's clay.
    expect(run(AI_DECISION_INTERVAL_TICKS).filter((c) => c.kind === 'setWorkFlag')).toEqual([]);
    const upkeep = run(AI_DECISION_INTERVAL_TICKS * FLAG_RELOCATE_EVERY_DECISIONS);
    expect(near(clayFlag(upkeep), POTTERY_CLAY)).toBe(true);
  });
});

describe('workforce module - stone gatherers keep the anchor their flag serves', () => {
  const HUT_AT = { x: 56, y: 8 };
  const BASE_STONE = { ...RESOURCE_SPOTS.stone, x: 22, y: 16 };
  const HUT_STONE = { ...RESOURCE_SPOTS.stone, x: 58, y: 20 };

  it('serves the mason hut with the first stone post and the base with the second, whatever the ids', () => {
    const content = workshopsContent();
    const sim = aiSim(1, content);
    placeHq(sim);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: MASON_HUT,
      ...HUT_AT,
      tribe: VIKING,
      owner: SEAT,
    });
    placeResources(sim, [BASE_STONE, HUT_STONE]);
    spawnMen(sim, 2, COLLECTOR);
    sim.step();
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: a map');
    const ctx = { ...ctxOf(sim), content };
    const [low, high] = [...sim.world.query(Settler)]
      .filter((e) => sim.world.get(e, Settler).jobType === COLLECTOR)
      .sort((a, b) => a - b);
    if (low === undefined || high === undefined) throw new Error('setup: two gatherers');
    // The lower id works the base's stone, the higher one the hut's: the reverse of their rank order.
    const taken = new Set<string>();
    for (const [man, stone] of [
      [low, BASE_STONE],
      [high, HUT_STONE],
    ] as const) {
      const spot = flagSpotNear(sim.world, ctx, terrain, { hx: stone.x, hy: stone.y }, taken);
      if (spot === null) throw new Error('setup: a flag spot');
      claimFlagNode(taken, spot);
      sim.enqueueSetup({ kind: 'setWorkFlag', entity: man, x: spot.hx, y: spot.hy });
      sim.enqueueSetup({ kind: 'setGatherGood', entity: man, goodType: STONE });
    }
    sim.step();

    const hq = anchorNodeOf(sim.world, entityOfBuilding(sim, HQ_TYPE));
    const hut = anchorNodeOf(sim.world, entityOfBuilding(sim, MASON_HUT));
    if (hq === null || hut === null) throw new Error('setup: anchors');
    const slots = collectorAnchors(sim.world, ctx, [...sim.world.query(Building)], hq).slotsOf('stone', 2);
    expect(slots).toEqual([hut, hq]);
    expect(seatHolders(sim.world, [low, high], slots, hq).anchors).toEqual([hq, hut]);
    // So the periodic upkeep moves neither flag.
    const upkeep = [
      ...collectModule.run(
        sim.world,
        { ...ctxOf(sim, AI_DECISION_INTERVAL_TICKS * FLAG_RELOCATE_EVERY_DECISIONS), content },
        SEAT,
      ),
    ];
    expect(upkeep.filter((c) => c.kind === 'setWorkFlag' && (c.entity === low || c.entity === high))).toEqual(
      [],
    );
  });
});
