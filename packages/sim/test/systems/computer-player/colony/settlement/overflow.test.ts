import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  ComputerColony,
  JobAssignment,
  ProductionCounters,
  UnderConstruction,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../../src/index.js';
import {
  everyBuildingOf,
  everySettlerOf,
  homeBuildings,
  homeSettlers,
} from '../../../../../src/systems/ai-shared/home-roster.js';
import { entryStatuses } from '../../../../../src/systems/computer-player/build-order/steps/status.js';
import {
  isOverflowBuilding,
  reviewOverflow,
} from '../../../../../src/systems/computer-player/colony/settlement/overflow.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';
import { homeStockOf } from '../../../../../src/systems/computer-player/home-stock.js';
import { stockAtBuildings } from '../../../../../src/systems/stores/index.js';
import {
  ARMORY_TYPE,
  blankColony,
  colonyIslands,
  colonyState,
  colonyWorld,
  editColony,
  looseColonyEnv,
  overflowContent,
  SPEAR,
  stepUntil,
} from '../../../../fixtures/colony-islands.js';
import { runningWorld } from '../../../../fixtures/colony-scenarios.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { SEAT, VIKING } from '../../support.js';

const MATERIAL_WORKSHOP_IDS = [
  'work_pottery_00',
  'work_pottery_01',
  'work_mason_hut_00',
  'work_mason_hut_01',
];
const WORKSHOP_DUE_TICKS = minutesToTicks(30);
const GOODS_DUE_TICKS = minutesToTicks(45);
const HOME_DUE_TICKS = minutesToTicks(45);
const REVIEWED_TICKS = minutesToTicks(12);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const ARMORY_ID = 'work_armory_00';
/** The armory's next tier, in {@link armoryChainContent}. */
const ARMORY_TOP_TYPE = 51;
/** A workshop on the east island, clear of its deposits. */
const COLONY_WORKSHOP_AT = { x: 160, y: 64 };

/** {@link overflowContent} whose armory upgrades a tier. */
function armoryChainContent(): ContentSet {
  const content = overflowContent();
  const armory = content.buildings.find((b) => b.typeId === ARMORY_TYPE);
  if (armory === undefined) throw new Error('fixture: no armory');
  return parseContentSet({
    ...content,
    buildings: [
      ...content.buildings.map((b) =>
        b.typeId === ARMORY_TYPE ? { ...b, upgradeTarget: ARMORY_TOP_TYPE } : b,
      ),
      { ...armory, typeId: ARMORY_TOP_TYPE, id: 'work_armory_01' },
    ],
  });
}

const handedOver = (sim: Simulation): readonly string[] =>
  colonyState(sim)?.overflow.map((row) => row.building) ?? [];

function colonyArmory(sim: Simulation): Entity | undefined {
  const home = new Set(homeBuildings(sim.world, ctxOf(sim), SEAT));
  return everyBuildingOf(sim.world, SEAT).find(
    (e) => !home.has(e) && sim.world.get(e, Building).buildingType === ARMORY_TYPE,
  );
}

describe('the workshops a colony takes over', () => {
  it('leaves out the pottery and the mason hut, whose goods home sends', () => {
    for (const id of MATERIAL_WORKSHOP_IDS) expect(isOverflowBuilding(id)).toBe(false);
    expect(isOverflowBuilding('work_smithy_00')).toBe(true);
  });
});

describe('overflow production', () => {
  it("hands a held step over and brings the workshop's goods home, through a save", () => {
    const { sim } = runningWorld();
    expect(stepUntil(sim, REVIEWED_TICKS, () => handedOver(sim).includes(ARMORY_ID))).toBe(true);
    const entry = { kind: 'place', building: ARMORY_ID, count: 1 } as const;
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['satisfied']);

    expect(
      stepUntil(sim, WORKSHOP_DUE_TICKS, () => {
        const armory = colonyArmory(sim);
        return armory !== undefined && !sim.world.has(armory, UnderConstruction);
      }),
    ).toBe(true);
    const armory = colonyArmory(sim) as Entity;
    const crew = (): Entity[] =>
      everySettlerOf(sim.world, SEAT).filter((e) => sim.world.tryGet(e, JobAssignment)?.workplace === armory);
    expect(stepUntil(sim, GOODS_DUE_TICKS, () => crew().length > 0)).toBe(true);
    expect(homeSettlers(sim.world, ctxOf(sim), SEAT)).not.toContain(crew()[0]);
    expect(
      stepUntil(
        sim,
        GOODS_DUE_TICKS,
        () => (stockAtBuildings(sim.world, SEAT, [armory]).get(SPEAR) ?? 0) > 0,
      ),
    ).toBe(true);
    expect(sim.world.tryGet(crew()[0] as Entity, ProductionCounters)).toBeDefined();

    const saved = parseSaveGame(JSON.parse(serializeSaveGame(exportSaveGame(sim))));
    const copy = restoreSimulation(saved, { content: overflowContent(), map: colonyIslands() });
    expect(copy.hashState()).toBe(sim.hashState());
    for (let t = 0; t < AFTER_SAVE_TICKS; t++) {
      sim.step();
      copy.step();
    }
    expect(copy.hashState()).toBe(sim.hashState());

    const home = (): number => homeStockOf(sim.world, ctxOf(sim), SEAT).units(SPEAR);
    expect(stepUntil(sim, HOME_DUE_TICKS, () => home() > 0)).toBe(true);
  });

  it('gives the step back once the colony is lost', () => {
    const { sim } = runningWorld();
    stepUntil(sim, REVIEWED_TICKS, () => handedOver(sim).includes(ARMORY_ID));
    editColony(sim).phase = 'abandoned';
    const entry = { kind: 'place', building: ARMORY_ID, count: 1 } as const;
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['unmet']);
  });

  it('keeps a handed-over workshop once the colony lifts it a tier', () => {
    const sim = colonyWorld(7, armoryChainContent(), ['noRoom']);
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: ARMORY_TOP_TYPE,
      ...COLONY_WORKSHOP_AT,
      tribe: VIKING,
      owner: SEAT,
      force: true,
      underConstruction: false,
    });
    sim.step();
    const carrier = aiControlEntity(sim.world, SEAT);
    const terrain = sim.terrain;
    if (carrier === null || terrain === undefined) throw new Error('setup: no AI seat or terrain');
    const land = terrain.componentOf(terrain.nodeAt(COLONY_WORKSHOP_AT.x, COLONY_WORKSHOP_AT.y));
    const handed = blankColony(land, {
      overflow: [{ line: 'armory', step: 0, building: ARMORY_ID }],
      builds: [{ building: ARMORY_ID, placed: true }],
    });
    sim.world.add(carrier, ComputerColony, { colonies: [handed], rejected: [], retryAt: 0 });
    const colony = editColony(sim);

    reviewOverflow(looseColonyEnv(sim, colony), colony);

    expect(colony.overflow.map((row) => row.building)).toEqual([ARMORY_ID]);
  });

  it('keeps a held step at home on a seat with room', () => {
    const { sim } = runningWorld(ARMORY_ID, []);
    stepUntil(sim, REVIEWED_TICKS, () => handedOver(sim).length > 0);
    expect(handedOver(sim)).toEqual([]);
  });

  it('never hands over a building that serves its own ground', () => {
    const { sim } = runningWorld('barracks');
    stepUntil(sim, REVIEWED_TICKS, () => handedOver(sim).length > 0);
    expect(handedOver(sim)).toEqual([]);
  });
});
