import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CurrentAtomic,
  Female,
  MoveGoal,
  Owner,
  Position,
  Residence,
  Stockpile,
  Wedding,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { stepToIdleReplan } from '../fixtures/idle-replan.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Signpost confinement over the FAMILY searches - the family twins of confinement-drives.test.ts:
 * with `setSignpostNavigation` on, the housewife's hoard source, the marry partner pick, and the
 * `assignHouse` target are all gated to the settler's allowed area (its walk range + a caught
 * guidepost network), while an in-area twin is still taken. Same geometry as the drives suite:
 * the walk range is 50 hex nodes = 25 tiles; IN-AREA fixtures at tile 6, OUT-OF-AREA at tile 40 on a
 * 192-tile strip with no signposts to extend the range.
 */

const VIKING = 1;
const PLAYER = 0;
const FOOD = 16; // slug `food_simple` - the `food_` prefix is what makes it edible (isFood)
const WOMAN = 5;
const CIVILIST = 6;
const HOME = 2;
const GRASS = 0;
const IN_AREA = 6;
const OUT_OF_AREA = 40;

function familyContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: FOOD, id: 'food_simple' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        stock: [{ goodType: FOOD, capacity: 5 }],
      },
    ],
  });
}

function confinedSim(): Simulation {
  const sim = new Simulation({ seed: 5, content: familyContent(), map: grassMap(192, 8) });
  sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  return sim;
}

function adultAt(sim: Simulation, x: number, y: number, jobType: number, female: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0) as Fixed,
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

function homeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** A loose food pile (Stockpile + Position, no Building) - a hoard/haul source. */
function foodPileAt(sim: Simulation, x: number, y: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, amount]]) });
  return e;
}

/** Whether the settler committed to anything this tick - a walk or an atomic. */
function acted(sim: Simulation, e: Entity): boolean {
  return sim.world.has(e, MoveGoal) || sim.world.has(e, CurrentAtomic);
}

describe('confinement gates the housewife hoard source', () => {
  it('a housed woman ignores an out-of-area food pile but fetches an in-area one', () => {
    const sim = confinedSim();
    const home = homeAt(sim, 4, 2);
    const woman = adultAt(sim, 2, 2, WOMAN, true);
    sim.world.add(woman, Residence, { home });
    foodPileAt(sim, OUT_OF_AREA, 2, 3);
    sim.step();
    expect(acted(sim, woman)).toBe(false); // the far pile is beyond her area - nothing to hoard

    foodPileAt(sim, IN_AREA, 2, 3);
    stepToIdleReplan(sim, woman);
    expect(acted(sim, woman)).toBe(true); // the near pile is inside her walk range
  });
});

describe('the same-side rule gates the housewife hoard source', () => {
  it('a housed woman ignores an enemy food pile but hoards her own side’s', () => {
    const sim = confinedSim();
    const home = homeAt(sim, 4, 2);
    const woman = adultAt(sim, 2, 2, WOMAN, true); // player 0 (adultAt stamps PLAYER)
    sim.world.add(woman, Residence, { home });
    const enemyPile = foodPileAt(sim, IN_AREA, 2, 3); // in her area, but another player's larder
    sim.world.add(enemyPile, Owner, { player: PLAYER + 1 });
    sim.step();
    expect(acted(sim, woman)).toBe(false); // an enemy's food is not hers to haul - nothing to hoard

    const myPile = foodPileAt(sim, IN_AREA + 1, 2, 3); // her own player's food, also in her area
    sim.world.add(myPile, Owner, { player: PLAYER });
    stepToIdleReplan(sim, woman);
    expect(acted(sim, woman)).toBe(true); // she hoards from her own side's pile
    expect(sim.world.get(enemyPile, Stockpile).amounts.get(FOOD)).toBe(3); // enemy pile untouched
  });
});

describe('confinement gates the marry partner pick', () => {
  it('a marry order ignores an out-of-area match but takes an in-area one', () => {
    const sim = confinedSim();
    const woman = adultAt(sim, 2, 2, WOMAN, true);
    adultAt(sim, OUT_OF_AREA, 2, CIVILIST, false);
    sim.enqueueSetup({ kind: 'marry', entity: woman });
    sim.step();
    expect(sim.world.has(woman, Wedding)).toBe(false); // the only match is out of reach - auto-cancel
    expect(sim.events.current().filter((ev) => ev.kind === 'marriageUnmatched')).toEqual([
      { kind: 'marriageUnmatched', entity: woman },
    ]);

    adultAt(sim, IN_AREA, 2, CIVILIST, false);
    sim.enqueueSetup({ kind: 'marry', entity: woman });
    sim.step();
    expect(sim.world.has(woman, Wedding)).toBe(true); // the near match is inside her area
  });
});

describe('confinement gates assignHouse', () => {
  it('an out-of-area home is refused like an out-of-area move; an in-area one binds', () => {
    const sim = confinedSim();
    const settler = adultAt(sim, 2, 2, CIVILIST, false);
    const farHome = homeAt(sim, OUT_OF_AREA, 2);
    sim.enqueueSetup({ kind: 'assignHouse', entity: settler, house: farHome });
    sim.step();
    expect(sim.world.has(settler, Residence)).toBe(false);

    const nearHome = homeAt(sim, IN_AREA, 2);
    sim.enqueueSetup({ kind: 'assignHouse', entity: settler, house: nearHome });
    sim.step();
    expect(sim.world.tryGet(settler, Residence)?.home).toBe(nearHome);
  });
});
