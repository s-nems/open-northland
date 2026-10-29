import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerStrategy,
  ECONOMIC_SIDES,
  type EconomicStrategyState,
  type MilitaryStrategyState,
} from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import {
  coverageOf,
  TOWER_DEFENCE_RADIUS_NODES,
} from '../../../../src/systems/computer-player/build-order/tower-coverage.js';
import {
  AI_PROFILES,
  ARCHETYPE_TUNING,
  type BuildOrder,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  DEFENCE_TOWER_RADIUS_PCT,
  defenceFirst,
  EARLY_SECOND_TAILOR,
  linesByPriority,
  orderSteps,
  PLAN_TUNING,
  seatSitePace,
  shapeBuildOrder,
  sitePace,
} from '../../../../src/systems/computer-player/index.js';
import {
  aiSim,
  BAKERY_TYPE,
  BARRACKS_TYPE,
  completeSites,
  ctxOf,
  HOME_TYPE,
  HQ_X,
  HQ_Y,
  makeAiSeat,
  oneLine,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  VIKING,
} from '../support.js';

const BUILDING_UP: MilitaryStrategyState = {
  posture: 'prepare',
  evidence: ['noTarget', 'buildingUp'],
  ownPoints: 0,
  targetOwner: null,
  targetPoints: null,
  strongestPoints: null,
  threatInTicks: null,
  plan: 'balanced',
  decidedAt: 0,
  challenger: null,
};

const FORECAST: MilitaryStrategyState = {
  ...BUILDING_UP,
  evidence: ['forecastThreat', 'noTarget'],
  threatInTicks: 0,
};

/** A seat whose strategy step has run once, its record then overwritten with `economy` and `military`. */
function seatWith(
  economy: Partial<EconomicStrategyState>,
  military: Partial<MilitaryStrategyState> = {},
): Simulation {
  const sim = aiSim();
  placeHq(sim);
  makeAiSeat(sim, SEAT, { houseBuild: false });
  sim.step();
  const carrier = aiControlEntity(sim.world, SEAT);
  if (carrier === null || !sim.world.has(carrier, ComputerStrategy)) throw new Error('setup: no strategy');
  const held = sim.world.mut(carrier, ComputerStrategy);
  held.economy = { ...held.economy, ...economy };
  held.military = { ...BUILDING_UP, ...military };
  return sim;
}

function firstCommand(sim: Simulation, order: BuildOrder) {
  return [...buildOrderModule(order).run(sim.world, ctxOf(sim), SEAT)][0];
}

describe('the seat strategy shapes the build order', () => {
  it('raises the army line over a later economy step while a scripted attack is forecast', () => {
    expect(defenceFirst(BUILDING_UP)).toBe(false);
    expect(defenceFirst(FORECAST)).toBe(true);
    const shape = { archetype: 'standard', sides: ECONOMIC_SIDES, phase: 'opening' } as const;
    const rank = (order: BuildOrder, id: string) =>
      linesByPriority(order).findIndex((line) => line.id === id);
    const calm = shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, defenceFirst: false });
    const braced = shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, defenceFirst: true });
    expect(rank(calm, 'military')).toBeGreaterThan(rank(calm, 'bread'));
    expect(rank(braced, 'military')).toBeLessThan(rank(braced, 'bread'));
    expect(rank(braced, 'weapons')).toBeLessThan(rank(braced, 'bread'));

    // With one free site the executor gives it to the barracks only while the attack is forecast.
    const order: BuildOrder = {
      lines: [
        { id: 'bread', steps: [{ kind: 'place', building: 'home_level_00', count: 1 }] },
        { id: 'military', steps: [{ kind: 'place', building: 'barracks', count: 1 }] },
      ],
      priority: DEFAULT_BUILD_ORDER.priority,
    };
    expect(firstCommand(seatWith({ archetype: 'standard' }), order)).toMatchObject({
      buildingType: HOME_TYPE,
    });
    expect(firstCommand(seatWith({ archetype: 'standard' }, FORECAST), order)).toMatchObject({
      buildingType: BARRACKS_TYPE,
    });
  });

  it('drops the smithies and the iron gatherer from a seat arming without iron', () => {
    const shape = { archetype: 'standard', phase: 'opening', defenceFirst: false } as const;
    const ironFree = (order: BuildOrder) =>
      orderSteps(order).every(
        (entry) =>
          !(entry.kind === 'collector' && entry.good === 'iron') &&
          !((entry.kind === 'place' || entry.kind === 'upgrade') && entry.building.startsWith('work_smithy')),
      );
    expect(ironFree(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['ironArms'] }))).toBe(false);
    const natural = shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['naturalArms'] });
    expect(ironFree(natural)).toBe(true);
    expect(orderSteps(natural).some((e) => e.kind === 'place' && e.building === 'work_armory_00')).toBe(true);
    // The tunics come before the armory's weapons, from a second tailor only the iron-poor seat raises early.
    const ids = linesByPriority(natural).map((line) => line.id);
    expect(ids.indexOf('clothing')).toBeLessThan(ids.indexOf('weapons'));
    expect(orderSteps(natural)).toContain(EARLY_SECOND_TAILOR);
    const ironRich = shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['ironArms'] });
    expect(orderSteps(ironRich)).not.toContain(EARLY_SECOND_TAILOR);
  });

  it('puts up the second bakery at once only where the seat has room', () => {
    const shape = { sides: ECONOMIC_SIDES, phase: 'opening', defenceFirst: false } as const;
    const lowerBakeries = (order: BuildOrder) =>
      orderSteps(order).flatMap((e) =>
        e.kind === 'place' && e.building === 'work_bakery_00' ? [e.count] : [],
      );
    expect(lowerBakeries(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, archetype: 'standard' }))).toEqual([
      1, 2,
    ]);
    expect(lowerBakeries(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, archetype: 'cramped' }))).toEqual([
      1, 1,
    ]);
  });

  it('holds a step until the building it waits on stands, and passes a hold it can never meet', () => {
    const waits = (building: string) =>
      oneLine([
        { kind: 'place', building: 'home_level_00', count: 1, holdUntil: { kind: 'built', building } },
      ]);
    const sim = seatWith({ archetype: 'standard' });
    expect(firstCommand(sim, waits('work_bakery_00'))).toBeUndefined();
    // A rising site does not count.
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 8,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    sim.step();
    expect(firstCommand(sim, waits('work_bakery_00'))).toBeUndefined();
    completeSites(sim);
    expect(firstCommand(sim, waits('work_bakery_00'))).toMatchObject({ buildingType: HOME_TYPE });
    expect(firstCommand(seatWith({}), waits('no_such_building'))).toMatchObject({ buildingType: HOME_TYPE });
  });

  it('keeps a cramped seat within a tighter reach of its buildings', () => {
    expect(ARCHETYPE_TUNING.cramped.reachNodes).toBeLessThan(ARCHETYPE_TUNING.standard.reachNodes);
    // A home pulled toward the clay lying past the cramped reach lands nearer the base than the standard
    // seat's.
    const toward = oneLine([
      { kind: 'place', building: 'home_level_00', count: 1, near: [{ kind: 'resource', good: 'mud' }] },
    ]);
    const distance = (archetype: 'standard' | 'cramped'): number => {
      const sim = seatWith({ archetype });
      placeResources(sim, [RESOURCE_SPOTS.mud], 40);
      sim.step();
      const placed = firstCommand(sim, toward);
      if (placed?.kind !== 'placeBuilding') throw new Error(`expected a ${archetype} placement`);
      return Math.abs(placed.x - HQ_X) + Math.abs(placed.y - HQ_Y);
    };
    const cramped = distance('cramped');
    expect(cramped).toBeLessThanOrEqual(ARCHETYPE_TUNING.cramped.reachNodes);
    expect(cramped).toBeLessThan(distance('standard'));
  });

  it('opens one more construction site for a rich seat', () => {
    const hard = AI_PROFILES.hard;
    expect(seatSitePace(seatWith({ archetype: 'standard' }).world, SEAT, hard, 0).sites).toBe(
      sitePace(hard, 0).sites,
    );
    expect(seatSitePace(seatWith({ archetype: 'rich' }).world, SEAT, hard, 0).sites).toBe(
      sitePace(hard, 0).sites + 1,
    );
  });

  it('rings towers as densely as the military plan asks', () => {
    const towers = { kind: 'towerCoverage', building: 'tower_01' } as const;
    for (const plan of ['defensive', 'aggressive', 'balanced'] as const) {
      const sim = seatWith({}, { plan, posture: 'attack', evidence: ['ratioReached'] });
      expect(coverageOf(sim.world, SEAT, towers).radius).toBe(
        Math.floor((TOWER_DEFENCE_RADIUS_NODES * PLAN_TUNING[plan].towerRadiusPct) / 100),
      );
    }
    // Denser again while a forecast attack puts the defence first.
    const braced = seatWith({}, FORECAST);
    expect(coverageOf(braced.world, SEAT, towers)).toEqual({
      by: 'tower',
      radius: Math.floor((TOWER_DEFENCE_RADIUS_NODES * DEFENCE_TOWER_RADIUS_PCT) / 100),
      baseCovers: false,
    });
  });
});
