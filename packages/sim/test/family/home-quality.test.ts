import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  HomeQuality,
  HomeQualityPolicy,
  Owner,
  Position,
  Residence,
  Resting,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  homeQualityPolicyView,
  homeQualityView,
  ONE,
  parseCommandEnvelope,
  playerCommand,
  restoreSimulation,
  Simulation,
} from '../../src/index.js';
import { ExternalFoodIndex } from '../../src/systems/family/food-search.js';
import { planWomanHoard } from '../../src/systems/family/hoard.js';
import {
  demandedHomeQualityGoods,
  drainHolyOil,
  homeQualityActive,
  spendHomeQuality,
} from '../../src/systems/family/home-quality.js';
import { ExternalQualityIndex } from '../../src/systems/family/quality-search.js';
import { applyNeedUnits } from '../../src/systems/lifecycle/needs/index.js';
import { pileupIntoStore } from '../../src/systems/settlers/atomics/effects/goods/transfer.js';
import { applyAtomicNeedEvents } from '../../src/systems/settlers/atomics/effects/need-events.js';
import { atomicSystem } from '../../src/systems/settlers/atomics/system.js';
import { planHomeTopUp } from '../../src/systems/settlers/drives/at-home.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

const FOOD = 1;
const CROCKERY = 2;
const FURNITURE = 3;
const OIL = 4;
const HOME = 1;
const JOB = 1;
const TRIBE = 1;

function content() {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: FOOD, id: 'food_simple' },
      {
        typeId: CROCKERY,
        id: 'crockery',
        homeQuality: {
          effect: 'cooking',
          deliveryValue: 100,
          capacity: 500,
          useCost: 5,
          fetchBelow: 100,
          minimumHomeLevel: 0,
        },
      },
      {
        typeId: FURNITURE,
        id: 'furniture',
        homeQuality: {
          effect: 'rest',
          deliveryValue: 100,
          capacity: 500,
          useCost: 5,
          fetchBelow: 100,
          minimumHomeLevel: 0,
        },
      },
      {
        typeId: OIL,
        id: 'holy_oil',
        homeQuality: {
          effect: 'piety',
          deliveryValue: 1000,
          capacity: 5000,
          useCost: 3,
          fetchBelow: 3000,
          minimumHomeLevel: 2,
        },
      },
    ],
    jobs: [{ typeId: JOB, id: 'civilist', needsReligion: true }],
    buildings: [
      { typeId: HOME, id: 'home', kind: 'home', homeSize: 1, stock: [{ goodType: FOOD, capacity: 5 }] },
    ],
    tribes: [
      {
        typeId: TRIBE,
        id: 'viking',
        jobEnables: [{ jobType: JOB, kind: 'job', targetId: JOB }],
        atomicBindings: [
          { jobType: JOB, atomicId: 8, animation: 'sleep_home' },
          { jobType: JOB, atomicId: 12, animation: 'pray_home' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'sleep_home', name: 'sleep_home', length: 2, events: [{ at: 1, type: 1, value: 1000 }] },
      { id: 'pray_home', name: 'pray_home', length: 2, events: [{ at: 1, type: 4, value: 1000 }] },
    ],
  });
}

function setup(): { sim: Simulation; home: Entity; carrier: Entity } {
  const sim = new Simulation({ seed: 1, content: content() });
  const home = sim.world.create();
  sim.world.add(home, Building, { buildingType: HOME, tribe: TRIBE, built: ONE, level: 2 });
  sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 0]]) });
  sim.world.add(home, Owner, { player: 0 });
  const carrier = sim.world.create();
  return { sim, home, carrier };
}

function deliver(sim: Simulation, carrier: Entity, home: Entity, goodType: number): number {
  sim.world.add(carrier, Carrying, { goodType, amount: 1 });
  return pileupIntoStore(sim.world, ctxOf(sim), carrier, home);
}

function toggle(
  sim: Simulation,
  home: Entity,
  effect: 'cooking' | 'rest' | 'piety',
  allowed: boolean,
  player = 0,
): void {
  sim.enqueue(playerCommand(player, { kind: 'setHomeQualityUse', home, effect, allowed }));
  sim.step();
}

describe('household quality goods', () => {
  it('turns crockery into cooking durability and spends one use to add a second food unit', () => {
    const { sim, home, carrier } = setup();
    expect(deliver(sim, carrier, home, CROCKERY)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(100);
    expect(homeQualityView(sim.snapshot(), home)).toEqual({ cooking: 100, rest: 0, piety: 0 });

    expect(deliver(sim, carrier, home, FOOD)).toBe(1);
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(2);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(95);
  });

  it('spends furniture durability on a positive rest event and doubles its recovery', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, FURNITURE);
    const settler = sim.world.create();
    addPerson(sim.world, settler, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: ONE,
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(settler, Residence, { home });
    sim.world.add(settler, Resting, { at: home });

    applyAtomicNeedEvents(sim.world, ctxOf(sim), settler, {
      atomicId: 8,
      elapsed: 1,
      effect: { kind: 'sleep' },
    });

    expect(sim.world.get(settler, Settler).fatigue).toBe(applyNeedUnits(ONE, 2000));
    expect(sim.world.get(home, HomeQuality).rest).toBe(95);
  });

  it('stores oil on a mature home and burns three points each game-second pass', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, OIL);
    expect(sim.world.get(home, HomeQuality).piety).toBe(1000);
    drainHolyOil(sim.world, ctxOf(sim));
    expect(sim.world.get(home, HomeQuality).piety).toBe(997);
  });

  it('does not request sacred oil until the home reaches zero-based level two', () => {
    const { sim, home, carrier } = setup();
    sim.world.mut(home, Building).level = 1;
    const woman = sim.world.create();
    addPerson(sim.world, woman, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    expect(demandedHomeQualityGoods(sim.world, ctxOf(sim), woman, home)).toEqual(
      new Set([CROCKERY, FURNITURE]),
    );
    expect(deliver(sim, carrier, home, OIL)).toBe(0);
    sim.world.mut(home, Building).level = 2;
    expect(demandedHomeQualityGoods(sim.world, ctxOf(sim), woman, home)).toEqual(
      new Set([CROCKERY, FURNITURE, OIL]),
    );
  });

  it('lets a religious resident pray at home while its sacred fire has oil', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, OIL);
    const settler = sim.world.create();
    addPerson(sim.world, settler, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: ONE,
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(settler, Residence, { home });
    sim.world.add(settler, Resting, { at: home });

    expect(planHomeTopUp(sim.world, ctxOf(sim), settler, sim.world.get(settler, Settler))).toBe(true);
    expect(sim.world.get(settler, CurrentAtomic).effect.kind).toBe('pray');
  });

  it('does not let a low-tier home use a seeded oil pool', () => {
    const { sim, home } = setup();
    sim.world.mut(home, Building).level = 1;
    sim.world.add(home, HomeQuality, { cooking: 0, rest: 0, piety: 1000 });
    const settler = sim.world.create();
    addPerson(sim.world, settler, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: ONE,
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(settler, Residence, { home });
    sim.world.add(settler, Resting, { at: home });

    expect(planHomeTopUp(sim.world, ctxOf(sim), settler, sim.world.get(settler, Settler))).toBe(false);
    drainHolyOil(sim.world, ctxOf(sim));
    expect(sim.world.get(home, HomeQuality).piety).toBe(1000);
  });

  it('forbids demand, delivery, and use without consuming the existing pools, then resumes', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, CROCKERY);
    deliver(sim, carrier, home, FURNITURE);
    deliver(sim, carrier, home, OIL);

    toggle(sim, home, 'cooking', false);
    toggle(sim, home, 'rest', false);
    toggle(sim, home, 'piety', false);
    expect(homeQualityPolicyView(sim.snapshot(), home)).toEqual({
      cooking: false,
      rest: false,
      piety: false,
    });
    expect(spendHomeQuality(sim.world, home, 'cooking', 5)).toBe(false);
    expect(spendHomeQuality(sim.world, home, 'rest', 5)).toBe(false);
    expect(homeQualityActive(sim.world, ctxOf(sim), home, 'piety')).toBe(false);
    expect(sim.world.get(home, HomeQuality)).toEqual({ cooking: 100, rest: 100, piety: 1000 });

    const foodCarrier = sim.world.create();
    expect(deliver(sim, foodCarrier, home, FOOD)).toBe(1);
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(100);

    const sleeper = sim.world.create();
    addPerson(sim.world, sleeper, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: ONE,
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(sleeper, Residence, { home });
    sim.world.add(sleeper, Resting, { at: home });
    applyAtomicNeedEvents(sim.world, ctxOf(sim), sleeper, {
      atomicId: 8,
      elapsed: 1,
      effect: { kind: 'sleep' },
    });
    expect(sim.world.get(sleeper, Settler).fatigue).toBe(applyNeedUnits(ONE, 1000));
    expect(sim.world.get(home, HomeQuality).rest).toBe(100);

    const blocked = sim.world.create();
    expect(deliver(sim, blocked, home, CROCKERY)).toBe(0);
    expect(sim.world.get(blocked, Carrying)).toEqual({ goodType: CROCKERY, amount: 1 });

    toggle(sim, home, 'cooking', true);
    expect(deliver(sim, blocked, home, CROCKERY)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(200);
  });

  it('persists policy and rejects foreign, unfinished, and non-home targets', () => {
    const { sim, home } = setup();
    toggle(sim, home, 'rest', false);
    const saved = exportSaveGame(sim);
    const restored = restoreSimulation(saved, { content: content() });
    expect(homeQualityPolicyView(restored.snapshot(), home)?.rest).toBe(false);

    toggle(sim, home, 'rest', true, 1);
    expect(sim.world.get(home, HomeQualityPolicy).rest).toBe(false);

    const unfinished = sim.world.create();
    sim.world.add(unfinished, Building, { buildingType: HOME, tribe: TRIBE, built: fx.fromInt(0), level: 2 });
    sim.world.add(unfinished, Owner, { player: 0 });
    toggle(sim, unfinished, 'cooking', false);
    expect(sim.world.has(unfinished, HomeQualityPolicy)).toBe(false);

    const nonHome = sim.world.create();
    sim.world.add(nonHome, Building, { buildingType: 999, tribe: TRIBE, built: ONE, level: 2 });
    sim.world.add(nonHome, Owner, { player: 0 });
    toggle(sim, nonHome, 'cooking', false);
    expect(sim.world.has(nonHome, HomeQualityPolicy)).toBe(false);
  });

  it('drops a forbidden in-flight household good and does not immediately fetch it again', () => {
    const { sim, home } = setup();
    toggle(sim, home, 'rest', false);
    const woman = sim.world.create();
    addPerson(sim.world, woman, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
      experience: new Map(),
    });
    sim.world.add(woman, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(woman, Residence, { home });
    sim.world.add(woman, Carrying, { goodType: FURNITURE, amount: 1 });
    expect(
      planWomanHoard(
        sim.world,
        ctxOf(sim),
        undefined,
        woman,
        new ExternalFoodIndex(sim.world, ctxOf(sim), undefined),
        new ExternalQualityIndex(sim.world, ctxOf(sim), undefined),
        null,
      ),
    ).toBe(true);
    expect(sim.world.get(woman, CurrentAtomic).effect.kind).toBe('drop');
    for (let i = 0; i < 4; i++) atomicSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(woman, Carrying)).toBe(false);
    expect(
      [...sim.world.query(Stockpile, Position)]
        .filter((e) => e !== home)
        .reduce((total, e) => total + (sim.world.get(e, Stockpile).amounts.get(FURNITURE) ?? 0), 0),
    ).toBe(1);
    expect(
      planWomanHoard(
        sim.world,
        ctxOf(sim),
        undefined,
        woman,
        new ExternalFoodIndex(sim.world, ctxOf(sim), undefined),
        new ExternalQualityIndex(sim.world, ctxOf(sim), undefined),
        null,
      ),
    ).toBe(false);
  });

  it('rejects an unknown household effect at the command parse boundary', () => {
    expect(() =>
      parseCommandEnvelope({
        v: 1,
        origin: 'player',
        player: 0,
        command: { kind: 'setHomeQualityUse', home: 1, effect: 'lighting', allowed: false },
      }),
    ).toThrow('envelope.command.effect: expected one of cooking, rest, piety');
  });
});
