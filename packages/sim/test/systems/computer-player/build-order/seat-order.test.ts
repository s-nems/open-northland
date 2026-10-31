import { describe, expect, it } from 'vitest';
import {
  aiControlEntity,
  ComputerStrategy,
  ECONOMIC_SIDES,
  type EconomicSide,
  type EconomicStrategyState,
  type MilitaryStrategyState,
} from '../../../../src/components/index.js';
import type { Simulation } from '../../../../src/index.js';
import { CATAPULT_JOINERY } from '../../../../src/systems/computer-player/build-order/military-line.js';
import {
  coverageOf,
  TOWER_DEFENCE_RADIUS_NODES,
} from '../../../../src/systems/computer-player/build-order/tower-coverage.js';
import {
  AI_PROFILES,
  ARCHETYPE_TUNING,
  type BuildOrder,
  type BuildOrderEntry,
  buildOrderModule,
  DEFAULT_BUILD_ORDER,
  DEFENCE_TOWER_RADIUS_PCT,
  defenceFirst,
  EARLY_SECOND_TAILOR,
  LATE_SMITHIES,
  LATER_MINTS,
  linesByPriority,
  orderSteps,
  PLAN_TUNING,
  SECOND_ANIMAL_FARM,
  SECOND_UPPER_TAILOR,
  seatSitePace,
  shapeBuildOrder,
  sitePace,
} from '../../../../src/systems/computer-player/index.js';
import {
  ASSUMED_PEACE_TICKS,
  TOWER_LEAD_TICKS,
} from '../../../../src/systems/computer-player/military/deadline.js';
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
  TOWER_TYPE,
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

const OUTMATCHED: MilitaryStrategyState = {
  ...BUILDING_UP,
  posture: 'defend',
  evidence: ['outmatched', 'noTarget'],
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
    expect(defenceFirst(BUILDING_UP, true)).toBe(false);
    expect(defenceFirst(FORECAST, false)).toBe(true);
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
        {
          id: 'bread',
          steps: [{ kind: 'place', building: 'home_level_00', count: 1, belowTier: 'home_level_01' }],
        },
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

  it('gives the next free site to a placement whose military deadline lead has opened', () => {
    const order = (leadTicks: number): BuildOrder => ({
      lines: [
        {
          id: 'bread',
          steps: [{ kind: 'place', building: 'home_level_00', count: 1, belowTier: 'home_level_01' }],
        },
        {
          id: 'military',
          steps: [
            { kind: 'place', building: 'barracks', count: 1, holdUntil: { kind: 'deadline', leadTicks } },
          ],
        },
      ],
      priority: DEFAULT_BUILD_ORDER.priority,
    });
    // A lead as long as the whole peace has opened at once; a lead of nothing still holds the barracks.
    expect(firstCommand(seatWith({ archetype: 'standard' }), order(ASSUMED_PEACE_TICKS))).toMatchObject({
      buildingType: BARRACKS_TYPE,
    });
    expect(firstCommand(seatWith({ archetype: 'standard' }), order(0))).toMatchObject({
      buildingType: HOME_TYPE,
    });

    // A later step of its line met by a rising site, as a ring tower raised at the upper tier meets a tower
    // upgrade, keeps the opened barracks ahead.
    const withUpgrade: BuildOrder = {
      ...order(ASSUMED_PEACE_TICKS),
      lines: order(ASSUMED_PEACE_TICKS).lines.map((line) =>
        line.id === 'military'
          ? { ...line, steps: [...line.steps, { kind: 'upgrade', building: 'tower_01', count: 1 }] }
          : line,
      ),
    };
    const rising = seatWith({ archetype: 'standard' });
    rising.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: TOWER_TYPE,
      x: HQ_X + 12,
      y: HQ_Y + 8,
      tribe: VIKING,
      owner: SEAT,
      underConstruction: true,
    });
    rising.step();
    expect(firstCommand(rising, withUpgrade)).toMatchObject({ buildingType: BARRACKS_TYPE });
  });

  it('keeps the economy first against a stronger enemy until the deadline nears or a raid lands', () => {
    expect(defenceFirst(OUTMATCHED, false)).toBe(false);
    expect(defenceFirst(OUTMATCHED, true)).toBe(true);
    expect(defenceFirst({ ...OUTMATCHED, evidence: ['underAttack', 'outmatched'] }, false)).toBe(true);
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
    // The tunics come before the joinery and the armory's weapons, from both tailors at once, which only the
    // iron-poor seat raises; an iron-rich seat raises its joinery ahead of its tailor.
    const ids = linesByPriority(natural).map((line) => line.id);
    expect(ids.indexOf('clothing')).toBeLessThan(ids.indexOf('tools'));
    expect(ids.indexOf('clothing')).toBeLessThan(ids.indexOf('weapons'));
    expect(orderSteps(natural)).toContain(EARLY_SECOND_TAILOR);
    const ironRich = shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['ironArms'] });
    expect(orderSteps(ironRich)).not.toContain(EARLY_SECOND_TAILOR);
    const richIds = linesByPriority(ironRich).map((line) => line.id);
    expect(richIds.indexOf('tools')).toBeLessThan(richIds.indexOf('clothing'));
  });

  it('forges weapons in two smithies and dresses in tunics from two upper tailors on little iron', () => {
    const shape = { archetype: 'standard', phase: 'opening', defenceFirst: false } as const;
    const scarce = orderSteps(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['ironWeapons'] }));
    for (const step of LATE_SMITHIES) expect(scarce).not.toContain(step);
    for (const step of [EARLY_SECOND_TAILOR, SECOND_UPPER_TAILOR, SECOND_ANIMAL_FARM])
      expect(scarce).toContain(step);
    const plenty = orderSteps(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides: ['ironArms'] }));
    for (const step of LATE_SMITHIES) expect(plenty).toContain(step);
    expect(plenty).not.toContain(SECOND_ANIMAL_FARM);
  });

  it('keeps to one mint on little gold', () => {
    const shape = { archetype: 'standard', phase: 'opening', defenceFirst: false } as const;
    const mints = (sides: readonly EconomicSide[]) =>
      orderSteps(shapeBuildOrder(DEFAULT_BUILD_ORDER, { ...shape, sides })).filter((step) =>
        LATER_MINTS.includes(step),
      ).length;
    expect(mints(['ironArms', 'goldLine'])).toBe(LATER_MINTS.length);
    expect(mints(['ironArms', 'goldLine', 'oneMint'])).toBe(0);
  });

  it('ends each archetype on the owner-ruled counts of its late workshops and homes', () => {
    const top = (archetype: 'rich' | 'standard' | 'cramped', building: string): number => {
      const order = shapeBuildOrder(DEFAULT_BUILD_ORDER, {
        archetype,
        sides: ['ironArms', 'goldLine'],
        phase: 'late',
        defenceFirst: false,
      });
      return Math.max(
        0,
        ...orderSteps(order).flatMap((e) =>
          (e.kind === 'place' || e.kind === 'upgrade' || e.kind === 'housing') && e.building === building
            ? [e.count]
            : [],
        ),
      );
    };
    const buildings = [
      'work_coin_mint',
      'work_brewery',
      'work_druid_01',
      'work_smithy_01',
      'work_armory_01',
      'home_level_00',
      'work_bakery_01',
    ];
    const counts = (archetype: 'rich' | 'standard' | 'cramped') => buildings.map((b) => top(archetype, b));
    expect(counts('rich')).toEqual([3, 3, 6, 6, 2, 14, 4]);
    expect(counts('standard')).toEqual([3, 3, 6, 4, 2, 10, 2]);
    expect(counts('cramped')).toEqual([2, 2, 4, 4, 2, 8, 1]);
  });

  it('keeps one of each workshop, fewer homes and no catapults on a seat with no room', () => {
    const order = shapeBuildOrder(DEFAULT_BUILD_ORDER, {
      archetype: 'islands',
      sides: ['ironArms', 'fishing', 'noRoom'],
      phase: 'late',
      defenceFirst: false,
    });
    const steps = orderSteps(order);
    const top = (building: string) =>
      Math.max(
        0,
        ...steps.flatMap((e) =>
          (e.kind === 'place' || e.kind === 'upgrade' || e.kind === 'housing') && e.building === building
            ? [e.count]
            : [],
        ),
      );
    for (const building of [
      'work_smithy_01',
      'work_bakery_00',
      'work_bakery_01',
      'work_animal_farm',
      'work_sewery_00',
      'work_sewery_01',
      'work_brewery',
      'work_armory_01',
    ])
      expect(top(building), building).toBe(1);
    expect(top('home_level_00')).toBeLessThan(ARCHETYPE_TUNING.cramped.copyCaps.home_level_00 ?? 0);
    expect(steps).not.toContain(CATAPULT_JOINERY);
    // No gold on its land: no herb hut, druid, temple or mint.
    for (const building of ['work_herb_hut', 'work_druid_00', 'work_temple', 'work_coin_mint'])
      expect(top(building), building).toBe(0);
    // The island's ship joinery still leads the army line.
    const military = order.lines.find((line) => line.id === 'military');
    const ship = military?.steps[0];
    expect(ship?.kind === 'place' && ship.role).toBe('ship');
  });

  it('puts up the second bakery at once only where the seat has room', () => {
    const shape = {
      sides: ECONOMIC_SIDES.filter((side) => side !== 'noRoom'),
      phase: 'opening',
      defenceFirst: false,
    } as const;
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
    // The bakery's own step waits for the military deadline, so only the held home could act at first.
    const bakeryLater: BuildOrderEntry = {
      kind: 'place',
      building: 'work_bakery_00',
      count: 1,
      holdUntil: { kind: 'deadline', leadTicks: TOWER_LEAD_TICKS },
    };
    const waits = (building: string): BuildOrder => ({
      lines: [
        {
          id: 'opening',
          steps: [
            {
              kind: 'place',
              building: 'home_level_00',
              count: 1,
              belowTier: 'home_level_01',
              holdUntil: { kind: 'built', building },
            },
          ],
        },
        { id: 'bread', steps: [bakeryLater] },
      ],
      priority: ['opening', 'bread'],
    });
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
      expect(coverageOf(sim.world, ctxOf(sim), SEAT, towers).radius).toBe(
        Math.floor((TOWER_DEFENCE_RADIUS_NODES * PLAN_TUNING[plan].towerRadiusPct) / 100),
      );
    }
    // Denser again while a forecast attack puts the defence first.
    const braced = seatWith({}, FORECAST);
    expect(coverageOf(braced.world, ctxOf(braced), SEAT, towers)).toEqual({
      by: 'tower',
      radius: Math.floor((TOWER_DEFENCE_RADIUS_NODES * DEFENCE_TOWER_RADIUS_PCT) / 100),
      baseCovers: false,
    });
  });
});
