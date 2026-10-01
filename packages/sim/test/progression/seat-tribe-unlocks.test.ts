import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  grantScriptUnlock,
  Health,
  JobAssignment,
  Owner,
  Position,
  Production,
  Settler,
  Stockpile,
  seatUnlockedTribes,
  setSettlerJob,
  technologyDiscovered,
} from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  buildTribes,
  exportSaveGame,
  fx,
  ONE,
  playerCommand,
  restoreSimulation,
  Simulation,
} from '../../src/index.js';
import { cycleStartable } from '../../src/systems/economy/production/start-gate.js';
import { productionSystem } from '../../src/systems/index.js';
import { buildingEnabled, jobEnabled, workplaceRecipeEnabled } from '../../src/systems/progression/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

const SEAT = 0;
const RIVAL = 1;
const VIKING = 1;
/** The fixture's viking cloned under another id: the same trades, houses and tech edges. */
const FRANK = 2;
const HEADQUARTERS = 1;
const SAWMILL = 2;
const WOOD = 1;
const PLANK = 2;
const WOODCUTTER = 1;
const CARPENTER = 2;
/** The fixture's hero trade. */
const HERO = 45;
/** Raw XP on the wood track that clears the fixture's `needforgood PLANK` row. */
const PLANK_GATE_EARNED: readonly [number, number][] = [[1, 300]];

/** The fixture plus a frank clone of the viking; `technology` gives both a (houseless) tech table, so
 *  their goods open by discovery instead of by the trades alive. */
function twoTribeContent(technology = false): ContentSet {
  const base = testContent();
  const viking = base.tribes.find((tribe) => tribe.typeId === VIKING);
  if (viking === undefined) throw new Error('fixture lacks the viking tribe');
  const tabled = technology ? { ...viking, technology: { houses: [] } } : viking;
  return parseContentSet({
    ...base,
    tribes: [
      ...base.tribes.filter((tribe) => tribe.typeId !== VIKING),
      tabled,
      { ...tabled, typeId: FRANK, id: 'frank' },
    ],
  });
}

/** A two-tribe world whose seat declares the viking nation only, as a map roster does. */
function vikingSeat(technology = false): Simulation {
  const sim = new Simulation({ seed: 4, content: twoTribeContent(technology) });
  sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: [VIKING] });
  sim.step();
  return sim;
}

function person(sim: Simulation, tribe: number, jobType: number, owner: number, x = 0): Entity {
  const e = sim.world.create();
  addPerson(
    sim.world,
    e,
    {
      tribe,
      jobType,
      hunger: fx.fromInt(0),
      fatigue: fx.fromInt(0),
      piety: fx.fromInt(0),
      enjoyment: fx.fromInt(0),
    },
    { experience: new Map(PLANK_GATE_EARNED) },
  );
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

function houseEnabled(sim: Simulation, tribe: number, house: number): boolean {
  return buildingEnabled(sim.world, ctxOf(sim), SEAT, tribe, house);
}

function placeFor(sim: Simulation, tribe: number, buildingType: number, x: number): void {
  sim.enqueue(playerCommand(SEAT, { kind: 'placeBuilding', buildingType, x, y: 4, tribe, owner: SEAT }));
  sim.step();
}

function placedTribes(sim: Simulation): number[] {
  return [...sim.world.query(Building)].map((e) => sim.world.get(e, Building).tribe);
}

describe('seat tribe unlocks', () => {
  it('opens only the declared nation at start; an undeclared seat keeps every nation open', () => {
    const sim = vikingSeat();
    expect(houseEnabled(sim, VIKING, HEADQUARTERS)).toBe(true);
    expect(houseEnabled(sim, FRANK, HEADQUARTERS)).toBe(false);
    expect(jobEnabled(sim.world, ctxOf(sim), SEAT, FRANK, WOODCUTTER)).toBe(false);
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING]);
    expect(buildingEnabled(sim.world, ctxOf(sim), RIVAL, FRANK, HEADQUARTERS)).toBe(true);
    expect(buildTribes(sim.world, RIVAL)).toEqual([]);
  });

  it('unlocks a nation for good once the seat owns an ordinary settler of it', () => {
    const sim = vikingSeat();
    const frank = person(sim, FRANK, WOODCUTTER, SEAT);
    sim.step();
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING, FRANK]);
    expect(sim.buildTribes(SEAT)).toEqual([VIKING, FRANK]);
    expect(houseEnabled(sim, FRANK, HEADQUARTERS)).toBe(true);

    sim.world.destroy(frank);
    sim.step();
    expect(seatUnlockedTribes(sim.world, SEAT)).toEqual([FRANK]);
    expect(houseEnabled(sim, FRANK, HEADQUARTERS)).toBe(true);
    // Persisted: a restored world keeps the unlock its settler no longer stands for.
    const restored = restoreSimulation(exportSaveGame(sim), { content: sim.content });
    expect(restored.buildTribes(SEAT)).toEqual([VIKING, FRANK]);
  });

  it('leaves a foreign hero out of the unlock until he takes up a trade', () => {
    const sim = vikingSeat();
    const hero = person(sim, FRANK, HERO, SEAT);
    sim.step();
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING]);
    expect(houseEnabled(sim, FRANK, HEADQUARTERS)).toBe(false);
    expect(technologyDiscovered(sim.world, SEAT, FRANK, 'job', HERO)).toBe(false);

    setSettlerJob(sim.world, hero, WOODCUTTER);
    sim.step();
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING, FRANK]);
  });

  it('runs a hero of a locked nation exactly as one of an unlocked nation', () => {
    // Combat, needs and movement read no unlock gate; this pins that a walk order and the ticks after it
    // leave the hero in the same state whether or not his seat has his nation.
    const heroAfterWalk = (homeTribes: readonly number[]): string => {
      const sim = new Simulation({ seed: 4, content: twoTribeContent(), map: grassCellMap(8, 2) });
      sim.enqueueSetup({ kind: 'setPlayerPlacementTribes', player: SEAT, tribes: homeTribes });
      sim.step();
      const hero = person(sim, FRANK, HERO, SEAT);
      sim.world.add(hero, Health, { hitpoints: 1000, max: 1000 });
      sim.enqueue(playerCommand(SEAT, { kind: 'moveUnit', entity: hero, x: 10, y: 2 }));
      for (let tick = 0; tick < 120; tick++) sim.step();
      expect(sim.world.get(hero, Settler).jobType).toBe(HERO);
      expect(sim.world.get(hero, Position).x).not.toBe(fx.fromInt(0)); // the order moved him
      return JSON.stringify(sim.world.componentEntries(hero), (_key, value) =>
        value instanceof Map ? [...value] : value,
      );
    };
    expect(heroAfterWalk([VIKING])).toBe(heroAfterWalk([VIKING, FRANK]));
  });

  it('lets a script enable a single house of a locked nation, and the authority place exactly that', () => {
    const sim = vikingSeat();
    placeFor(sim, FRANK, SAWMILL, 4);
    expect(placedTribes(sim)).toEqual([]);

    grantScriptUnlock(sim.world, 'enabled', SEAT, FRANK, 'house', SAWMILL);
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING, FRANK]);
    expect(houseEnabled(sim, FRANK, SAWMILL)).toBe(true);
    expect(houseEnabled(sim, FRANK, HEADQUARTERS)).toBe(false);

    placeFor(sim, FRANK, HEADQUARTERS, 8);
    expect(placedTribes(sim)).toEqual([]);
    placeFor(sim, FRANK, SAWMILL, 12);
    expect(placedTribes(sim)).toEqual([FRANK]);
  });

  it('accepts a placement of a settler-unlocked nation and refuses one the seat never fielded', () => {
    const sim = vikingSeat();
    placeFor(sim, VIKING, HEADQUARTERS, 4);
    placeFor(sim, FRANK, HEADQUARTERS, 8);
    expect(placedTribes(sim)).toEqual([VIKING]);
    person(sim, FRANK, WOODCUTTER, SEAT);
    sim.step();
    placeFor(sim, FRANK, HEADQUARTERS, 12);
    expect(placedTribes(sim)).toEqual([VIKING, FRANK]);
  });
});

describe('production by the worker tribe', () => {
  /** A seat-owned frank sawmill a script handed over, its viking carpenter posted at the door. */
  function frankSawmill(sim: Simulation, crewTribe: number): { mill: Entity; operator: Entity } {
    const mill = sim.world.create();
    sim.world.add(mill, Building, { buildingType: SAWMILL, tribe: FRANK, built: ONE, level: 0 });
    sim.world.add(mill, Position, { x: fx.fromInt(0), y: fx.fromInt(0) });
    sim.world.add(mill, Stockpile, { amounts: new Map([[WOOD, 5]]) });
    sim.world.add(mill, Owner, { player: SEAT });
    const operator = person(sim, crewTribe, CARPENTER, SEAT);
    sim.world.add(operator, JobAssignment, { workplace: mill });
    return { mill, operator };
  }

  it("makes a product the seat enabled for its viking crew, whatever the frank house's tribe has", () => {
    // Planks open for a tribe while one of its woodcutters lives; here only the viking one does.
    const sim = vikingSeat();
    person(sim, VIKING, WOODCUTTER, SEAT, 9);
    const { mill } = frankSawmill(sim, VIKING);
    const recipe = sim.content.buildings.find((b) => b.typeId === SAWMILL)?.recipes?.[0];
    if (recipe === undefined) throw new Error('fixture sawmill lacks its plank recipe');
    expect(workplaceRecipeEnabled(sim.world, ctxOf(sim), mill, recipe)).toBe(true);
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.get(mill, Production).cycles.map((cycle) => cycle.goodType)).toEqual([PLANK]);
  });

  it("does not borrow the frank woodcutter's unlock for a viking crew", () => {
    const sim = vikingSeat();
    person(sim, FRANK, WOODCUTTER, SEAT, 9);
    sim.step();
    expect(buildTribes(sim.world, SEAT)).toEqual([VIKING, FRANK]);
    const { mill } = frankSawmill(sim, VIKING);
    productionSystem(sim.world, ctxOf(sim));
    expect(sim.world.has(mill, Production)).toBe(false);
  });

  it('re-asks the memoized start gate when the crew changes tribe', () => {
    const sim = vikingSeat(true);
    person(sim, VIKING, WOODCUTTER, SEAT, 9);
    const frank = person(sim, FRANK, CARPENTER, SEAT, 9);
    sim.step(); // both nations unlocked; only the viking woodcutter discovers planks, for vikings
    const { mill, operator } = frankSawmill(sim, VIKING);
    const recipes = contentIndex(sim.content).recipeByProductByBuilding.get(SAWMILL);
    if (recipes === undefined) throw new Error('fixture sawmill lacks its recipes');
    expect(cycleStartable(sim.world, ctxOf(sim), mill, recipes)).toBe(true);

    sim.world.remove(operator, JobAssignment);
    sim.world.add(frank, JobAssignment, { workplace: mill });
    expect(cycleStartable(sim.world, ctxOf(sim), mill, recipes)).toBe(false);
    expect(sim.checkInvariants()).toEqual([]);
  });
});
