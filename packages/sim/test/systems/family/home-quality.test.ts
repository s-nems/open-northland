import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  Health,
  HomeQuality,
  Owner,
  Position,
  Residence,
  Resting,
  Settler,
  Stockpile,
  setStockAmount,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import {
  exportSaveGame,
  fx,
  homeQualityView,
  householdGoodPolicyView,
  ONE,
  parseCommandEnvelope,
  playerCommand,
  restoreSimulation,
  Simulation,
} from '../../../src/index.js';
import { ExternalFoodIndex } from '../../../src/systems/family/food-search.js';
import { planWomanHoard } from '../../../src/systems/family/hoard.js';
import {
  demandedHomeQualityGoods,
  drainHolyOil,
  homeFamilyCapacity,
  homeQualityActive,
  homeQualityAllowed,
  setHouseholdGoodUse,
  spendHomeQuality,
} from '../../../src/systems/family/home-quality.js';
import { familyCountOf, moveFamilyInto } from '../../../src/systems/family/households.js';
import { ExternalQualityIndex } from '../../../src/systems/family/quality-search.js';
import { pileupIntoStore } from '../../../src/systems/settlers/atomics/effects/goods/transfer.js';
import { atomicSystem } from '../../../src/systems/settlers/atomics/system.js';
import { planHomeTopUp } from '../../../src/systems/settlers/drives/at-home.js';
import { collectSupplyTally } from '../../../src/systems/stores/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf, nextTickCtxOf } from '../../fixtures/context.js';

const FOOD = 1;
const CROCKERY = 2;
const FURNITURE = 3;
/** More stores than the quality index scans linearly, so it searches its node buckets. */
const RING_SEARCHED_STORES = 70;
const OIL = 4;
const HOME = 1;
/** A temple that burns its store of oil, which no household may take. */
const TEMPLE = 2;
const TEMPLE_OIL_CAPACITY = 5;
const JOB = 1;
const TRIBE = 1;
const SLEEP_ATOMIC = 8;
/** Quality points one delivered piece of furniture adds. */
const FURNITURE_PIECE = 1000;

/** The extra families the fixture's home takes while furnished: the spare pieces it stores. */
const FURNISHED_FAMILIES = 2;

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
          effect: 'lodging',
          deliveryValue: FURNITURE_PIECE,
          minimumHomeLevel: 0,
          wear: { child: 100, sleep: 10, meal: 10 },
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
      {
        typeId: HOME,
        id: 'home',
        kind: 'home',
        homeSize: 1,
        furnishedFamilies: FURNISHED_FAMILIES,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
      {
        typeId: TEMPLE,
        id: 'work_temple',
        kind: 'workplace',
        prayerSite: 'temple',
        stock: [{ goodType: OIL, capacity: TEMPLE_OIL_CAPACITY }],
      },
    ],
    tribes: [
      {
        typeId: TRIBE,
        id: 'viking',
        jobEnables: [{ jobType: JOB, kind: 'job', targetId: JOB }],
        atomicBindings: [
          { jobType: JOB, atomicId: SLEEP_ATOMIC, animation: 'civilist_sleep' },
          { jobType: JOB, atomicId: 12, animation: 'civilist_pray' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'civilist_sleep', name: 'civilist_sleep', length: 2, events: [{ at: 0, type: 1, value: 1000 }] },
      { id: 'civilist_pray', name: 'civilist_pray', length: 2, events: [{ at: 0, type: 4, value: 1000 }] },
    ],
  });
}

/** Player 0 with one mature home; holy oil is switched on unless `oilAllowed` is false. */
function setup(oilAllowed = true): { sim: Simulation; home: Entity; carrier: Entity } {
  const sim = new Simulation({ seed: 1, content: content() });
  const home = addHome(sim, 0, 2);
  const carrier = sim.world.create();
  if (oilAllowed) setHouseholdGoodUse(sim.world, ctxOf(sim), { player: 0, effect: 'piety', allowed: true });
  return { sim, home, carrier };
}

function addHome(sim: Simulation, player: number, level: number): Entity {
  const home = sim.world.create();
  sim.world.add(home, Building, { buildingType: HOME, tribe: TRIBE, built: ONE, level });
  sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 0]]) });
  sim.world.add(home, Owner, { player });
  return home;
}

/** An unmarried grown settler of player 0: a family of its own. */
function adult(sim: Simulation): Entity {
  const e = sim.world.create();
  addPerson(sim.world, e, {
    tribe: TRIBE,
    jobType: JOB,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: 0 });
  return e;
}

function deliver(sim: Simulation, carrier: Entity, home: Entity, goodType: number): number {
  sim.world.add(carrier, Carrying, { goodType, amount: 1 });
  return pileupIntoStore(sim.world, ctxOf(sim), carrier, home);
}

function toggle(
  sim: Simulation,
  effect: 'cooking' | 'lodging' | 'piety',
  allowed: boolean,
  player = 0,
): void {
  sim.enqueue(playerCommand(player, { kind: 'setHouseholdGoodUse', player, effect, allowed }));
  sim.step();
}

describe('household quality goods', () => {
  it('turns crockery into cooking durability and spends one use to add a second food unit', () => {
    const { sim, home, carrier } = setup();
    expect(deliver(sim, carrier, home, CROCKERY)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(100);
    expect(homeQualityView(sim.snapshot(), home)).toEqual({ cooking: 100, lodging: 0, piety: 0 });

    expect(deliver(sim, carrier, home, FOOD)).toBe(1);
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(2);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(95);
  });

  it('takes one extra family per stored piece of furniture while its owner allows it', () => {
    const { sim, home, carrier } = setup();
    const type = sim.content.buildings.find((b) => b.typeId === HOME);
    if (type === undefined) throw new Error('fixture home type missing');
    const [first, second, third] = [adult(sim), adult(sim), adult(sim)];
    const moveIn = (): void => {
      for (const e of [first, second, third]) moveFamilyInto(sim.world, ctxOf(sim), e, home);
    };
    moveIn();
    expect(familyCountOf(sim.world, home)).toBe(type.homeSize);

    deliver(sim, carrier, home, FURNITURE);
    moveIn();
    expect(familyCountOf(sim.world, home)).toBe(type.homeSize + 1);

    setHouseholdGoodUse(sim.world, ctxOf(sim), { player: 0, effect: 'lodging', allowed: false });
    expect(homeFamilyCapacity(sim.world, ctxOf(sim), home, type)).toBe(type.homeSize);
  });

  it('stores one spare piece per extra family it takes, and restocks whenever one is missing', () => {
    const { sim, home, carrier } = setup();
    const resident = adult(sim);
    const wanted = () => demandedHomeQualityGoods(sim.world, ctxOf(sim), resident, home).has(FURNITURE);
    for (let i = 0; i < FURNISHED_FAMILIES; i++) {
      expect(wanted()).toBe(true);
      expect(deliver(sim, carrier, home, FURNITURE)).toBe(1);
      sim.world.remove(carrier, Carrying);
    }
    expect(wanted()).toBe(false);
    expect(deliver(sim, carrier, home, FURNITURE)).toBe(0);
    expect(sim.world.get(home, HomeQuality).lodging).toBe(FURNISHED_FAMILIES * FURNITURE_PIECE);
  });

  it('takes furniture only as a whole piece, so a second delivery is not lost to the cap', () => {
    const { sim, home, carrier } = setup();
    const worn = FURNITURE_PIECE - 10;
    sim.world.add(home, HomeQuality, { cooking: 0, lodging: worn, piety: 0 });
    expect(deliver(sim, carrier, home, FURNITURE)).toBe(1);
    sim.world.remove(carrier, Carrying);
    expect(deliver(sim, carrier, home, FURNITURE)).toBe(0);
    expect(sim.world.get(home, HomeQuality).lodging).toBe(worn + FURNITURE_PIECE);
  });

  it('stores oil on a mature home and burns three points each game-second pass', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, OIL);
    expect(sim.world.get(home, HomeQuality).piety).toBe(1000);
    drainHolyOil(sim.world, ctxOf(sim));
    expect(sim.world.get(home, HomeQuality).piety).toBe(997);
  });

  it.each([1, 2, 3, 999, 1000, 3000])(
    'burns %i oil to zero in a damaged home with deliveries forbidden',
    (oil) => {
      const { sim, home } = setup(false);
      sim.world.add(home, HomeQuality, { cooking: 0, lodging: 0, piety: oil });
      sim.world.add(home, Health, { hitpoints: 50, max: 100 });
      for (let i = 0; i < Math.ceil(oil / 3); i++) drainHolyOil(sim.world, ctxOf(sim));
      expect(sim.world.get(home, HomeQuality).piety).toBe(0);
      expect(homeQualityActive(sim.world, ctxOf(sim), home, 'piety')).toBe(false);
    },
  );

  it('starts every player with holy oil off: no demand, no delivery, no fire', () => {
    const { sim, home, carrier } = setup(false);
    const woman = sim.world.create();
    addPerson(sim.world, woman, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    expect(householdGoodPolicyView(sim.snapshot(), 0)).toEqual({
      cooking: true,
      lodging: true,
      piety: false,
    });
    expect(demandedHomeQualityGoods(sim.world, ctxOf(sim), woman, home)).toEqual(
      new Set([CROCKERY, FURNITURE]),
    );
    expect(deliver(sim, carrier, home, OIL)).toBe(0);

    toggle(sim, 'piety', true);
    expect(deliver(sim, carrier, home, OIL)).toBe(1);
    expect(homeQualityActive(sim.world, ctxOf(sim), home, 'piety')).toBe(true);
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

  it('does not keep a resident indoors to pray at its burning fire', () => {
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
    });
    sim.world.add(settler, Residence, { home, since: 0 });
    sim.world.add(settler, Resting, { at: home });

    expect(
      planHomeTopUp(
        sim.world,
        ctxOf(sim),
        settler,
        sim.world.get(settler, Settler),
        collectSupplyTally(sim.world),
      ),
    ).toBe(false);
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
  });

  it('does not let a low-tier home use a seeded oil pool', () => {
    const { sim, home } = setup();
    sim.world.mut(home, Building).level = 1;
    sim.world.add(home, HomeQuality, { cooking: 0, lodging: 0, piety: 1000 });
    const settler = sim.world.create();
    addPerson(sim.world, settler, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: ONE,
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(settler, Residence, { home, since: 0 });
    sim.world.add(settler, Resting, { at: home });

    expect(
      planHomeTopUp(
        sim.world,
        ctxOf(sim),
        settler,
        sim.world.get(settler, Settler),
        collectSupplyTally(sim.world),
      ),
    ).toBe(false);
    drainHolyOil(sim.world, ctxOf(sim));
    expect(sim.world.get(home, HomeQuality).piety).toBe(1000);
  });

  it('forbids demand, delivery, and use without consuming the existing pools, then resumes', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, CROCKERY);
    deliver(sim, carrier, home, FURNITURE);
    deliver(sim, carrier, home, OIL);

    toggle(sim, 'cooking', false);
    toggle(sim, 'lodging', false);
    toggle(sim, 'piety', false);
    expect(householdGoodPolicyView(sim.snapshot(), 0)).toEqual({
      cooking: false,
      lodging: false,
      piety: false,
    });
    expect(spendHomeQuality(sim.world, home, 'cooking', 5)).toBe(false);
    expect(spendHomeQuality(sim.world, home, 'lodging', 5)).toBe(false);
    expect(homeQualityActive(sim.world, ctxOf(sim), home, 'piety')).toBe(true);
    expect(sim.world.get(home, HomeQuality)).toEqual({ cooking: 100, lodging: FURNITURE_PIECE, piety: 1000 });

    const foodCarrier = sim.world.create();
    expect(deliver(sim, foodCarrier, home, FOOD)).toBe(1);
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(100);

    const blocked = sim.world.create();
    expect(deliver(sim, blocked, home, CROCKERY)).toBe(0);
    expect(sim.world.get(blocked, Carrying)).toEqual({ goodType: CROCKERY, amount: 1 });

    toggle(sim, 'cooking', true);
    expect(deliver(sim, blocked, home, CROCKERY)).toBe(1);
    expect(sim.world.get(home, HomeQuality).cooking).toBe(200);
  });

  it('keeps burning stored oil after deliveries are forbidden', () => {
    const { sim, home, carrier } = setup();
    deliver(sim, carrier, home, OIL);
    toggle(sim, 'piety', false);
    drainHolyOil(sim.world, { ...ctxOf(sim), tick: 12 });
    expect(sim.world.get(home, HomeQuality).piety).toBe(997);
    expect(homeQualityActive(sim.world, ctxOf(sim), home, 'piety')).toBe(true);
    expect(deliver(sim, sim.world.create(), home, OIL)).toBe(0);
  });

  it('persists one player policy across their existing and future homes while isolating other players', () => {
    const { sim, home } = setup();
    const existing = addHome(sim, 0, 0);
    const otherPlayer = addHome(sim, 1, 2);
    toggle(sim, 'lodging', false);
    const future = addHome(sim, 0, 1);
    expect(homeQualityAllowed(sim.world, home, 'lodging')).toBe(false);
    expect(homeQualityAllowed(sim.world, existing, 'lodging')).toBe(false);
    expect(homeQualityAllowed(sim.world, future, 'lodging')).toBe(false);
    expect(homeQualityAllowed(sim.world, otherPlayer, 'lodging')).toBe(true);

    const saved = exportSaveGame(sim);
    const restored = restoreSimulation(saved, { content: content() });
    expect(householdGoodPolicyView(restored.snapshot(), 0).lodging).toBe(false);

    sim.enqueue(
      playerCommand(1, { kind: 'setHouseholdGoodUse', player: 0, effect: 'lodging', allowed: true }),
    );
    sim.step();
    expect(householdGoodPolicyView(sim.snapshot(), 0).lodging).toBe(false);
  });

  it('drops a forbidden in-flight household good and does not immediately fetch it again', () => {
    const { sim, home } = setup();
    toggle(sim, 'lodging', false);
    const woman = sim.world.create();
    addPerson(sim.world, woman, {
      tribe: TRIBE,
      jobType: JOB,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    });
    sim.world.add(woman, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(woman, Residence, { home, since: 0 });
    sim.world.add(woman, Carrying, { goodType: FURNITURE, amount: 1 });
    expect(
      planWomanHoard(
        sim.world,
        ctxOf(sim),
        undefined,
        woman,
        new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)),
        new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)),
        collectSupplyTally(sim.world),
        null,
      ),
    ).toBe(true);
    expect(sim.world.get(woman, CurrentAtomic).effect.kind).toBe('drop');
    for (let i = 0; i < 4; i++) atomicSystem(sim.world, nextTickCtxOf(sim));
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
        new ExternalFoodIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)),
        new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)),
        collectSupplyTally(sim.world),
        null,
      ),
    ).toBe(false);
  });

  it('searches many stores by ring, following each change to the stocked list', () => {
    const { sim } = setup();
    const stores: Entity[] = [];
    for (let i = 0; i < RING_SEARCHED_STORES; i++) {
      const store = sim.world.create();
      sim.world.add(store, Position, { x: fx.fromInt(i + 1), y: fx.fromInt(0) });
      sim.world.add(store, Stockpile, { amounts: new Map([[FURNITURE, 1]]) });
      stores.push(store);
    }
    const demanded = new Set([FURNITURE]);
    const nearest = () =>
      new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world)).nearest(
        { hx: 0, hy: 0 },
        undefined,
        demanded,
        null,
      )?.store;

    const [first, second] = stores;
    if (first === undefined || second === undefined) throw new Error('fixture stores missing');

    setStockAmount(sim.world, first, FURNITURE, 0);
    expect(nearest()).toBe(second);
    expect(nearest()).toBe(second);
    setStockAmount(sim.world, first, FURNITURE, 1);
    expect(nearest()).toBe(first);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('passes over a store destroyed after the pass caught its sources up', () => {
    const { sim } = setup();
    const stores = [1, 5].map((x) => {
      const store = sim.world.create();
      sim.world.add(store, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
      sim.world.add(store, Stockpile, { amounts: new Map([[FURNITURE, 1]]) });
      return store;
    });
    const index = new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world));
    sim.world.destroy(stores[0] as Entity);

    expect(index.nearest({ hx: 0, hy: 0 }, undefined, new Set([FURNITURE]), null)?.store).toBe(stores[1]);
  });

  it("never offers a temple's oil, which its fire burns", () => {
    const { sim } = setup();
    const temple = sim.world.create();
    sim.world.add(temple, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
    sim.world.add(temple, Building, { buildingType: TEMPLE, tribe: TRIBE, built: ONE, level: 0 });
    sim.world.add(temple, Stockpile, { amounts: new Map([[OIL, TEMPLE_OIL_CAPACITY]]) });
    const index = new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world));

    expect(index.nearest({ hx: 0, hy: 0 }, undefined, new Set([OIL]), null)).toBeNull();
  });

  it('offers the lowest-id demanded quality good whatever order the store was stocked in', () => {
    const stocked: Array<[number, number]> = [
      [FURNITURE, 1],
      [FOOD, 3],
      [CROCKERY, 1],
    ];
    for (const lines of [stocked, [...stocked].reverse()]) {
      const { sim } = setup();
      const store = sim.world.create();
      sim.world.add(store, Position, { x: fx.fromInt(2), y: fx.fromInt(0) });
      sim.world.add(store, Stockpile, { amounts: new Map(lines) });
      const index = new ExternalQualityIndex(sim.world, ctxOf(sim), undefined, collectSupplyTally(sim.world));
      const from = { hx: 0, hy: 0 };
      expect(index.nearest(from, undefined, new Set([CROCKERY, FURNITURE]), null)?.goodType).toBe(CROCKERY);
      expect(index.nearest(from, undefined, new Set([FURNITURE, OIL]), null)?.goodType).toBe(FURNITURE);
      expect(index.nearest(from, undefined, new Set([OIL]), null)).toBeNull();
    }
  });

  it('rejects an unknown household effect at the command parse boundary', () => {
    expect(() =>
      parseCommandEnvelope({
        v: 2,
        origin: 'player',
        player: 0,
        command: { kind: 'setHouseholdGoodUse', player: 0, effect: 'lighting', allowed: false },
      }),
    ).toThrow(/effect/);
  });
});
