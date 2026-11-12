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
  Lodgings,
  MakingLove,
  Marriage,
  Owner,
  Position,
  Residence,
  Resting,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import { fx, ONE, ZERO } from '../../../src/core/fixed.js';
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

/** A piece of furniture houses one family above a home's base size. Only that family's sleeps, meals and
 *  children wear it; a worn-out piece is replaced from the home's store, and with none there, or with
 *  furniture forbidden, the family moves out. */

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
/** Distinct per source, so a test reads which activity wore the piece. */
const CHILD_WEAR = 100;
const SLEEP_WEAR = 10;
const MEAL_WEAR = 7;
const PIECE = 1000;
const LARDER = 5;
/** Food the child session takes from the larder. */
const CHILD_FOOD = 2;

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

/** What is left of the pieces the home's extra families live on. */
function pieces(sim: Simulation, home: Entity): readonly number[] {
  return sim.world.tryGet(home, Lodgings)?.pieces ?? [];
}

function sleepAtHome(sim: Simulation, sleeper: Entity, home: Entity): boolean {
  sim.world.add(sleeper, Resting, { at: home });
  setNeeds(sim, sleeper, { fatigue: ONE, hunger: fx.fromInt(0) });
  return planHomeTopUp(
    sim.world,
    ctxOf(sim),
    sleeper,
    sim.world.get(sleeper, Settler),
    collectSupplyTally(sim.world),
  );
}

describe('furniture housing extra families', () => {
  it('wears for a sleep or a meal at home of an extra family only, off the piece it lives on', () => {
    const { sim, home } = setup();
    const base = single(sim, home, 0);
    single(sim, home, 1);
    const extra = single(sim, home, 2);

    expect(sleepAtHome(sim, base, home)).toBe(true);
    expect(lodging(sim, home)).toBe(PIECE);
    expect(pieces(sim, home)).toEqual([]);

    expect(sleepAtHome(sim, extra, home)).toBe(true);
    expect(lodging(sim, home)).toBe(0);
    expect(pieces(sim, home)).toEqual([PIECE - SLEEP_WEAR]);

    setNeeds(sim, extra, { fatigue: fx.fromInt(0), hunger: ONE });
    sim.world.mut(home, Stockpile).amounts.set(FOOD, LARDER);
    expect(
      planHomeTopUp(
        sim.world,
        ctxOf(sim),
        extra,
        sim.world.get(extra, Settler),
        collectSupplyTally(sim.world),
      ),
    ).toBe(true);
    expect(sim.world.get(extra, CurrentAtomic).effect.kind).toBe('eat');
    expect(pieces(sim, home)).toEqual([PIECE - SLEEP_WEAR - MEAL_WEAR]);
  });

  it('wears the child cost off the piece of an extra couple beginning to make a child', () => {
    const { sim, home } = setup();
    single(sim, home, 0);
    single(sim, home, 1);
    const { wife, husband } = couple(sim, home, 2);
    sim.world.add(wife, Resting, { at: home });
    sim.world.add(husband, Resting, { at: home });
    sim.world.add(wife, ChildOrder, { child: 'female' });
    sim.world.mut(home, Stockpile).amounts.set(FOOD, CHILD_FOOD);

    familySystem(sim.world, ctxOf(sim));

    expect(sim.world.get(home, MakingLove).wife).toBe(wife);
    expect(pieces(sim, home)).toEqual([PIECE - CHILD_WEAR]);
  });

  it('keeps one piece per extra family, each worn by its own family, the last to move in being extra', () => {
    const { sim, home } = setup();
    sim.world.mut(home, HomeQuality).lodging = FURNISHED_FAMILIES * PIECE;
    // The wife married into a household of tick 1; its own move-in tick stays the earliest.
    const old = couple(sim, home, 1, 50);
    const base = single(sim, home, 20);
    const first = single(sim, home, 30);
    const second = single(sim, home, 30);
    const ctx = ctxOf(sim);

    wearLodging(sim.world, ctx, home, old.wife, 'sleep');
    wearLodging(sim.world, ctx, home, base, 'sleep');
    expect(pieces(sim, home)).toEqual([]);

    wearLodging(sim.world, ctx, home, second, 'meal');
    wearLodging(sim.world, ctx, home, first, 'sleep');
    wearLodging(sim.world, ctx, home, first, 'sleep');

    expect(pieces(sim, home)).toEqual([PIECE - 2 * SLEEP_WEAR, PIECE - MEAL_WEAR]);
    expect(lodging(sim, home)).toBe(0);
  });

  it('replaces a worn-out piece from the store of the home', () => {
    const { sim, home } = setup();
    sim.world.mut(home, HomeQuality).lodging = PIECE;
    sim.world.add(home, Lodgings, { pieces: [SLEEP_WEAR - 1] });
    single(sim, home, 0);
    single(sim, home, 1);
    const extra = single(sim, home, 2);

    wearLodging(sim.world, ctxOf(sim), home, extra, 'sleep');

    expect(pieces(sim, home)).toEqual([PIECE]);
    expect(lodging(sim, home)).toBe(0);
    expect(movedOut(sim)).toEqual([]);
  });

  it('moves out the family whose piece wears out with none in store, and nobody else', () => {
    const { sim, home } = setup();
    sim.world.mut(home, HomeQuality).lodging = 0;
    const kept = PIECE - 1;
    sim.world.add(home, Lodgings, { pieces: [SLEEP_WEAR, kept] });
    const stays = [single(sim, home, 1), single(sim, home, 2)];
    const sleeper = single(sim, home, 3);
    const { wife, husband } = couple(sim, home, 4);
    expect(sleepAtHome(sim, sleeper, home)).toBe(true);

    expect(pieces(sim, home)).toEqual([kept]);
    expect(familyCountOf(sim.world, home)).toBe(BASE_FAMILIES + 1);
    for (const e of [...stays, wife, husband]) expect(sim.world.get(e, Residence).home).toBe(home);
    expect(sim.world.has(sleeper, Residence)).toBe(false);
    expect(sim.world.has(sleeper, Evicted)).toBe(true);
    // The evicted sleeper wakes and leaves the home it no longer has.
    expect(sim.world.has(sleeper, CurrentAtomic)).toBe(false);
    expect(sim.world.has(sleeper, Resting)).toBe(false);
    expect(sim.events.current().filter((ev) => ev.kind === 'familyMovedOut')).toEqual([
      { kind: 'familyMovedOut', entity: sleeper, home, player: PLAYER },
    ]);

    // The couple is now the first extra family and lives on the piece that is left.
    wearLodging(sim.world, ctxOf(sim), home, wife, 'meal');
    expect(pieces(sim, home)).toEqual([kept - MEAL_WEAR]);
  });

  it('moves a family onto a piece another family left behind before moving it out', () => {
    const { sim, home } = setup();
    sim.world.mut(home, HomeQuality).lodging = 0;
    const idle = PIECE - 1;
    sim.world.add(home, Lodgings, { pieces: [SLEEP_WEAR, idle] });
    single(sim, home, 0);
    single(sim, home, 1);
    const extra = single(sim, home, 2);

    wearLodging(sim.world, ctxOf(sim), home, extra, 'sleep');

    expect(pieces(sim, home)).toEqual([idle]);
    expect(sim.world.get(extra, Residence).home).toBe(home);
    expect(movedOut(sim)).toEqual([]);
  });

  it('keeps a couple whose child emptied its piece until its next sleep or meal', () => {
    const { sim, home } = setup();
    sim.world.mut(home, HomeQuality).lodging = 0;
    sim.world.add(home, Lodgings, { pieces: [CHILD_WEAR] });
    single(sim, home, 0);
    single(sim, home, 1);
    const { wife, husband } = couple(sim, home, 2);
    const ctx = ctxOf(sim);

    wearLodging(sim.world, ctx, home, wife, 'child');
    expect(pieces(sim, home)).toEqual([0]);
    expect(sim.world.get(wife, Residence).home).toBe(home);

    wearLodging(sim.world, ctx, home, husband, 'meal');
    expect(pieces(sim, home)).toEqual([]);
    expect(movedOut(sim)).toEqual([husband]);
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
    expect(homeFamilyCapacity(sim.world, ctxOf(sim), home, type)).toBe(BASE_FAMILIES);
    const late = single(sim, home, sim.tick);
    wearLodging(sim.world, ctxOf(sim), home, late, 'sleep');
    expect(lodging(sim, home)).toBe(PIECE);
    expect(pieces(sim, home)).toEqual([]);

    forbid(true);
    expect(homeFamilyCapacity(sim.world, ctxOf(sim), home, type)).toBe(BASE_FAMILIES + 1);
  });

  it('moves the extra families out of a home under upgrade when furniture is forbidden', () => {
    const { sim, home } = setup();
    const families = [single(sim, home, 0), single(sim, home, 1), single(sim, home, 2)];
    sim.world.mut(home, Building).built = ZERO;

    sim.enqueue(
      playerCommand(PLAYER, {
        kind: 'setHouseholdGoodUse',
        player: PLAYER,
        effect: 'lodging',
        allowed: false,
      }),
    );
    sim.step();

    expect(movedOut(sim)).toEqual([families[2]]);
  });
});
