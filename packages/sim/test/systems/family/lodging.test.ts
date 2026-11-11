import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  ChildOrder,
  CurrentAtomic,
  Evicted,
  Female,
  HomeQuality,
  MakingLove,
  Marriage,
  Owner,
  Position,
  Residence,
  Resting,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import { fx, ONE } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import { playerCommand, Simulation } from '../../../src/index.js';
import { homeFamilyCapacity } from '../../../src/systems/family/home-quality.js';
import { familyCountOf } from '../../../src/systems/family/households.js';
import { familySystem } from '../../../src/systems/family/index.js';
import { wearLodging } from '../../../src/systems/family/lodging.js';
import { planHomeTopUp } from '../../../src/systems/settlers/drives/at-home.js';
import { collectSupplyTally } from '../../../src/systems/stores/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';
import { setNeeds } from '../../fixtures/settler.js';

/** Furniture lets a home take extra families; their sleeps, meals and children wear it, and once it is
 *  gone or forbidden the families above the home's base size move out. */

const PLAYER = 0;
const TRIBE = 1;
const JOB = 1;
const WOMAN = 2;
const FOOD = 1;
const FURNITURE = 2;
const HOME = 1;
const BASE_FAMILIES = 2;
const FURNISHED_FAMILIES = 2;
const SLEEP_ATOMIC = 8;
const EAT_ATOMIC = 10;
const REST_CHANNEL = 1;
const HUNGER_CHANNEL = 2;
const CLIP_TICKS = 2;
const CLIP_PAYS = 1000;
/** Distinct per source, so a test reads which activity wore the pool. */
const CHILD_WEAR = 100;
const SLEEP_WEAR = 10;
const MEAL_WEAR = 7;
const PIECE = 1000;
const LARDER = 5;
/** Food the child session takes from the larder. */
const CHILD_FOOD = 2;
const LOVE_TICKS = 100;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: FOOD, id: 'food_simple' },
      {
        typeId: FURNITURE,
        id: 'furniture',
        homeQuality: {
          effect: 'lodging',
          deliveryValue: PIECE,
          capacity: 2 * PIECE,
          fetchBelow: PIECE,
          minimumHomeLevel: 0,
          wear: { child: CHILD_WEAR, sleep: SLEEP_WEAR, meal: MEAL_WEAR },
        },
      },
    ],
    jobs: [
      { typeId: JOB, id: 'civilist' },
      { typeId: WOMAN, id: 'woman' },
    ],
    buildings: [
      {
        typeId: HOME,
        id: 'home',
        kind: 'home',
        homeSize: BASE_FAMILIES,
        furnishedFamilies: FURNISHED_FAMILIES,
        stock: [{ goodType: FOOD, capacity: LARDER }],
      },
    ],
    tribes: [
      {
        typeId: TRIBE,
        id: 'viking',
        jobEnables: [{ jobType: JOB, kind: 'job', targetId: JOB }],
        atomicBindings: [
          { jobType: JOB, atomicId: SLEEP_ATOMIC, animation: 'civilist_sleep' },
          { jobType: JOB, atomicId: EAT_ATOMIC, animation: 'civilist_eat' },
        ],
      },
    ],
    atomicAnimations: [
      {
        id: 'civilist_sleep',
        name: 'civilist_sleep',
        length: CLIP_TICKS,
        events: [{ at: 0, type: REST_CHANNEL, value: CLIP_PAYS }],
      },
      {
        id: 'civilist_eat',
        name: 'civilist_eat',
        length: CLIP_TICKS,
        events: [{ at: 0, type: HUNGER_CHANNEL, value: CLIP_PAYS }],
      },
    ],
  });
}

function setup(): { sim: Simulation; home: Entity } {
  const sim = new Simulation({ seed: 1, content: content() });
  const home = sim.world.create();
  sim.world.add(home, Building, { buildingType: HOME, tribe: TRIBE, built: ONE, level: 0 });
  sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 0]]) });
  sim.world.add(home, Owner, { player: PLAYER });
  sim.world.add(home, HomeQuality, { cooking: 0, lodging: PIECE, piety: 0 });
  return { sim, home };
}

function person(sim: Simulation, female = false): Entity {
  const e = sim.world.create();
  addPerson(sim.world, e, {
    tribe: TRIBE,
    jobType: female ? WOMAN : JOB,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

/** A lone adult living in `home` since `since`: a family of its own. */
function single(sim: Simulation, home: Entity, since: number): Entity {
  const e = person(sim);
  sim.world.add(e, Residence, { home, since });
  return e;
}

/** A married couple living in `home`, the husband since `since` and the wife since `wifeSince`. */
function couple(
  sim: Simulation,
  home: Entity,
  since: number,
  wifeSince = since,
): { wife: Entity; husband: Entity } {
  const husband = person(sim);
  const wife = person(sim, true);
  sim.world.add(husband, Marriage, { spouse: wife, child: null });
  sim.world.add(wife, Marriage, { spouse: husband, child: null });
  sim.world.add(husband, Residence, { home, since });
  sim.world.add(wife, Residence, { home, since: wifeSince });
  return { wife, husband };
}

function lodging(sim: Simulation, home: Entity): number {
  return sim.world.get(home, HomeQuality).lodging;
}

/** The families `familyMovedOut` announced this tick, in order, by head. */
function movedOut(sim: Simulation): Entity[] {
  return sim.events.current().flatMap((ev) => (ev.kind === 'familyMovedOut' ? [ev.entity] : []));
}

describe('furniture housing extra families', () => {
  it('wears for a sleep or a meal at home only while the home holds more families than its base', () => {
    const { sim, home } = setup();
    const sleeper = single(sim, home, 0);
    single(sim, home, 0);
    sim.world.add(sleeper, Resting, { at: home });
    setNeeds(sim, sleeper, { fatigue: ONE });
    const topUp = () =>
      planHomeTopUp(
        sim.world,
        ctxOf(sim),
        sleeper,
        sim.world.get(sleeper, Settler),
        collectSupplyTally(sim.world),
      );

    expect(topUp()).toBe(true);
    expect(lodging(sim, home)).toBe(PIECE);

    single(sim, home, 0);
    expect(topUp()).toBe(true);
    expect(lodging(sim, home)).toBe(PIECE - SLEEP_WEAR);

    setNeeds(sim, sleeper, { fatigue: fx.fromInt(0), hunger: ONE });
    sim.world.mut(home, Stockpile).amounts.set(FOOD, LARDER);
    expect(topUp()).toBe(true);
    expect(sim.world.get(sleeper, CurrentAtomic).effect.kind).toBe('eat');
    expect(lodging(sim, home)).toBe(PIECE - SLEEP_WEAR - MEAL_WEAR);
  });

  it("wears the child cost as a crowded home's couple begins to make a child", () => {
    const { sim, home } = setup();
    const { wife, husband } = couple(sim, home, 0);
    single(sim, home, 0);
    single(sim, home, 0);
    sim.world.add(wife, Resting, { at: home });
    sim.world.add(husband, Resting, { at: home });
    sim.world.add(wife, ChildOrder, { child: 'female' });
    sim.world.mut(home, Stockpile).amounts.set(FOOD, CHILD_FOOD);

    familySystem(sim.world, ctxOf(sim));

    expect(sim.world.get(home, MakingLove).wife).toBe(wife);
    expect(lodging(sim, home)).toBe(PIECE - CHILD_WEAR);
  });

  it('empties the pool on a partial last payment and moves the families above base out', () => {
    const { sim, home } = setup();
    const stays = [single(sim, home, 1), single(sim, home, 2)];
    const sleeper = single(sim, home, 3);
    const { wife, husband } = couple(sim, home, 4);
    sim.world.add(sleeper, Resting, { at: home });
    setNeeds(sim, sleeper, { fatigue: ONE });
    planHomeTopUp(
      sim.world,
      ctxOf(sim),
      sleeper,
      sim.world.get(sleeper, Settler),
      collectSupplyTally(sim.world),
    );
    sim.world.mut(home, HomeQuality).lodging = SLEEP_WEAR - 1;

    wearLodging(sim.world, ctxOf(sim), home, 'sleep');

    expect(lodging(sim, home)).toBe(0);
    expect(familyCountOf(sim.world, home)).toBe(BASE_FAMILIES);
    expect(stays.map((e) => sim.world.get(e, Residence).home)).toEqual([home, home]);
    for (const e of [sleeper, wife, husband]) {
      expect(sim.world.has(e, Residence)).toBe(false);
      expect(sim.world.has(e, Evicted)).toBe(true);
    }
    // The evicted sleeper wakes and leaves the home it no longer has.
    expect(sim.world.has(sleeper, CurrentAtomic)).toBe(false);
    expect(sim.world.has(sleeper, Resting)).toBe(false);
    expect(movedOut(sim)).toEqual([husband, sleeper]);
    expect(sim.events.current().find((ev) => ev.kind === 'familyMovedOut')).toEqual({
      kind: 'familyMovedOut',
      entity: husband,
      home,
      player: PLAYER,
    });
  });

  it('moves out the family that moved in last first, sparing a couple making a child there', () => {
    const { sim, home } = setup();
    // The wife married into a household of tick 1; its own move-in tick stays the earliest.
    const old = couple(sim, home, 1, 50);
    const lovers = couple(sim, home, 40);
    const tiedLow = single(sim, home, 30);
    const tiedHigh = single(sim, home, 30);
    sim.world.add(home, MakingLove, { wife: lovers.wife, elapsed: 0, duration: LOVE_TICKS });
    sim.world.mut(home, HomeQuality).lodging = 1;

    wearLodging(sim.world, ctxOf(sim), home, 'meal');

    expect(movedOut(sim)).toEqual([tiedHigh, tiedLow]);
    expect(sim.world.get(old.wife, Residence).home).toBe(home);
    expect(sim.world.get(lovers.wife, Residence).home).toBe(home);
  });

  it('moves the extra families out at once when furniture is forbidden, and wears none while it is', () => {
    const { sim, home } = setup();
    const type = sim.content.buildings.find((b) => b.typeId === HOME);
    if (type === undefined) throw new Error('fixture home type missing');
    const families = [single(sim, home, 0), single(sim, home, 1), single(sim, home, 2)];
    const forbid = (allowed: boolean) => {
      sim.enqueue(
        playerCommand(PLAYER, { kind: 'setHouseholdGoodUse', player: PLAYER, effect: 'lodging', allowed }),
      );
      sim.step();
    };

    forbid(false);
    expect(movedOut(sim)).toEqual([families[2]]);
    expect(familyCountOf(sim.world, home)).toBe(BASE_FAMILIES);
    single(sim, home, sim.tick);
    wearLodging(sim.world, ctxOf(sim), home, 'sleep');
    expect(lodging(sim, home)).toBe(PIECE);

    forbid(true);
    expect(homeFamilyCapacity(sim.world, ctxOf(sim), home, type)).toBe(BASE_FAMILIES + FURNISHED_FAMILIES);
  });
});
