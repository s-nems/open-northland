import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  Carrying,
  CompletedCycles,
  CraftSelection,
  JobAssignment,
  removeCurrentAtomic,
  Settler,
  setStockAmount,
} from '../../../src/components/index.js';
import type { Command } from '../../../src/core/commands/index.js';
import { contentIndex } from '../../../src/core/content-index.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { AI_DECISION_INTERVAL_TICKS } from '../../../src/systems/ai-player/cadence.js';
import {
  CORE_CREW_FROM_TICKS,
  type GamePhase,
  HOARD_UNITS_BY_PHASE,
  LATE_GAME_FROM_TICKS,
  MID_GAME_FROM_TICKS,
  STORE_CARRIERS_FROM_TICKS,
} from '../../../src/systems/ai-player/game-phase.js';
import {
  BUILD_ORDER_LOOKAHEAD_ENTRIES,
  BUILDER_CAP,
  DEFAULT_BUILD_ORDER,
  FLAG_MAX_DISTANCE_NODES,
  MAX_ACTIVE_CONSTRUCTION_SITES,
  SeatSupply,
  type SupplyLines,
  supplyLines,
  workforceModule,
} from '../../../src/systems/ai-player/index.js';
import { anchorNodeOf } from '../../../src/systems/ai-player/node-geometry.js';
import { ownedBuildings } from '../../../src/systems/ai-player/seat-roster.js';
import { collectorAnchors, seatHolders } from '../../../src/systems/ai-player/workforce/collectors/anchor.js';
import { FLAG_RELOCATE_EVERY_DECISIONS } from '../../../src/systems/ai-player/workforce/collectors/index.js';
import {
  CRAFT_GLUT_BAND_UNITS,
  CRAFT_OPENING_RUN_BY_BUILDING_ID,
  CROCKERY_GLUT_UNITS,
  tuneCraftSelections,
} from '../../../src/systems/ai-player/workforce/craft.js';
import { claimFlagNode, flagSpotNear } from '../../../src/systems/ai-player/workforce/flag-spots.js';
import {
  type BuildingStaffing,
  buildingStaffing,
  type HeldStaff,
  plannedOperators,
  type SeatStaffing,
  STORE_CARRIERS,
} from '../../../src/systems/ai-player/workforce/staffing-plan.js';
import { EAT_ATOMIC_ID } from '../../../src/systems/settlers/atomics/start.js';
import { aiContent } from '../../fixtures/ai-content.js';
import {
  aiSim,
  BAKERY_TYPE,
  BUILDER,
  CARRIER,
  COLLECTOR,
  collectModule,
  completeSites,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  FARMER,
  HQ_TYPE,
  IRON,
  MILL_TYPE,
  MUD,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  STONE,
  spawnMen,
  VIKING,
  WOOD,
} from './support.js';

/** The pottery's and mason hut's crews: the first craftsman's carrier, the supply carrier an upgraded
 *  workshop keeps while its goods run short, the second potter while a product runs short or the crockery
 *  is wanted, the potters' product split with its glut sink, and a workshop resting while its products lie
 *  at glut early in the game. The farm's and mill's crews sized by the grain and flour they lack, the
 *  phase's gluts, and the stores' carriers late in the game. */

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
/** The top home's own bill lines of the materials, so each good's supply unit is its own number. */
const TOP_HOME_MATERIALS = [
  { goodType: STONE, amount: 4 },
  { goodType: BRICK, amount: 3 },
  { goodType: TILE, amount: 2 },
  { goodType: PILLAR, amount: 5 },
  { goodType: ORNAMENT, amount: 1 },
] as const;

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
      ...base.buildings.map((b) =>
        b.id === 'home_level_02' ? { ...b, construction: [...b.construction, ...TOP_HOME_MATERIALS] } : b,
      ),
      workshop(POTTERY, 'work_pottery_00', POTTER, 1, [BRICK], POTTERY_UPGRADED),
      workshop(POTTERY_UPGRADED, 'work_pottery_01', POTTER, 2, [BRICK, TILE, CROCKERY]),
      workshop(MASON_HUT, 'work_mason_hut_00', MASON, 1, [PILLAR], MASON_HUT_UPGRADED),
      workshop(MASON_HUT_UPGRADED, 'work_mason_hut_01', MASON, 2, [PILLAR, ORNAMENT]),
    ],
  });
}

interface Seat {
  readonly sim: Simulation;
  /** One decision at `tick`, the game's start by default. */
  decide(tick?: number): Command[];
  apply(commands: readonly Command[]): void;
  crew(building: Entity, job: number): Entity[];
  /** Put `units` of each good into the headquarters. */
  stock(goods: readonly number[], units: number): void;
}

/** A seat over `content` with the HQ, `men` builders and a building of each of `buildingTypes`, placed
 *  side by side along one row. */
function seatOn(content: ContentSet, buildingTypes: readonly number[], men: number): Seat {
  const sim = aiSim(1, content);
  placeHq(sim);
  for (const [i, buildingType] of buildingTypes.entries()) {
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType,
      x: FIRST_BUILDING_X + i * BUILDING_SPACING,
      y: 16,
      tribe: VIKING,
      owner: SEAT,
    });
  }
  spawnMen(sim, men, BUILDER);
  sim.step();
  return {
    sim,
    decide: (tick = 0) => [...collectModule.run(sim.world, { ...ctxOf(sim, tick), content }, SEAT)],
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

const FIRST_BUILDING_X = 40;
const BUILDING_SPACING = 10;

function workshopSeat(men = BUILDER_CAP + SPARE_MEN): Seat {
  const content = workshopsContent();
  const seat = seatOn(content, [POTTERY, MASON_HUT], men);
  // The clay and stone the two workshops eat: plentiful, so their carriers are hired at all.
  for (const good of RAW_GOODS) seat.stock([good], linesOf(content, good).comfort);
  return seat;
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

/** The default build order's supply lines of `good` over `content`. */
function linesOf(content: ContentSet, good: number): SupplyLines {
  const lines = supplyLines(content, DEFAULT_BUILD_ORDER).get(good);
  if (lines === undefined) throw new Error(`good ${good} is not managed`);
  return lines;
}

/** Stock every good at its own line. */
function stockAtLine(
  seat: Seat,
  goods: readonly number[],
  line: 'short' | 'comfort' | 'glut',
  offset = 0,
): void {
  const content = workshopsContent();
  for (const good of goods) seat.stock([good], linesOf(content, good)[line] + offset);
}

/** Mark `building`'s opening run done, as if its crew had finished every cycle of `good`. */
function finishRun(seat: Seat, building: Entity, buildingId: string, good: number): void {
  const cycles = CRAFT_OPENING_RUN_BY_BUILDING_ID[buildingId]?.cycles ?? 0;
  const done = seat.sim.world.tryMut(building, CompletedCycles);
  if (done === undefined)
    seat.sim.world.add(building, CompletedCycles, { byGood: new Map([[good, cycles]]) });
  else done.byGood.set(good, cycles);
}

/** Post a spare man at `building` as a `job`. */
function hireSpare(seat: Seat, building: Entity, job: number): void {
  const spare = [...seat.sim.world.query(Settler)].find(
    (e) => seat.sim.world.get(e, Settler).jobType === BUILDER && !seat.sim.world.has(e, JobAssignment),
  );
  if (spare === undefined) throw new Error('expected a spare man');
  seat.apply([{ kind: 'assignWorker', entity: spare, building, jobPriority: [job] }]);
}

/** The `job` crew's live selections at `building` in id order, once one decision's tuning has applied. */
function selections(seat: Seat, building: Entity, job: number): (readonly number[] | undefined)[] {
  const { world } = seat.sim;
  const ctx = { ...ctxOf(seat.sim), content: workshopsContent() };
  const supply = SeatSupply.of(world, ctx, SEAT, ownedBuildings(world, SEAT), DEFAULT_BUILD_ORDER);
  seat.apply(tuneCraftSelections(world, ctx, SEAT, supply));
  return seat
    .crew(building, job)
    .sort((a, b) => a - b)
    .map((e) => world.tryGet(e, CraftSelection)?.goods);
}

describe('workforce module - the supply lines', () => {
  it("derives each good's lines from the build order's largest bill line and the consumers' shelves", () => {
    const content = workshopsContent();
    // The top home's merged chain bill: two wood per tier over three tiers, plus its own materials.
    const HOME_CHAIN_WOOD = 6;
    const lines = (unit: number, band: number) => {
      const short = MAX_ACTIVE_CONSTRUCTION_SITES * unit;
      return {
        unit,
        short,
        comfort: short + band,
        glut: short + band + BUILD_ORDER_LOOKAHEAD_ENTRIES * unit,
      };
    };
    for (const { goodType, amount } of TOP_HOME_MATERIALS) {
      expect(linesOf(content, goodType)).toEqual(lines(amount, amount));
    }
    expect(linesOf(content, WOOD)).toEqual(lines(HOME_CHAIN_WOOD, HOME_CHAIN_WOOD));
    // Clay no bill takes and no workshop shelves: one unit.
    expect(linesOf(content, MUD)).toEqual(lines(1, 1));
    // Iron no bill takes: the joinery's input shelf is its unit and its band.
    const JOINERY_IRON_SHELF = 5;
    expect(linesOf(content, IRON)).toEqual(lines(JOINERY_IRON_SHELF, JOINERY_IRON_SHELF));
    // A shelf wider than the unit widens only the band.
    const WIDE_SHELF = 20;
    const wide = parseContentSet({
      ...content,
      buildings: content.buildings.map((b) =>
        b.id === 'work_joinery_01'
          ? {
              ...b,
              stock: b.stock.map((slot) =>
                slot.goodType === WOOD ? { ...slot, capacity: WIDE_SHELF } : slot,
              ),
            }
          : b,
      ),
    });
    expect(linesOf(wide, WOOD)).toEqual(lines(HOME_CHAIN_WOOD, WIDE_SHELF));
    expect(supplyLines(content, DEFAULT_BUILD_ORDER).has(CROCKERY)).toBe(false);
  });

  it('lays the glut line further out every game phase, but not for a stocked product', () => {
    const content = grainContent();
    const wood = linesOf(content, WOOD);
    for (const phase of ['opening', 'mid', 'late'] as const satisfies readonly GamePhase[]) {
      const lines = supplyLines(content, DEFAULT_BUILD_ORDER, phase);
      expect(lines.get(WOOD)).toEqual({
        ...wood,
        glut: wood.comfort + BUILD_ORDER_LOOKAHEAD_ENTRIES * wood.unit * HOARD_UNITS_BY_PHASE[phase],
      });
      // The mill's and bakery's shelves size the grain and flour, not the sites.
      for (const good of [WHEAT, FLOUR]) expect(lines.get(good)).toEqual(linesOf(content, good));
    }
    // A decision reads its own phase's lines.
    const seat = seatOn(content, [], 1);
    const ctx = { ...ctxOf(seat.sim, MID_GAME_FROM_TICKS), content };
    const supply = SeatSupply.of(seat.sim.world, ctx, SEAT, [], DEFAULT_BUILD_ORDER);
    expect(supply.lines(WOOD)).toEqual(supplyLines(content, DEFAULT_BUILD_ORDER, 'mid').get(WOOD));
  });
});
/** The raw goods the two workshops eat, and the builders need too. */
const RAW_GOODS = [MUD, STONE];

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
      // A target-tier post: the builder reserve comes first.
      expect(planOf(seat, workshopsContent(), building, alone)).toMatchObject({
        carrierMin: 0,
        carrierTarget: 1,
      });
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
    stockAtLine(seat, SUPPLY_GOODS, 'comfort');
    expect(released()).toEqual(carriers.map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })));
  });

  it('puts a carrier back into an upgraded workshop while its goods run short', () => {
    const seat = upgradedSeat();
    stockAtLine(seat, SUPPLY_GOODS, 'comfort');
    seat.apply(seat.decide());
    expect(seat.crew(seat.pottery, CARRIER)).toEqual([]);
    const carrierHires = () =>
      seat
        .decide()
        .filter(
          (c) => c.kind === 'assignWorker' && c.building === seat.pottery && c.jobPriority.includes(CARRIER),
        );

    // Between short and comfortable: nobody is hired.
    stockAtLine(seat, [TILE], 'short');
    expect(carrierHires()).toEqual([]);
    stockAtLine(seat, [TILE], 'short', -1);
    expect(carrierHires()).toHaveLength(1);
    seat.apply(seat.decide());
    const [carrier] = seat.crew(seat.pottery, CARRIER);
    if (carrier === undefined) throw new Error('expected the supply carrier');

    // Once hired he stays through the same band, and leaves only when the tiles are plentiful again.
    stockAtLine(seat, [TILE], 'comfort', -1);
    expect(seat.decide().filter((c) => c.kind === 'setJob' && c.entity === carrier)).toEqual([]);
    stockAtLine(seat, [TILE], 'comfort');
    expect(seat.decide().filter((c) => c.kind === 'setJob' && c.entity === carrier)).toEqual([
      { kind: 'setJob', entity: carrier, jobType: BUILDER },
    ]);
  });

  it('runs a carrier at the upgraded pottery from the late game on, whatever lies in store', () => {
    const seat = upgradedSeat();
    finishRun(seat, seat.pottery, 'work_pottery_01', TILE);
    const content = workshopsContent();
    stockAtLine(seat, SUPPLY_GOODS, 'comfort');
    const carriers = (tick: number) => {
      const plan = planOf(seat, content, seat.pottery, alone, tick);
      return { min: plan.carrierMin, target: plan.carrierTarget };
    };
    expect(carriers(LATE_GAME_FROM_TICKS - 1)).toEqual({ min: 0, target: 0 });
    expect(carriers(LATE_GAME_FROM_TICKS)).toEqual({ min: 0, target: 1 });
  });

  it("lets the mason's carrier go while the sites' stone runs short, and hires him back once it is plentiful", () => {
    const seat = workshopSeat();
    seat.apply(seat.decide());
    const hut = entityOfBuilding(seat.sim, MASON_HUT);
    const [carrier] = seat.crew(hut, CARRIER);
    if (carrier === undefined) throw new Error('expected the mason hut carrier');
    const released = () => seat.decide().filter((c) => c.kind === 'setJob' && c.entity === carrier);
    const carrierHires = () =>
      seat
        .decide()
        .filter((c) => c.kind === 'assignWorker' && c.building === hut && c.jobPriority.includes(CARRIER));

    // He stays down to the short line, and goes back to the pool under it: the stone he hauls onto the
    // hut's shelf is the mason's, and the builders have none.
    stockAtLine(seat, [STONE], 'short');
    expect(released()).toEqual([]);
    stockAtLine(seat, [STONE], 'short', -1);
    expect(released()).toEqual([{ kind: 'setJob', entity: carrier, jobType: BUILDER }]);
    seat.apply(released());
    expect(seat.crew(hut, CARRIER)).toEqual([]);

    // The hut runs on the mason alone until the stone is plentiful again; the pottery's carrier, whose
    // clay is untouched, keeps his post throughout.
    stockAtLine(seat, [STONE], 'comfort', -1);
    expect(carrierHires()).toEqual([]);
    stockAtLine(seat, [STONE], 'comfort');
    expect(carrierHires()).toHaveLength(1);
    expect(seat.crew(entityOfBuilding(seat.sim, POTTERY), CARRIER)).toHaveLength(1);
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

  it('puts a lone potter on bricks and tiles and a second on crockery, which a short material takes', () => {
    const seat = upgradedSeat();
    finishRun(seat, seat.pottery, 'work_pottery_01', TILE);
    stockAtLine(seat, [BRICK, TILE], 'comfort');
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE]]);
    hireSpare(seat, seat.pottery, POTTER);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [CROCKERY]]);

    // At the short line nothing moves; under it the crockery seat, whose good has no lines, turns to tiles.
    stockAtLine(seat, [TILE], 'short');
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [CROCKERY]]);
    stockAtLine(seat, [TILE], 'short', -1);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [TILE]]);
    // It stays on tiles through the band and goes back to crockery at the comfort line.
    stockAtLine(seat, [TILE], 'comfort', -1);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [TILE]]);
    stockAtLine(seat, [TILE], 'comfort');
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [CROCKERY]]);
    // Crockery piled up to its glut: the second potter works the building materials too.
    seat.stock([CROCKERY], CROCKERY_GLUT_UNITS);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([
      [BRICK, TILE],
      [BRICK, TILE],
    ]);
  });

  it('turns the potters to crockery once bricks and tiles both lie at glut, and back once one falls under comfort', () => {
    const seat = upgradedSeat();
    finishRun(seat, seat.pottery, 'work_pottery_01', TILE);
    hireSpare(seat, seat.pottery, POTTER);
    stockAtLine(seat, [BRICK], 'glut');
    stockAtLine(seat, [TILE], 'glut', -1);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [CROCKERY]]);
    stockAtLine(seat, [TILE], 'glut');
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[CROCKERY], [CROCKERY]]);
    // Down to the comfort line they stay on crockery; under it both go back to their seats.
    stockAtLine(seat, [BRICK], 'comfort');
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[CROCKERY], [CROCKERY]]);
    stockAtLine(seat, [BRICK], 'comfort', -1);
    expect(selections(seat, seat.pottery, POTTER)).toEqual([[BRICK, TILE], [CROCKERY]]);
  });

  it('staffs the second potter while a material runs short, holds him to its glut, and keeps him for crockery', () => {
    const seat = upgradedSeat();
    finishRun(seat, seat.pottery, 'work_pottery_01', TILE);
    const content = workshopsContent();
    const tiers = (held: HeldStaff) => operatorTiers(seat, content, seat.pottery, held);
    stockAtLine(seat, SUPPLY_GOODS, 'comfort');
    // Bricks and tiles at comfort: the minimum and target tiers keep to the first potter, and the surplus
    // tier adds the crockery maker.
    expect(tiers(alone)).toEqual({ min: 1, target: 1, surplus: 2 });
    // Under the comfort line the second potter is a minimum post, ahead of the builder reserve.
    stockAtLine(seat, [TILE], 'comfort', -1);
    expect(tiers(alone)).toEqual({ min: 2, target: 2, surplus: 2 });
    // The pair holds to the glut line, and there falls back to the surplus tier.
    stockAtLine(seat, [TILE], 'glut', -1);
    expect(tiers(crewOf(2))).toEqual({ min: 2, target: 2, surplus: 2 });
    stockAtLine(seat, [BRICK, TILE], 'glut');
    expect(tiers(crewOf(2))).toEqual({ min: 1, target: 1, surplus: 2 });
    // Crockery at its glut releases him; he comes back once it has fallen under it by the craft band.
    seat.stock([CROCKERY], CROCKERY_GLUT_UNITS);
    expect(tiers(crewOf(2))).toEqual({ min: 1, target: 1, surplus: 1 });
    seat.stock([CROCKERY], CROCKERY_GLUT_UNITS - 1);
    expect(tiers(crewOf(2))).toEqual({ min: 1, target: 1, surplus: 2 });
    expect(tiers(alone)).toEqual({ min: 1, target: 1, surplus: 1 });
    seat.stock([CROCKERY], CROCKERY_GLUT_UNITS - CRAFT_GLUT_BAND_UNITS - 1);
    expect(tiers(alone)).toEqual({ min: 1, target: 1, surplus: 2 });
  });
});

describe('workforce module - a workshop with nothing left to make', () => {
  it('lets the lone mason and his carrier go while the pillars lie at glut, and hires him back once they run short', () => {
    const seat = workshopSeat();
    seat.apply(seat.decide());
    const hut = entityOfBuilding(seat.sim, MASON_HUT);
    const [mason] = seat.crew(hut, MASON);
    const [carrier] = seat.crew(hut, CARRIER);
    if (mason === undefined || carrier === undefined) throw new Error('expected the mason hut crew');
    const released = () =>
      seat.decide().filter((c) => c.kind === 'setJob' && (c.entity === mason || c.entity === carrier));
    const masonHires = () =>
      seat
        .decide()
        .filter((c) => c.kind === 'assignWorker' && c.building === hut && c.jobPriority.includes(MASON));

    stockAtLine(seat, [PILLAR], 'glut', -1);
    expect(released()).toEqual([]);
    stockAtLine(seat, [PILLAR], 'glut');
    // Never mid-action or under a load: the trade change would cancel the one or drop the other.
    seat.sim.world.add(mason, Carrying, { goodType: STONE, amount: 1 });
    expect(released()).toEqual([{ kind: 'setJob', entity: carrier, jobType: BUILDER }]);
    seat.sim.world.remove(mason, Carrying);
    addCurrentAtomic(seat.sim.world, mason, {
      atomicId: EAT_ATOMIC_ID,
      duration: 50,
      effect: { kind: 'eat', goodType: STONE, from: null },
      targetEntity: mason,
      targetTile: null,
    });
    expect(released()).toEqual([{ kind: 'setJob', entity: carrier, jobType: BUILDER }]);
    removeCurrentAtomic(seat.sim.world, mason);
    expect(released()).toEqual([
      { kind: 'setJob', entity: carrier, jobType: BUILDER },
      { kind: 'setJob', entity: mason, jobType: BUILDER },
    ]);
    seat.apply(released());
    expect(seat.crew(hut, MASON)).toEqual([]);

    // The empty hut waits down to the short line, and takes a mason back under it.
    stockAtLine(seat, [PILLAR], 'short');
    expect(masonHires()).toEqual([]);
    stockAtLine(seat, [PILLAR], 'short', -1);
    expect(masonHires()).toHaveLength(1);
  });

  it('keeps the lone mason from the core-crew time on, whatever lies in store', () => {
    const seat = workshopSeat();
    seat.apply(seat.decide());
    const content = workshopsContent();
    const hut = entityOfBuilding(seat.sim, MASON_HUT);
    stockAtLine(seat, [PILLAR], 'glut');
    expect(planOf(seat, content, hut, alone)).toMatchObject({ operatorMin: 0, operatorTarget: 0 });
    for (const held of [alone, crewOf(0)]) {
      expect(planOf(seat, content, hut, held, CORE_CREW_FROM_TICKS)).toMatchObject({
        operatorMin: 1,
        operatorTarget: 1,
      });
    }
  });

  it('keeps a mason hut on its opening run whatever lies in store', () => {
    const seat = upgradedSeat();
    const [mason] = seat.crew(seat.hut, MASON);
    if (mason === undefined) throw new Error('expected the mason');
    const released = () => seat.decide().filter((c) => c.kind === 'setJob' && c.entity === mason);
    stockAtLine(seat, [PILLAR, ORNAMENT], 'glut');
    expect(released()).toEqual([]);
    finishRun(seat, seat.hut, 'work_mason_hut_01', ORNAMENT);
    expect(released()).toEqual([{ kind: 'setJob', entity: mason, jobType: BUILDER }]);
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
      const spot = flagSpotNear(
        sim.world,
        ctx,
        terrain,
        { hx: stone.x, hy: stone.y },
        { hx: stone.x, hy: stone.y },
        taken,
      );
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
    // So the periodic upkeep of a seat wanting both posts moves neither flag.
    const twoStonePosts = workforceModule([{ kind: 'collector', good: 'stone', count: 2 }]);
    const upkeep = [
      ...twoStonePosts.run(
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

const WHEAT = 60;
const FLOUR = 61;
const MILLER = 19;
/** The fixture's one food good, which stands in for the bakery's bread. */
const FOOD_SIMPLE = 3;
/** The mill's wheat shelf and the bakery's flour shelf, the consumers' shelves that size each good's unit. */
const INPUT_SHELF = 10;

/** The AI content with the grain chain: the farm grows wheat, the mill grinds it and the bakery bakes the
 *  flour. */
function grainContent(): ContentSet {
  const base = aiContent();
  const shelf = (goodType: number) => ({ goodType, capacity: INPUT_SHELF, initial: 0 });
  const recipe = (input: number, output: number) => ({
    inputs: [{ goodType: input, amount: 1 }],
    outputs: [{ goodType: output, amount: 1 }],
    ticks: 180,
  });
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      // Field-farmed, as the real wheat: the farm sows it.
      {
        typeId: WHEAT,
        id: 'wheat',
        weight: 1,
        atomics: { harvest: 29, cultivate: 35, plant: 34 },
        farming: { stages: 5, yieldPerField: 1, fieldRadius: 8, maxFields: 6 },
      },
      { typeId: FLOUR, id: 'flour', weight: 1 },
    ],
    buildings: base.buildings.map((b) => {
      if (b.typeId === FARM_TYPE) return { ...b, produces: [WHEAT] };
      if (b.typeId === MILL_TYPE)
        return { ...b, recipes: [recipe(WHEAT, FLOUR)], stock: [shelf(WHEAT), shelf(FLOUR)] };
      if (b.typeId === BAKERY_TYPE)
        return { ...b, recipes: [recipe(FLOUR, FOOD_SIMPLE)], stock: [shelf(FLOUR), ...b.stock] };
      return b;
    }),
  });
}

/** The operators a building's plan staffs per tier at `tick`, with `held` its live crew. */
function operatorTiers(seat: Seat, content: ContentSet, building: Entity, held: HeldStaff, tick = 0) {
  const plan = planOf(seat, content, building, held, tick);
  return {
    min: plan.operatorMin,
    target: plan.operatorTarget,
    surplus: plan.operatorSurplus ?? plan.operatorTarget,
  };
}

function planOf(
  seat: Seat,
  content: ContentSet,
  building: Entity,
  held: HeldStaff,
  tick = 0,
): BuildingStaffing {
  const { world } = seat.sim;
  const ctx = { ...ctxOf(seat.sim, tick), content };
  const owned = ownedBuildings(world, SEAT);
  const staffing: SeatStaffing = {
    player: SEAT,
    owned,
    supply: SeatSupply.of(world, ctx, SEAT, owned, DEFAULT_BUILD_ORDER),
  };
  const type = contentIndex(content).buildings.get(world.get(building, Building).buildingType);
  const plan = type === undefined ? null : buildingStaffing(world, ctx, staffing, building, type, held);
  if (plan === null) throw new Error('setup: a staffed building');
  return plan;
}

const alone = { operators: 1, carriers: 0 };
const crewOf = (operators: number): HeldStaff => ({ operators, carriers: 0 });

describe('workforce module - the farm and mill crews', () => {
  it("derives the grain's and flour's lines from the consumers' input shelves", () => {
    const content = grainContent();
    for (const good of [WHEAT, FLOUR]) {
      const short = MAX_ACTIVE_CONSTRUCTION_SITES * INPUT_SHELF;
      expect(linesOf(content, good)).toEqual({
        unit: INPUT_SHELF,
        short,
        comfort: short + INPUT_SHELF,
        glut: short + INPUT_SHELF + BUILD_ORDER_LOOKAHEAD_ENTRIES * INPUT_SHELF,
      });
    }
  });

  it('plans one farmer more per unit of grain lacking to comfort, the second at the target tier and the rest from surplus', () => {
    const content = grainContent();
    const seat = seatOn(content, [FARM_TYPE], BUILDER_CAP + SPARE_MEN);
    const farm = entityOfBuilding(seat.sim, FARM_TYPE);
    const { short, comfort } = linesOf(content, WHEAT);
    const tiers = (wheat: number) => {
      seat.stock([WHEAT], wheat);
      return operatorTiers(seat, content, farm, alone);
    };
    // Down to the comfort line a lone farmer keeps the grain up.
    expect(tiers(comfort)).toEqual({ min: 1, target: 1, surplus: 1 });
    // Under it, one more per unit lacking: the second at the target tier, the rest out of surplus.
    expect(tiers(comfort - 1)).toEqual({ min: 1, target: 2, surplus: 2 });
    expect(tiers(short - 1)).toEqual({ min: 1, target: 2, surplus: 3 });
    expect(tiers(0)).toEqual({ min: 1, target: 2, surplus: 4 });
  });

  it('holds an engaged farm crew to the glut line, one man over the hire line', () => {
    const content = grainContent();
    const seat = seatOn(content, [FARM_TYPE], BUILDER_CAP + SPARE_MEN);
    const farm = entityOfBuilding(seat.sim, FARM_TYPE);
    const { unit, comfort, glut } = linesOf(content, WHEAT);
    const tiers = (wheat: number, held: HeldStaff) => {
      seat.stock([WHEAT], wheat);
      return operatorTiers(seat, content, farm, held);
    };
    // A crew of two reads the glut line: from comfort up to it the pair stays.
    expect(tiers(comfort, crewOf(2))).toEqual({ min: 1, target: 2, surplus: 2 });
    expect(tiers(glut - 1, crewOf(2))).toEqual({ min: 1, target: 2, surplus: 2 });
    // Two are hired there, but a crew of three stays; four falls to three.
    expect(tiers(comfort, crewOf(3))).toEqual({ min: 1, target: 2, surplus: 3 });
    expect(tiers(comfort, crewOf(4))).toEqual({ min: 1, target: 2, surplus: 3 });
    // A unit and one lacking hires three and keeps four.
    expect(tiers(comfort - unit - 1, crewOf(4))).toEqual({ min: 1, target: 2, surplus: 4 });
    // The glut line takes any crew down to one.
    expect(tiers(glut, crewOf(3))).toEqual({ min: 1, target: 1, surplus: 1 });
  });

  it('keeps two farmers from the late game on, whatever the grain', () => {
    const content = grainContent();
    const seat = seatOn(content, [FARM_TYPE], BUILDER_CAP + SPARE_MEN);
    const farm = entityOfBuilding(seat.sim, FARM_TYPE);
    const { comfort, glut } = linesOf(content, WHEAT);
    seat.stock([WHEAT], glut);
    // Before the late game the glut takes the crew down to one; from it the second farmer stays, and a
    // shortage still sizes the crew above him.
    expect(operatorTiers(seat, content, farm, crewOf(2), LATE_GAME_FROM_TICKS - 1)).toEqual({
      min: 1,
      target: 1,
      surplus: 1,
    });
    expect(operatorTiers(seat, content, farm, crewOf(2), LATE_GAME_FROM_TICKS)).toEqual({
      min: 1,
      target: 2,
      surplus: 2,
    });
    seat.stock([WHEAT], 0);
    expect(operatorTiers(seat, content, farm, alone, LATE_GAME_FROM_TICKS)).toEqual({
      min: 1,
      target: 2,
      surplus: 4,
    });
    seat.stock([WHEAT], comfort - 1);
    expect(operatorTiers(seat, content, farm, alone, LATE_GAME_FROM_TICKS)).toEqual({
      min: 1,
      target: 2,
      surplus: 2,
    });
  });

  it('never rests the farm: at the grain glut its crew shrinks to the first farmer', () => {
    const content = grainContent();
    const seat = seatOn(content, [FARM_TYPE], BUILDER_CAP + SPARE_MEN);
    const farm = entityOfBuilding(seat.sim, FARM_TYPE);
    const { glut } = linesOf(content, WHEAT);
    const released = () => seat.decide().filter((c) => c.kind === 'setJob' && c.jobType === BUILDER);

    seat.stock([WHEAT], 0);
    seat.apply(seat.decide());
    const farmers = seat.crew(farm, FARMER).sort((a, b) => a - b);
    expect(farmers).toHaveLength(4);

    seat.stock([WHEAT], glut);
    expect(released()).toEqual(
      farmers.slice(1).map((entity) => ({ kind: 'setJob', entity, jobType: BUILDER })),
    );
    seat.apply(released());
    // The first farmer tends the sown fields however much grain lies in store, and an empty farm takes
    // one back at once.
    expect(released()).toEqual([]);
    expect(seat.crew(farm, FARMER)).toEqual(farmers.slice(0, 1));
    expect(operatorTiers(seat, content, farm, crewOf(0))).toEqual({ min: 1, target: 1, surplus: 1 });
  });

  it('plans the second miller out of surplus while the flour runs short, and rests the mill only early', () => {
    const content = grainContent();
    const seat = seatOn(content, [MILL_TYPE], BUILDER_CAP + SPARE_MEN);
    const mill = entityOfBuilding(seat.sim, MILL_TYPE);
    const { comfort, glut } = linesOf(content, FLOUR);
    const tiers = (flour: number, held: HeldStaff, tick = 0) => {
      seat.stock([FLOUR], flour);
      return operatorTiers(seat, content, mill, held, tick);
    };
    // The mill's target is its one miller: the build order plans it as one consumer of the grain.
    const ctx = { ...ctxOf(seat.sim), content };
    const millType = contentIndex(content).buildings.get(MILL_TYPE);
    if (millType === undefined) throw new Error('setup: the mill');
    expect(plannedOperators(ctx, millType)).toBe(1);

    expect(tiers(comfort, alone)).toEqual({ min: 1, target: 1, surplus: 1 });
    expect(tiers(comfort - 1, alone)).toEqual({ min: 1, target: 1, surplus: 2 });
    expect(tiers(glut - 1, crewOf(2))).toEqual({ min: 1, target: 1, surplus: 2 });
    // At glut the crew rests before the core-crew time, and from it on shrinks to its first miller.
    expect(tiers(glut, crewOf(2))).toEqual({ min: 0, target: 0, surplus: 0 });
    expect(tiers(glut, crewOf(2), CORE_CREW_FROM_TICKS)).toEqual({ min: 1, target: 1, surplus: 1 });
    expect(tiers(glut, alone)).toEqual({ min: 0, target: 0, surplus: 0 });
    expect(tiers(glut, alone, CORE_CREW_FROM_TICKS)).toEqual({ min: 1, target: 1, surplus: 1 });

    seat.stock([FLOUR], 0);
    seat.apply(seat.decide());
    expect(seat.crew(mill, MILLER)).toHaveLength(2);
  });
});

const HERB_HUT = 70;
const HERBALIST = 29;
/** The herb hut's herbalist seats, as the real hut's. */
const HERB_HUT_SEATS = 3;

describe('workforce module - the herb hut crew', () => {
  it('staffs one herbalist and a second from surplus, and all three late in the game', () => {
    const base = aiContent();
    const content = parseContentSet({
      ...base,
      jobs: [...base.jobs, { typeId: HERBALIST, id: 'herbalist' }],
      buildings: [
        ...base.buildings,
        {
          typeId: HERB_HUT,
          id: 'work_herb_hut',
          kind: 'workplace',
          workers: [
            { jobType: HERBALIST, count: HERB_HUT_SEATS },
            { jobType: CARRIER, count: 1 },
          ],
          construction: [{ goodType: WOOD, amount: 1 }],
        },
      ],
    });
    const seat = seatOn(content, [HERB_HUT], 1);
    const hut = entityOfBuilding(seat.sim, HERB_HUT);
    const hutType = contentIndex(content).buildings.get(HERB_HUT);
    if (hutType === undefined) throw new Error('setup: the herb hut');
    expect(operatorTiers(seat, content, hut, alone, LATE_GAME_FROM_TICKS - 1)).toEqual({
      min: 1,
      target: 1,
      surplus: 2,
    });
    expect(operatorTiers(seat, content, hut, alone, LATE_GAME_FROM_TICKS)).toEqual({
      min: 1,
      target: 2,
      surplus: HERB_HUT_SEATS,
    });
    // The druids' herb supply counts the late crew's target.
    expect(plannedOperators({ ...ctxOf(seat.sim, LATE_GAME_FROM_TICKS), content }, hutType)).toBe(2);
  });
});

/** Enough men that the surplus tier reaches the stores past every earlier post. */
const GROWN_SEAT_MEN = 60;

describe('workforce module - the stores staff carriers only late in the game', () => {
  const hqCarrierHires = (seat: Seat, tick: number) =>
    seat
      .decide(tick)
      .filter((c) => c.kind === 'assignWorker' && c.building === entityOfBuilding(seat.sim, HQ_TYPE));

  it('posts no store carrier before the store-carrier time, however many men are spare', () => {
    const seat = seatOn(aiContent(), [], GROWN_SEAT_MEN);
    const early = STORE_CARRIERS_FROM_TICKS - 1;
    expect(hqCarrierHires(seat, early)).toEqual([]);
    expect(planOf(seat, aiContent(), entityOfBuilding(seat.sim, HQ_TYPE), crewOf(0), early)).toMatchObject({
      carrierTarget: 0,
      carrierSurplus: 0,
    });
  });

  it('hires the store carriers, one per tier, from the store-carrier time', () => {
    const seat = seatOn(aiContent(), [], GROWN_SEAT_MEN);
    const hq = entityOfBuilding(seat.sim, HQ_TYPE);
    expect(planOf(seat, aiContent(), hq, crewOf(0), STORE_CARRIERS_FROM_TICKS)).toMatchObject(STORE_CARRIERS);
    expect(
      hqCarrierHires(seat, STORE_CARRIERS_FROM_TICKS).map((c) => c.kind === 'assignWorker' && c.jobPriority),
    ).toEqual(Array.from({ length: STORE_CARRIERS.carrierSurplus }, () => [CARRIER]));
  });

  it('hands early store carriers back as builders', () => {
    const seat = seatOn(aiContent(), [], BUILDER_CAP + SPARE_MEN);
    const hq = entityOfBuilding(seat.sim, HQ_TYPE);
    for (let i = 0; i < STORE_CARRIERS.carrierSurplus; i++) hireSpare(seat, hq, CARRIER);
    const carriers = seat.crew(hq, CARRIER).sort((a, b) => a - b);
    expect(carriers).toHaveLength(STORE_CARRIERS.carrierSurplus);
    expect(
      seat
        .decide()
        .filter((c) => c.kind === 'setJob' && carriers.includes(c.entity))
        .map((c) => c.kind === 'setJob' && c.jobType),
    ).toEqual(carriers.map(() => BUILDER));
  });
});
