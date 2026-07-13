import { beforeEach, describe, expect, it } from 'vitest';
import {
  BerryBush,
  Building,
  CurrentAtomic,
  MoveGoal,
  Position,
  Resource,
  Settler,
  Stockpile,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { clearComponentStores } from '../../src/harness/stores.js';
import { type Fixed, fx, ONE, Simulation } from '../../src/index.js';
import {
  aiSystem,
  atomicSystem,
  BERRY_FORAGE_RADIUS,
  BERRY_REGROW_TICKS,
  berryGrowthSystem,
} from '../../src/systems/index.js';
import { testContent } from '../fixtures/content.js';
import { cellOf, ctxOf, grassMap, justAbove, NEED_THRESHOLD, needsSettlerAt } from './needs/support.js';

/**
 * Unit + integration tests for the FORAGE DRIVE — a hungry settler eating a wild {@link BerryBush} as the
 * eat drive's nearest-food fallback (the `forage` effect on the eat animation, id 10). A bush is wild
 * food anyone grazes: no job/tool, no stored good consumed. It regrows its one serving over
 * {@link BERRY_REGROW_TICKS} ticks (the BerryGrowthSystem). The eat drive picks the NEAREST food overall,
 * so a nearer store still wins over a farther bush (and vice-versa). Source basis for the bush cycle is on
 * the {@link BerryBush} component (the original's `landscapetypes.ini` bush transitions).
 */

const WOOD = 1;
const FOOD = 3;
const VIKING = 1;
const HEADQUARTERS = 1;
const EAT_ATOMIC = 10;
// Just over the ¾·ONE eat threshold — a settler this hungry seeks food before any work.
const HUNGRY: Fixed = justAbove(NEED_THRESHOLD);

beforeEach(clearComponentStores);

function settlerAt(sim: Simulation, x: number, y: number, hunger: Fixed): Entity {
  return needsSettlerAt(sim, x, y, { hunger });
}

/** A berry bush at (x,y), ripe by default (bare = regrowing, with `ripeAtTick` scheduled). */
function bushAt(sim: Simulation, x: number, y: number, ripe = true, ripeAtTick = 0): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, BerryBush, { ripe, ripeAtTick });
  return e;
}

/** A headquarters store at (x,y), pre-stocked with `food` units of food. */
function storeAt(sim: Simulation, x: number, y: number, food: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, food]]) });
  return e;
}

describe('forageDrive — the planner choosing to forage a wild bush', () => {
  it('forages a ripe bush it is standing on when hungry and no store is nearer', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, HUNGRY);
    const bush = bushAt(sim, 2, 0); // same cell

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC); // forage runs on the eat animation
    expect(atomic.effect).toEqual({ kind: 'forage', bush });
  });

  it('walks to the nearest ripe bush when hungry and not standing on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, 4, 0); // distance 4
    bushAt(sim, 2, 0); // distance 2 — should win

    aiSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 2, 0));
  });

  it('ignores a BARE (regrowing) bush — only ripe bushes are food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, 2, 0, false, BERRY_REGROW_TICKS); // bare, still regrowing
    // A wood node to work, so "no food" falls through to work rather than freezing.
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });

    aiSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not the bare bush — foraging did not fire.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('does not forage a ripe bush beyond the forage radius', () => {
    // A bush at tile 33 sits at node distance 66 > BERRY_FORAGE_RADIUS (64) from the settler at tile 0.
    const beyond = Math.floor(BERRY_FORAGE_RADIUS / 2) + 1; // 33 tiles ⇒ 66 nodes
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(beyond + 2, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, beyond, 0); // ripe, but out of reach
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(1), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });

    aiSystem(sim.world, ctxOf(sim));

    // The far bush is ignored; the settler works the nearby tree instead.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 1, 0));
  });
});

describe('eat drive — picking the NEAREST food across stores and bushes', () => {
  it('forages a bush that is nearer than any food store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const bush = bushAt(sim, 0, 0); // on the bush — distance 0
    storeAt(sim, 3, 0, 5); // a larder exists, but the bush is right here

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'forage', bush });
  });

  it('eats from a store that is nearer than any bush', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const store = storeAt(sim, 0, 0, 5); // on the larder — distance 0
    bushAt(sim, 3, 0); // a ripe bush exists, but the larder is right here

    aiSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });
  });
});

describe('forage atomic + regrow (AtomicSystem, BerryGrowthSystem)', () => {
  it('foraging a ripe bush zeroes hunger, flips it bare, and schedules regrow + a berryForaged event', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const bush = bushAt(sim, 0, 0);
    sim.world.add(settler, CurrentAtomic, {
      atomicId: EAT_ATOMIC,
      elapsed: 0,
      progress: fx.fromInt(0),
      duration: 1, // completes the first tick
      effect: { kind: 'forage', bush },
      targetEntity: bush,
      targetTile: null,
    });

    atomicSystem(sim.world, ctxOf(sim));

    const b = sim.world.get(bush, BerryBush);
    expect(b.ripe).toBe(false); // one serving eaten
    expect(b.ripeAtTick).toBe(sim.tick + BERRY_REGROW_TICKS); // regrow scheduled
    expect(sim.world.get(settler, Settler).hunger).toBe(fx.fromInt(0)); // hunger reset
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
    expect(sim.events.current().some((e) => e.kind === 'berryForaged')).toBe(true);
  });

  it('a bare bush regrows to ripe once its ripeAtTick passes', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const bush = bushAt(sim, 0, 0, false, 3); // regrows at tick 3

    for (let i = 0; i < 2; i++) berryGrowthSystem(sim.world, ctxOf(sim)); // ticks 0,1 — still bare
    expect(sim.world.get(bush, BerryBush).ripe).toBe(false);

    // Advance the sim clock past ripeAtTick and grow again.
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.world.get(bush, BerryBush).ripe).toBe(true);
    expect(sim.world.get(bush, BerryBush).ripeAtTick).toBe(0); // schedule cleared
  });
});

describe('forage drive — closing the rise→forage→reset loop through the real schedule', () => {
  it('a settler beside a bush gets hungry, forages, its hunger resets, and the bush regrows', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, NEED_THRESHOLD);
    const bush = bushAt(sim, 1, 0); // one tile over

    let ateAtLeastOnce = false;
    let wentBare = false;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const h = sim.world.get(settler, Settler).hunger;
      if (h < fx.div(ONE, fx.fromInt(4))) ateAtLeastOnce = true;
      if (!sim.world.get(bush, BerryBush).ripe) wentBare = true;
    }

    expect(ateAtLeastOnce).toBe(true); // the loop closed: hunger rose, the settler foraged, it reset
    expect(wentBare).toBe(true); // the bush was actually eaten off (not conjured food)
    expect(sim.checkInvariants()).toEqual([]);
  });

  it('is byte-identical across two same-seed runs (determinism)', () => {
    const run = (): string => {
      clearComponentStores();
      const sim = new Simulation({ seed: 5, content: testContent(), map: grassMap(5, 1) });
      settlerAt(sim, 0, 0, NEED_THRESHOLD);
      bushAt(sim, 2, 0);
      for (let i = 0; i < 300; i++) sim.step();
      return sim.hashState();
    };
    expect(run()).toBe(run());
  });
});
