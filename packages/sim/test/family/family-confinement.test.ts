import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  CurrentAtomic,
  FEMALE,
  Female,
  MoveGoal,
  Owner,
  Position,
  Residence,
  Settler,
  Stockpile,
  Wedding,
} from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Signpost confinement over the FAMILY searches — the family twins of confinement-drives.test.ts:
 * with `setSignpostNavigation` on, the housewife's hoard source, the marry partner pick, and the
 * `assignHouse` target are all gated to the settler's allowed area (local circle + reachable
 * guidepost network), while an in-area twin is still taken. Same geometry as the drives suite:
 * LOCAL radius 24 nodes = 12 tiles; IN-AREA fixtures at tile 6, OUT-OF-AREA at tile 40 on a
 * 192-tile strip with no signposts to extend the circle.
 */

const VIKING = 1;
const PLAYER = 0;
const FOOD = 16; // slug `food_simple` — the `food_` prefix is what makes it edible (isFood)
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
  sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
  sim.step();
  return sim;
}

function adultAt(sim: Simulation, x: number, y: number, jobType: number, female: boolean): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0) as Fixed,
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, FEMALE);
  return e;
}

function homeAt(sim: Simulation, x: number, y: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map() });
  return e;
}

/** A loose food pile (Stockpile + Position, no Building) — a hoard/haul source. */
function foodPileAt(sim: Simulation, x: number, y: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Stockpile, { amounts: new Map([[FOOD, amount]]) });
  return e;
}

/** Whether the settler committed to anything this tick — a walk or an atomic. */
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
    expect(acted(sim, woman)).toBe(false); // the far pile is beyond her area — nothing to hoard

    foodPileAt(sim, IN_AREA, 2, 3);
    sim.step();
    expect(acted(sim, woman)).toBe(true); // the near pile is inside her local circle
  });
});

describe('confinement gates the marry partner pick', () => {
  it('a marry order ignores an out-of-area match but takes an in-area one', () => {
    const sim = confinedSim();
    const woman = adultAt(sim, 2, 2, WOMAN, true);
    adultAt(sim, OUT_OF_AREA, 2, CIVILIST, false);
    sim.enqueue({ kind: 'marry', entity: woman });
    sim.step();
    expect(sim.world.has(woman, Wedding)).toBe(false); // the only match is out of reach — auto-cancel

    adultAt(sim, IN_AREA, 2, CIVILIST, false);
    sim.enqueue({ kind: 'marry', entity: woman });
    sim.step();
    expect(sim.world.has(woman, Wedding)).toBe(true); // the near match is inside her area
  });
});

describe('confinement gates assignHouse', () => {
  it('an out-of-area home is refused like an out-of-area move; an in-area one binds', () => {
    const sim = confinedSim();
    const settler = adultAt(sim, 2, 2, CIVILIST, false);
    const farHome = homeAt(sim, OUT_OF_AREA, 2);
    sim.enqueue({ kind: 'assignHouse', entity: settler, house: farHome });
    sim.step();
    expect(sim.world.has(settler, Residence)).toBe(false);

    const nearHome = homeAt(sim, IN_AREA, 2);
    sim.enqueue({ kind: 'assignHouse', entity: settler, house: nearHome });
    sim.step();
    expect(sim.world.tryGet(settler, Residence)?.home).toBe(nearHome);
  });
});
