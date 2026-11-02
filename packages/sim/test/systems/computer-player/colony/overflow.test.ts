import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  Building,
  type EconomicSide,
  JobAssignment,
  ProductionCounters,
  Resource,
  StalledPlacements,
  UnderConstruction,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import {
  exportSaveGame,
  parseSaveGame,
  restoreSimulation,
  type Simulation,
  serializeSaveGame,
} from '../../../../src/index.js';
import {
  everyBuildingOf,
  everySettlerOf,
  homeBuildings,
  homeSettlers,
} from '../../../../src/systems/ai-shared/home-roster.js';
import {
  type BuildLineId,
  DEFAULT_BUILD_ORDER,
  type StepKey,
  stepKey,
} from '../../../../src/systems/computer-player/build-order/entries.js';
import { entryStatuses } from '../../../../src/systems/computer-player/build-order/progress.js';
import { seatBuildOrder } from '../../../../src/systems/computer-player/build-order/seat-order.js';
import { colonists } from '../../../../src/systems/computer-player/colony/founding.js';
import { homeStockOf } from '../../../../src/systems/computer-player/colony/stock.js';
import { computerProfileOf } from '../../../../src/systems/computer-player/difficulty.js';
import { minutesToTicks } from '../../../../src/systems/computer-player/game-phase.js';
import { stockAtBuildings } from '../../../../src/systems/stores/index.js';
import {
  ARMORY_TYPE,
  colonyIslands,
  colonyState,
  colonyWorld,
  editColony,
  looseColonyEnv,
  mooredShip,
  overflowContent,
  SMALL_SHIP,
  SPEAR,
  stepUntil,
} from '../../../fixtures/colony-islands.js';
import { ctxOf } from '../../../fixtures/context.js';
import { SEAT } from '../support.js';

const SITE_DUE_TICKS = minutesToTicks(2);
const SCOUT_DUE_TICKS = minutesToTicks(12);
const RUNNING_DUE_TICKS = minutesToTicks(30);
const WORKSHOP_DUE_TICKS = minutesToTicks(30);
const GOODS_DUE_TICKS = minutesToTicks(45);
const HOME_DUE_TICKS = minutesToTicks(45);
const REVIEWED_TICKS = minutesToTicks(12);
const AFTER_SAVE_TICKS = minutesToTicks(3);
const SECOND_SHIP_AT = { x: 90, y: 100 };
const NEVER_RETRY_TICK = Number.MAX_SAFE_INTEGER;
const ARMORY_ID = 'work_armory_00';

/** Mark the step that places `building` as holding its line for ground, as a failed search leaves it. */
function holdForGround(sim: Simulation, building: string): StepKey {
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null) throw new Error('setup: no carrier');
  const ctx = ctxOf(sim);
  const order = seatBuildOrder(sim.world, ctx, SEAT, DEFAULT_BUILD_ORDER, computerProfileOf(sim.world, SEAT));
  for (const line of order.lines) {
    const step = line.steps.findIndex((entry) => 'building' in entry && entry.building === building);
    if (step < 0) continue;
    const key = stepKey(line.id, step);
    sim.world.add(carrier, StalledPlacements, {
      retryTicks: new Map([[key, NEVER_RETRY_TICK]]),
      holding: new Map<BuildLineId, StepKey>([[line.id, key]]),
    });
    return key;
  }
  throw new Error(`setup: no step places ${building}`);
}

/** A seat whose colony runs, with `building`'s step held since before the colony landed. */
function runningWorld(
  building = ARMORY_ID,
  sides: readonly EconomicSide[] = ['noRoom'],
): { readonly sim: Simulation; readonly ship: Entity } {
  const sim = colonyWorld(7, overflowContent(), sides);
  holdForGround(sim, building);
  stepUntil(sim, SITE_DUE_TICKS, () => colonyState(sim) !== undefined);
  mooredShip(sim);
  stepUntil(sim, SCOUT_DUE_TICKS, () => colonyState(sim)?.phase === 'fittingOut');
  const ship = mooredShip(sim, SMALL_SHIP, SECOND_SHIP_AT);
  if (!stepUntil(sim, RUNNING_DUE_TICKS, () => colonyState(sim)?.phase === 'running'))
    throw new Error('setup: no running colony');
  return { sim, ship };
}

const handedOver = (sim: Simulation): readonly string[] =>
  colonyState(sim)?.overflow.map((row) => row.building) ?? [];

function colonyArmory(sim: Simulation): Entity | undefined {
  const home = new Set(homeBuildings(sim.world, ctxOf(sim), SEAT));
  return everyBuildingOf(sim.world, SEAT).find(
    (e) => !home.has(e) && sim.world.get(e, Building).buildingType === ARMORY_TYPE,
  );
}

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

  it('sails men home once the colony has no work left', () => {
    const { sim } = runningWorld('barracks');
    const ctx = ctxOf(sim);
    const home = new Set(homeSettlers(sim.world, ctx, SEAT));
    const colonists = everySettlerOf(sim.world, SEAT).filter((e) => !home.has(e));
    for (const e of sim.world.canonicalQuery(Resource)) sim.world.destroy(e);
    const back = (): Entity[] => {
      const now = new Set(homeSettlers(sim.world, ctxOf(sim), SEAT));
      return colonists.filter((e) => now.has(e));
    };
    expect(stepUntil(sim, HOME_DUE_TICKS, () => back().length > 0)).toBe(true);
  });

  it('counts a man listed for the line no colonist until he lands', () => {
    const { sim } = runningWorld('barracks');
    const ctx = ctxOf(sim);
    const walking = homeSettlers(sim.world, ctx, SEAT)[0] as Entity;
    const colony = editColony(sim);
    colony.rest.push(walking);
    const env = looseColonyEnv(sim, colony);
    expect(homeSettlers(sim.world, ctx, SEAT)).not.toContain(walking);
    expect(colonists(env)).not.toContain(walking);
  });

  it('gives the step back once the colony is lost', () => {
    const { sim } = runningWorld();
    stepUntil(sim, REVIEWED_TICKS, () => handedOver(sim).includes(ARMORY_ID));
    editColony(sim).phase = 'abandoned';
    const entry = { kind: 'place', building: ARMORY_ID, count: 1 } as const;
    expect(entryStatuses(sim.world, ctxOf(sim), SEAT, [entry])).toEqual(['unmet']);
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
