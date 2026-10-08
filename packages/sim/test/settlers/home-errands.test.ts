import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  Building,
  CurrentAtomic,
  MISSION_BEHAVIOUR,
  MoveGoal,
  Owner,
  PickupClaim,
  Position,
  Residence,
  Resting,
  Stockpile,
  setMissionBehaviour,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { cellAnchorNode, type Fixed, fx, type NodeId, ONE, Simulation } from '../../src/index.js';
import { ATOMIC_EVENT_CHANNEL, needBar, plannerSystem } from '../../src/systems/index.js';
import { HOME_ERRAND_RANGE_NODES, isServedAtHome } from '../../src/systems/settlers/drives/home-errands.js';
import { noteUnreachableGoal } from '../../src/systems/settlers/unreachable-goals.js';
import { manhattan } from '../../src/systems/spatial/metric.js';
import { testContent } from '../fixtures/content.js';
import { needsOf } from '../fixtures/settler.js';
import { ctxOf, grassMap, justAbove, NEED_DRIVE_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * The SLEEP-AT-HOME rung: a settler with a built house walks to its door, goes inside (hidden by the
 * `Resting` marker), sleeps the same clip it sleeps outdoors, and steps back out rested. The homeless
 * keep the open-ground rule (`rest-spot.ts`). What the nap is worth at home is `need-events.test.ts`'s.
 */

const VIKING = 1;
const HOME_TYPE = 90;
const FOOD = 3; // the fixture's `food_simple`
const TRADER = 25; // the fixture's trade marked `ignoresHomeHouse`
const HEADQUARTERS = 1; // the fixture's store with a food slot
const SLEEP_TICKS = 6; // the fixture's "viking_sleep" length
/** The `logicSoundType` the fixture's sleep clip sounds (`event <at> 34 35`). */
const SNORE_SOUND = 35;
const TIRED: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
const HUNGRY: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
/** The fixture eat clip's length and its one meal (`viking_eat`, `event 3 2 +4000`). */
const EAT_TICKS = 5;
const MEAL_UNITS = 4000;
/** A meal at home counts double (`need-events.test.ts`). */
const HOME_MEAL_UNITS = 2 * MEAL_UNITS;
/** A strip wide enough for a door past the signpost walk range: 50 hex nodes, 25 tiles east of the
 *  settler with no signpost to extend it. */
const CONFINED_MAP_WIDTH = 64;
const OUT_OF_AREA = 40;
const PLAYER = 0;
/** A strip long enough for a home past {@link HOME_ERRAND_RANGE_NODES}: a settler on cell 1 and a home on
 *  cell 30 stand 58 half-cell nodes apart, and a store on cell 38 farther still. */
const FAR_MAP_WIDTH = 40;
const FAR_HOME = 30;
const FARTHER_STORE = 38;
/** Half a bar spent: under the drive trigger, over the level a served need sits at, so only the at-home
 *  chain answers it. */
const HALF_SPENT: Fixed = fx.div(ONE, fx.fromInt(2));

/** The shared fixture plus a `home` building type; `restfulBed: false` strips the sleep clip's rest
 *  pulses. */
function homeContent({ restfulBed = true } = {}): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      // The larder slot is what lets the at-home chain feed the sleeper as well as rest it.
      {
        typeId: HOME_TYPE,
        id: 'home_small',
        kind: 'home',
        homeSize: 2,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
    ],
    atomicAnimations: base.atomicAnimations.map((clip) =>
      restfulBed || clip.name !== 'viking_sleep'
        ? clip
        : { ...clip, events: clip.events.filter((event) => event.type !== ATOMIC_EVENT_CHANNEL.REST) },
    ),
  });
}

function simWithHomes(content: ContentSet = homeContent(), width = 8): Simulation {
  return new Simulation({ seed: 1, content, map: grassMap(width, 6) });
}

/** A settler on cell (1, 2) whose home stands past {@link HOME_ERRAND_RANGE_NODES}, larder stocked. */
function farFromHome(needs: { hunger?: Fixed; fatigue?: Fixed }): { sim: Simulation; settler: Entity } {
  const sim = simWithHomes(homeContent(), FAR_MAP_WIDTH);
  const settler = needsSettlerAt(sim, 1, 2, needs);
  const home = homeAt(sim, FAR_HOME, 2);
  sim.world.add(settler, Residence, { home });
  stock(sim, home, 2);
  const door = nodeAt(sim, FAR_HOME, 2);
  const here = nodeAt(sim, 1, 2);
  if (door === undefined || here === undefined || sim.terrain === undefined)
    throw new Error('setup: no nodes');
  expect(manhattan(sim.terrain, here, door)).toBeGreaterThan(HOME_ERRAND_RANGE_NODES);
  return { sim, settler };
}

/** A built home of `tribe` standing on cell (x, y). */
function homeAt(sim: Simulation, x: number, y: number, tribe = VIKING): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME_TYPE, tribe, built: ONE, level: 0 });
  return e;
}

/** A headquarters store on cell (x, y) holding `food` units. */
function storeAt(sim: Simulation, x: number, y: number, food: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
  return e;
}

/** Fill `home`'s larder with `food` units. */
function stock(sim: Simulation, home: Entity, food: number): void {
  sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, food]]) });
}

function tiredAt(sim: Simulation, x: number, y: number): Entity {
  return needsSettlerAt(sim, x, y, { fatigue: TIRED });
}

/** The `logicSoundType` ids the sleeping settlers sound over `ticks` ticks. */
function cuesOverNap(sim: Simulation, ticks: number): number[] {
  const fired: number[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    for (const ev of sim.snapshot().events) if (ev.kind === 'atomicSound') fired.push(ev.soundType);
  }
  return fired;
}

function nodeAt(sim: Simulation, cx: number, cy: number): NodeId | undefined {
  const anchor = cellAnchorNode(cx, cy);
  return sim.terrain?.nodeAt(anchor.hx, anchor.hy);
}

describe('sleepAtHome - a housed settler goes to bed indoors', () => {
  it('sleeps inside on the spot, on its usual clip, when standing at its own door', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const home = homeAt(sim, 3, 2); // same cell - the settler is already on the door node
    sim.world.add(settler, Residence, { home });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    expect(sim.world.get(settler, Resting).at).toBe(home); // went in - the render hides it
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'sleep' });
    expect(atomic.duration).toBe(SLEEP_TICKS);
  });

  it("sounds its clip's cue indoors as it does in the open", () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home: homeAt(sim, 3, 2) });
    plannerSystem(sim.world, ctxOf(sim));
    expect(cuesOverNap(sim, SLEEP_TICKS)).toEqual([SNORE_SOUND]);

    const outside = simWithHomes();
    tiredAt(outside, 3, 2);
    plannerSystem(outside.world, ctxOf(outside));
    expect(cuesOverNap(outside, SLEEP_TICKS)).toEqual([SNORE_SOUND]);
  });

  it('walks to its own door rather than lying down where it stands', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 1, 2);
    const home = homeAt(sim, 5, 2);
    sim.world.add(settler, Residence, { home });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // still walking, not yet asleep
    expect(sim.world.has(settler, Resting)).toBe(false); // not inside until it arrives
    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 5, 2));
  });

  it('lies down where it stands when its home is too far to walk to', () => {
    const { sim, settler } = farFromHome({ fatigue: TIRED });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.tryGet(settler, MoveGoal)?.cell).not.toBe(nodeAt(sim, FAR_HOME, 2));
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'sleep' });
  });

  it('falls back to open ground for a homeless settler', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    homeAt(sim, 5, 2); // a house stands, but this settler does not live in it

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false); // slept outside, never went in
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'sleep' });
    expect(atomic.duration).toBe(SLEEP_TICKS);
  });

  it('falls back to open ground when the home is still a building site', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const site = homeAt(sim, 3, 2);
    sim.world.mut(site, Building).built = fx.div(ONE, fx.fromInt(2)); // half-raised - no roof yet
    sim.world.add(settler, Residence, { home: site });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).duration).toBe(SLEEP_TICKS);
  });

  it('beds a housed settler down outside when its trade never goes home', () => {
    // A worker housed with his family who then took up such a trade keeps the house but sleeps out,
    // as the original does for every trade `jobtypes.ini` marks `ignoresHomeHouseFlag`.
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 3, 2, { fatigue: TIRED }, TRADER);
    sim.world.add(settler, Residence, { home: homeAt(sim, 3, 2) });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).duration).toBe(SLEEP_TICKS);
  });

  it('gives up on a door its routes cannot reach, and beds down outside instead', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 1, 2);
    const home = homeAt(sim, 5, 2);
    sim.world.add(settler, Residence, { home });
    const door = nodeAt(sim, 5, 2);
    if (door === undefined) throw new Error('setup: the home has no door node');
    // The walled-in case: the route to the door has already failed, so the memo holds it. Without the
    // guard the rung re-picks the same door every re-plan and the settler never sleeps at all.
    noteUnreachableGoal(sim.world, ctxOf(sim), settler, door);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.world.get(settler, CurrentAtomic).duration).toBe(SLEEP_TICKS);
  });

  it('does not treat a homeless settler asleep outdoors as being indoors', () => {
    // A stale Resting marker (a FamilyDuty settler keeps one through a re-plan) plus the identical
    // `sleep` atomic the open-ground rung starts must NOT read as sleeping at home - that would hide a
    // settler asleep in a field behind a marker pointing at a workplace it waited in earlier.
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const someWorkplace = homeAt(sim, 6, 4);
    sim.world.add(settler, Resting, { at: someWorkplace }); // stale - this is not its home
    addCurrentAtomic(sim.world, settler, {
      atomicId: 8,
      duration: SLEEP_TICKS,
      effect: { kind: 'sleep' },
      targetEntity: settler,
      targetTile: null,
    });

    expect(isServedAtHome(sim.world, settler)).toBe(false);
  });

  it('comes back out rested - the marker is shed once the sleep completes', () => {
    const sim = simWithHomes();
    const settler = tiredAt(sim, 3, 2);
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });

    // Sample every tick: the settler must stay inside for the WHOLE nap and leave once. Asserting only
    // the end state would pass just as happily on a settler flickering in and out of its own door.
    const inside: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      sim.step();
      inside.push(sim.world.has(settler, Resting));
    }

    // One unbroken stay: false* then true* then false* - never a second entry.
    const entries = inside.filter((v, i) => v && inside[i - 1] !== true).length;
    expect(entries).toBe(1);
    expect(inside.filter(Boolean).length).toBeGreaterThanOrEqual(SLEEP_TICKS);
    expect(inside.at(-1)).toBe(false); // stepped back outside
    expect(needsOf(sim, settler).fatigue).toBeLessThan(TIRED); // and slept it off
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      const sim = simWithHomes();
      const settler = tiredAt(sim, 2, 2);
      const home = homeAt(sim, 4, 3);
      sim.world.add(settler, Residence, { home });
      for (let i = 0; i < 60; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});

describe('the at-home top-up - a settler home for one need serves the rest before it leaves', () => {
  it('eats from the family larder after its nap, and only then steps back outside', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 3, 2, { fatigue: TIRED, hunger: HALF_SPENT });
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });
    sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 2]]) });

    let ateIndoors = false;
    for (let i = 0; i < 60; i++) {
      sim.step();
      const atomic = sim.world.tryGet(settler, CurrentAtomic);
      if (atomic?.effect.kind === 'eat' && sim.world.tryGet(settler, Resting)?.at === home) {
        ateIndoors = true;
      }
    }

    expect(ateIndoors).toBe(true);
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(1); // one unit off the family shelf
    const fed = needsOf(sim, settler);
    expect(fed.hunger).toBeLessThan(HALF_SPENT); // and both bars came down before it left
    expect(fed.fatigue).toBeLessThan(TIRED);
    expect(sim.world.has(settler, Resting)).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('skips a round whose clip pays nothing and serves the meal it came home with', () => {
    const sim = simWithHomes(homeContent({ restfulBed: false }));
    const settler = needsSettlerAt(sim, 3, 2, { fatigue: TIRED, hunger: HALF_SPENT });
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });
    sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 2]]) });

    for (let i = 0; i < 60; i++) sim.step();

    // A bed that rests nobody would otherwise be re-served for good, with the meal never reached.
    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(1);
  });

  it('serves nothing once a script freezes the needs of a settler already indoors', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 3, 2, { fatigue: TIRED, hunger: HALF_SPENT });
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });
    sim.world.add(home, Stockpile, { amounts: new Map([[FOOD, 2]]) });
    sim.step(); // in bed
    expect(sim.world.tryGet(settler, Resting)?.at).toBe(home);

    // Frozen bars never move, so a round that serves them would repeat for good.
    setMissionBehaviour(sim.world, settler, MISSION_BEHAVIOUR.NEEDS_FROZEN, true);
    for (let i = 0; i < 60; i++) sim.step();

    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(2);
    expect(sim.world.has(settler, Resting)).toBe(false);
  });

  it('leaves an empty larder alone and goes back out on its nap alone', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 3, 2, { fatigue: TIRED, hunger: HALF_SPENT });
    sim.world.add(settler, Residence, { home: homeAt(sim, 3, 2) });

    for (let i = 0; i < 60; i++) sim.step();

    expect(needsOf(sim, settler).hunger).toBeGreaterThanOrEqual(HALF_SPENT); // nothing to eat
    expect(sim.world.has(settler, Resting)).toBe(false); // and it did not wait indoors for food
  });
});

describe('eatAtHome - a hungry settler eats off its own larder first', () => {
  it('walks home to eat even with a store nearer', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    const home = homeAt(sim, 6, 2);
    sim.world.add(settler, Residence, { home });
    stock(sim, home, 2);
    storeAt(sim, 2, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
  });

  it('eats at a nearer store when its home is too far to walk to', () => {
    const { sim, settler } = farFromHome({ hunger: HUNGRY });
    storeAt(sim, 6, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
  });

  it('still walks a far home when it holds the nearest food', () => {
    const { sim, settler } = farFromHome({ hunger: HUNGRY });
    storeAt(sim, FARTHER_STORE, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, FAR_HOME, 2));
  });

  it('still walks a far home when nothing else feeds it', () => {
    const { sim, settler } = farFromHome({ hunger: HUNGRY });

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, FAR_HOME, 2));
  });

  it("leaves the larder's last meal to the housemate already walking home for it", () => {
    const sim = simWithHomes();
    const first = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    const second = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    const home = homeAt(sim, 6, 2);
    sim.world.add(first, Residence, { home });
    sim.world.add(second, Residence, { home });
    stock(sim, home, 1);
    const store = storeAt(sim, 2, 2, 1);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(first, PickupClaim)).toEqual({ source: home, goodType: FOOD, amount: 1 });
    expect(sim.world.get(first, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
    expect(sim.world.get(second, PickupClaim)).toEqual({ source: store, goodType: FOOD, amount: 1 });
    expect(sim.world.get(second, MoveGoal).cell).toBe(nodeAt(sim, 2, 2));
  });

  it('eats indoors at its door, and the meal counts double', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 3, 2, { hunger: HUNGRY });
    const home = homeAt(sim, 3, 2);
    sim.world.add(settler, Residence, { home });
    stock(sim, home, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, Resting).at).toBe(home);
    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'eat', goodType: FOOD, from: home });
    for (let i = 0; i < EAT_TICKS; i++) sim.step();

    expect(sim.world.get(home, Stockpile).amounts.get(FOOD)).toBe(1);
    // Drain over the clip is a handful of units, far below the second meal's worth.
    expect(needsOf(sim, settler).hunger).toBeLessThan(
      fx.sub(HUNGRY, needBar(HOME_MEAL_UNITS - MEAL_UNITS / 2)),
    );
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('takes the nearest store when its trade never goes home', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY }, TRADER);
    const home = homeAt(sim, 2, 2);
    sim.world.add(settler, Residence, { home });
    stock(sim, home, 2);
    storeAt(sim, 6, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
  });

  it('takes the nearest store when its door lies outside its signpost area', () => {
    const sim = new Simulation({ seed: 1, content: homeContent(), map: grassMap(CONFINED_MAP_WIDTH, 6) });
    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.step();
    const settler = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    sim.world.add(settler, Owner, { player: PLAYER });
    const home = homeAt(sim, OUT_OF_AREA, 2);
    sim.world.add(settler, Residence, { home });
    stock(sim, home, 2);
    storeAt(sim, 6, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
  });

  it('takes the nearest store when its routes cannot reach its door', () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    const home = homeAt(sim, 6, 2);
    sim.world.add(settler, Residence, { home });
    stock(sim, home, 2);
    storeAt(sim, 3, 4, 2);
    const door = nodeAt(sim, 6, 2);
    if (door === undefined) throw new Error('setup: the home has no door node');
    noteUnreachableGoal(sim.world, ctxOf(sim), settler, door);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 3, 4));
  });

  it("takes the nearest store past an empty larder, and never another family's", () => {
    const sim = simWithHomes();
    const settler = needsSettlerAt(sim, 1, 2, { hunger: HUNGRY });
    sim.world.add(settler, Residence, { home: homeAt(sim, 2, 2) });
    stock(sim, homeAt(sim, 4, 2), 2); // the neighbours' larder
    storeAt(sim, 6, 2, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(nodeAt(sim, 6, 2));
  });
});
