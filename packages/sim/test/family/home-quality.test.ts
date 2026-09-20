import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  HomeQuality,
  Residence,
  Resting,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, homeQualityView, ONE, Simulation } from '../../src/index.js';
import { demandedHomeQualityGoods, drainHolyOil } from '../../src/systems/family/home-quality.js';
import { applyNeedUnits } from '../../src/systems/lifecycle/needs/index.js';
import { pileupIntoStore } from '../../src/systems/settlers/atomics/effects/goods/transfer.js';
import { applyAtomicNeedEvents } from '../../src/systems/settlers/atomics/effects/need-events.js';
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
  const carrier = sim.world.create();
  return { sim, home, carrier };
}

function deliver(sim: Simulation, carrier: Entity, home: Entity, goodType: number): number {
  sim.world.add(carrier, Carrying, { goodType, amount: 1 });
  return pileupIntoStore(sim.world, ctxOf(sim), carrier, home);
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
});
