import { describe, expect, it } from 'vitest';
import {
  addCurrentAtomic,
  BerryBush,
  Building,
  CurrentAtomic,
  MoveGoal,
  Owner,
  Position,
  Resource,
  Stockpile,
  setSignpostNavigation,
} from '../../../../src/components/index.js';
import type { Entity } from '../../../../src/ecs/world.js';
import { type Fixed, fx, ONE, Simulation } from '../../../../src/index.js';
import { positionOfNode } from '../../../../src/nav/halfcell.js';
import {
  anchorOnlyFootprint,
  atomicSystem,
  BERRY_STAGE_TICKS,
  berryGrowthSystem,
  NEED_DRAIN_UNITS_PER_TICK,
  needBar,
  plannerSystem,
  stampResourceFootprintData,
} from '../../../../src/systems/index.js';
import { BUSH_AT_HAND_NODES } from '../../../../src/systems/settlers/targets/index.js';
import { testContent } from '../../../fixtures/content.js';
import { nextTickCtxOf } from '../../../fixtures/context.js';
import {
  cellOf,
  ctxOf,
  grassMap,
  justAbove,
  NEED_DRIVE_THRESHOLD,
  needsSettlerAt,
} from '../../../fixtures/needs.js';
import { needsOf } from '../../../fixtures/settler.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

/**
 * Unit + integration tests for the FORAGE DRIVE - a hungry settler eating a wild {@link BerryBush} (the
 * `forage` effect on the eat animation, id 10). A bush is wild food anyone grazes: no job/tool, no stored
 * good consumed. It regrows its one serving on the landscape growth trigger (the
 * BerryGrowthSystem). The meal choice feeds a settler from stocked food within its goods reach before a
 * bush beyond arm's reach, while a bush at hand competes by distance; past the goods reach the nearest
 * meal of either kind wins. Source basis for the bush cycle is on
 * the {@link BerryBush} component (the original's `landscapetypes.ini` bush transitions).
 */

const WOOD = 1;
const FOOD = 3;
const VIKING = 1;
const HEADQUARTERS = 1;
const EAT_ATOMIC = 10;
/** The fixture eat clip's length, and the one `event 3 2 +4000` meal it pays out. */
const EAT_CLIP_TICKS = 5;
const MEAL: Fixed = needBar(4000);
const DRAIN: Fixed = needBar(NEED_DRAIN_UNITS_PER_TICK);
// Just over the drive threshold - a settler this hungry seeks food before any work.
const HUNGRY: Fixed = justAbove(NEED_DRIVE_THRESHOLD);
/** Ticks between two runs of the landscape growth trigger, each over the next map section. */
const GROWTH_RUN_TICKS = 24;

function settlerAt(sim: Simulation, x: number, y: number, hunger: Fixed): Entity {
  return needsSettlerAt(sim, x, y, { hunger });
}

/** A berry bush at (x,y), ripe by default. */
function bushAt(
  sim: Simulation,
  x: number,
  y: number,
  stage: 'bare' | 'flowering' | 'ripe' = 'ripe',
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, BerryBush, { stage });
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

describe('forageDrive - the planner choosing to forage a wild bush', () => {
  it('forages a ripe bush it is standing on when hungry and no store is nearer', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 2, 0, HUNGRY);
    const bush = bushAt(sim, 2, 0); // same cell

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, MoveGoal)).toBe(false);
    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.atomicId).toBe(EAT_ATOMIC); // forage runs on the eat animation
    expect(atomic.effect).toEqual({ kind: 'forage', bush });
  });

  it('walks to the nearest ripe bush when hungry and not standing on one', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, 4, 0); // distance 4
    bushAt(sim, 2, 0); // distance 2 - should win

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 2, 0));
  });

  it('ignores a BARE (regrowing) bush - only ripe bushes are food', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(5, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, 2, 0, 'bare'); // bare, still regrowing
    // A wood node to work, so "no food" falls through to work rather than freezing.
    const tree = sim.world.create();
    sim.world.add(tree, Position, { x: fx.fromInt(3), y: fx.fromInt(0) });
    sim.world.add(tree, Resource, { goodType: WOOD, remaining: 5, harvestAtomic: 24 });
    stampResourceFootprintData(sim.world, tree, anchorOnlyFootprint());

    plannerSystem(sim.world, ctxOf(sim));

    // Headed for the wood, not the bare bush - foraging did not fire.
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 3, 0));
  });

  it('walks to a bush past the goods reach when no store feeds it', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, 33, 0); // 66 map points: past the 40 of the goods reach

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 33, 0));
  });
});

describe('eat drive - stocked food before bushes in reach, the nearest meal beyond it', () => {
  it.each(['loose pile', 'storehouse'] as const)(
    'chooses a nearer meal in a %s beyond goods-search reach but inside walking reach',
    (source) => {
      const run = (): string => {
        const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 8) });
        setSignpostNavigation(sim.world, true);
        const settler = settlerAt(sim, 0, 2, HUNGRY);
        sim.world.add(settler, Owner, { player: 0 });
        const store = storeAt(sim, 21, 2, 5);
        sim.world.add(store, Owner, { player: 0 });
        if (source === 'loose pile') sim.world.remove(store, Building);
        // Both exceed the 40-node goods-search range but lie within the 50-node walk range.
        const bush = bushAt(sim, 24, 2);

        plannerSystem(sim.world, ctxOf(sim));

        expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 21, 2));
        for (let tick = 0; tick < 1000 && sim.world.get(store, Stockpile).amounts.get(FOOD) === 5; tick++) {
          sim.step();
        }
        expect(sim.world.get(store, Stockpile).amounts.get(FOOD)).toBe(4);
        expect(sim.world.get(bush, BerryBush).stage).toBe('ripe');
        expect(sim.checkInvariants()).toEqual([]);
        return sim.hashState();
      };
      expect(run()).toBe(run());
    },
  );

  it('still chooses the nearer bush when both foods lie beyond goods-search reach', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(40, 8) });
    setSignpostNavigation(sim.world, true);
    const settler = settlerAt(sim, 0, 2, HUNGRY);
    sim.world.add(settler, Owner, { player: 0 });
    const store = storeAt(sim, 24, 2, 5);
    sim.world.add(store, Owner, { player: 0 });
    bushAt(sim, 21, 2);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 21, 2));
  });

  it('forages the bush it stands on rather than walk to a store', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const bush = bushAt(sim, 0, 0); // on the bush - distance 0
    storeAt(sim, 3, 0, 5); // a larder exists, but the bush is right here

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.get(settler, CurrentAtomic).effect).toEqual({ kind: 'forage', bush });
  });

  it("walks to a store in reach past a nearer bush beyond arm's reach", () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(12, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    bushAt(sim, BUSH_AT_HAND_NODES / 2, 0); // two map points per cell: the first point past arm's reach
    storeAt(sim, 10, 0, 5);

    plannerSystem(sim.world, ctxOf(sim));

    expect(sim.world.has(settler, CurrentAtomic)).toBe(false);
    expect(sim.world.get(settler, MoveGoal).cell).toBe(cellOf(sim, 10, 0));
  });

  it('eats from a store that is nearer than any bush', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(6, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const store = storeAt(sim, 0, 0, 5); // on the larder - distance 0
    bushAt(sim, 3, 0); // a ripe bush exists, but the larder is right here

    plannerSystem(sim.world, ctxOf(sim));

    const atomic = sim.world.get(settler, CurrentAtomic);
    expect(atomic.effect).toEqual({ kind: 'eat', goodType: FOOD, from: store });
  });
});

describe('forage atomic + regrow (AtomicSystem, BerryGrowthSystem)', () => {
  it('foraging a ripe bush feeds the forager, flips it bare and emits berryForaged', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, HUNGRY);
    const bush = bushAt(sim, 0, 0);
    addCurrentAtomic(sim.world, settler, {
      atomicId: EAT_ATOMIC,
      duration: EAT_CLIP_TICKS,
      effect: { kind: 'forage', bush },
      targetEntity: bush,
      targetTile: null,
    });

    for (let i = 0; i < EAT_CLIP_TICKS; i++) atomicSystem(sim.world, nextTickCtxOf(sim));

    const b = sim.world.get(bush, BerryBush);
    expect(b.stage).toBe('bare'); // one serving eaten
    // One berry is a partial meal, worth the same as a stored one (observed original).
    expect(needsOf(sim, settler).hunger).toBe(fx.sub(HUNGRY, MEAL));
    expect(sim.world.has(settler, CurrentAtomic)).toBe(false); // atomic done
    expect(sim.events.current().some((e) => e.kind === 'berryForaged')).toBe(true);
  });

  it('a bare bush grows one stage per growth run over its section: flowering, then ripe a period later', () => {
    const sim = new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(20, 20) });
    const bush = sim.world.create();
    sim.world.add(bush, Position, positionOfNode(0, 0));
    sim.world.add(bush, BerryBush, { stage: 'bare' });
    const stageAfterRun = (tick: number) => {
      berryGrowthSystem(sim.world, { ...ctxOf(sim), tick });
      return sim.world.get(bush, BerryBush).stage;
    };

    // Node (0, 0) is the first section, run on every whole growth period.
    expect(stageAfterRun(BERRY_STAGE_TICKS - GROWTH_RUN_TICKS)).toBe('bare');
    expect(stageAfterRun(BERRY_STAGE_TICKS)).toBe('flowering');
    expect(sim.snapshot().events).toContainEqual(expect.objectContaining({ kind: 'berryBushGrew', bush }));
    expect(stageAfterRun(2 * BERRY_STAGE_TICKS - GROWTH_RUN_TICKS)).toBe('flowering');
    expect(stageAfterRun(2 * BERRY_STAGE_TICKS)).toBe('ripe');
    expect(stageAfterRun(3 * BERRY_STAGE_TICKS)).toBe('ripe');
  });
});

describe('forage drive - closing the rise→forage→relief loop through the real schedule', () => {
  it('a settler beside a bush gets hungry, forages, a meal comes off its bar, and the bush regrows', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassMap(3, 1) });
    const settler = settlerAt(sim, 0, 0, NEED_DRIVE_THRESHOLD);
    const bush = bushAt(sim, 1, 0); // one tile over

    let wentBare = false;
    let peakHunger = needsOf(sim, settler).hunger;
    let troughHunger = peakHunger;
    for (let i = 0; i < 400; i++) {
      sim.step();
      const h = needsOf(sim, settler).hunger;
      if (h > peakHunger) peakHunger = h;
      if (h < troughHunger) troughHunger = h;
      if (sim.world.get(bush, BerryBush).stage !== 'ripe') wentBare = true;
    }

    // The loop closed: hunger rose, the settler foraged, and a berry's worth came off the bar (the
    // tick's own rise may land alongside the meal).
    const oneMealBelowPeak = fx.sub(peakHunger, fx.sub(MEAL, DRAIN));
    expect(troughHunger).toBeLessThanOrEqual(oneMealBelowPeak);
    expect(troughHunger).toBeGreaterThan(fx.fromInt(0)); // a berry is a partial refill, never a reset
    expect(wentBare).toBe(true); // the bush was actually eaten off (not conjured food)
    expect(sim.checkInvariants()).toEqual([]);
  });
});
