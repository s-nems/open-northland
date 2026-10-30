import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { setStockAmount } from '../../../../src/components/index.js';
import type { Command } from '../../../../src/core/commands/index.js';
import type { Simulation } from '../../../../src/index.js';
import type { BuildOrderEntry } from '../../../../src/systems/computer-player/build-order/entries.js';
import { sitePace } from '../../../../src/systems/computer-player/build-order/entries.js';
import {
  FOOD_RICH_UNITS_PER_SETTLER,
  HERDING_TOP_HOMES,
  HOUSING_FOOD_UNITS_PER_WOMAN,
  HOUSING_PACE,
} from '../../../../src/systems/computer-player/build-order/housing.js';
import { AI_PROFILES } from '../../../../src/systems/computer-player/difficulty.js';
import { SITES_GROW_FROM_TICKS } from '../../../../src/systems/computer-player/game-phase.js';
import { buildOrderModule } from '../../../../src/systems/computer-player/index.js';
import { aiContent } from '../../../fixtures/ai-content.js';
import {
  ANIMAL_FARM_TYPE,
  aiSim,
  BAKERY_TYPE,
  completeSites,
  ctxOf,
  entityOfBuilding,
  FARM_TYPE,
  HOME_TOP_TYPE,
  HOME_TYPE,
  HQ_TYPE,
  HQ_X,
  HQ_Y,
  oneLine,
  placeHq,
  placeResources,
  RESOURCE_SPOTS,
  SEAT,
  seatEconomy,
  spawnMen,
  TOWER_TYPE,
  VIKING,
  WOMAN,
  WOOD,
} from '../support.js';

/** Family slots of the fixture's base home tier. */
const BASE_SLOTS = 2;
const HOMES_CAP = 4;
/** Family slots of the capped home tier in the herding walk, past the base tier's per bill unit. */
const ROOMY_TOP_HOME_SLOTS = 8;
/** The fixture's edible good. */
const FOOD_SIMPLE = 3;
/** A fixture good no building makes and nobody gathers. */
const TOOL_WOODEN = 6;
/** Wood in store, the fixture homes' only bill good: enough for every upgrade a test asks. */
const UPGRADE_WOOD = 20;

const HOUSING: BuildOrderEntry = { kind: 'housing', building: 'home_level_00', count: HOMES_CAP };
const housing = buildOrderModule(oneLine([HOUSING]));

/** The fixture with a bakery that bakes the edible good, so it counts as a food workshop. */
function bakingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: base.buildings.map((b) =>
      b.typeId === BAKERY_TYPE
        ? { ...b, recipes: [{ inputs: [], outputs: [{ goodType: FOOD_SIMPLE, amount: 1 }], ticks: 180 }] }
        : b,
    ),
  });
}

/** The fixture with an animal farm that makes the edible good, so it counts as a food workshop. */
function herdingContent(): ContentSet {
  const base = aiContent();
  return parseContentSet({
    ...base,
    buildings: [
      ...base.buildings,
      {
        typeId: ANIMAL_FARM_TYPE,
        id: 'work_animal_farm',
        kind: 'workplace' as const,
        recipes: [{ inputs: [], outputs: [{ goodType: FOOD_SIMPLE, amount: 1 }], ticks: 180 }],
        construction: [{ goodType: WOOD, amount: 2 }],
      },
    ],
  });
}

/** The fixture's fisher trade, spelled `fisher` since the role is read off the id. */
const FISHER = 22;

/** `content` with the fisher trade. */
function withFisher(content: ContentSet): ContentSet {
  return parseContentSet({ ...content, jobs: [...content.jobs, { typeId: FISHER, id: 'fisher' }] });
}

/** One man of the seat set to fishing, as the workforce posts him. */
function hireFisher(sim: Simulation): void {
  spawnMen(sim, 1, FISHER);
  sim.step();
}

function decide(sim: Simulation, order = housing, content: ContentSet = aiContent()): Command | undefined {
  return [...order.run(sim.world, { ...ctxOf(sim), content }, SEAT)][0];
}

function homePlaced(command: Command | undefined): boolean {
  return command?.kind === 'placeBuilding' && command.buildingType === HOME_TYPE;
}

/** A seat of `women` with `perSettler` edible units a settler in its HQ. */
function seatWithWomen(women: number, perSettler: number, content: ContentSet = aiContent()): Simulation {
  const sim = aiSim(1, content);
  placeHq(sim);
  spawnMen(sim, women, WOMAN);
  sim.step();
  setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), FOOD_SIMPLE, women * perSettler);
  return sim;
}

describe('the housing lane', () => {
  it('keeps the family slots ahead of the women: new homes up to the cap, then upgrades', () => {
    // One woman more than the capped base homes hold with the lane's free slots, so one upgrade follows.
    const women = HOMES_CAP * BASE_SLOTS - HOUSING_PACE.opening.freeSlots + 1;
    const sim = seatWithWomen(women, FOOD_RICH_UNITS_PER_SETTLER);
    const walk: string[] = [];
    for (let decision = 0; decision < HOMES_CAP + 2; decision++) {
      const next = decide(sim);
      if (next === undefined) break;
      if (next.kind === 'placeBuilding') walk.push(`place ${next.buildingType}`);
      else if (next.kind === 'upgradeBuilding') walk.push(`upgrade ${next.target}`);
      else throw new Error(`unexpected ${next.kind}`);
      sim.enqueueSetup(next);
      sim.step();
      // One home site at a time: the lane waits while its site rises.
      expect(decide(sim)).toBeUndefined();
      completeSites(sim);
    }
    // A new base home costs the fewest bill units per slot in this content; with the cap reached, the
    // upgrade straight to the top tier adds the slot still missing.
    expect(walk).toEqual([
      ...Array.from({ length: HOMES_CAP }, () => `place ${HOME_TYPE}`),
      `upgrade ${HOME_TOP_TYPE}`,
    ]);
    // The homes now hold every woman with the free slots to spare.
    expect(decide(sim)).toBeUndefined();
  });

  it('opens no home site while the store runs short of food, even on a fishing seat', () => {
    const content = withFisher(aiContent());
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN - 1, content);
    hireFisher(sim);
    expect(decide(sim, housing, content)).toBeUndefined();
    setStockAmount(
      sim.world,
      entityOfBuilding(sim, HQ_TYPE),
      FOOD_SIMPLE,
      BASE_SLOTS * HOUSING_FOOD_UNITS_PER_WOMAN,
    );
    expect(homePlaced(decide(sim, housing, content))).toBe(true);
  });

  it('waits on a seat that is not food-rich until a workshop making food stands', () => {
    const content = bakingContent();
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN, content);
    expect(decide(sim, housing, content)).toBeUndefined();
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: BAKERY_TYPE,
      x: HQ_X + 6,
      y: HQ_Y,
      tribe: VIKING,
      owner: SEAT,
    });
    sim.step();
    expect(homePlaced(decide(sim, housing, content))).toBe(true);
  });

  it('runs ahead of its place in the line once the seat fishes while the daughters are blocked', () => {
    // A live iron node keeps the collector step before the lane unmet.
    const order = buildOrderModule(oneLine([{ kind: 'collector', good: 'iron' }, HOUSING]));
    const content = withFisher(aiContent());
    const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN, content);
    placeResources(sim, [RESOURCE_SPOTS.iron]);
    sim.step();
    // The fishing side alone names water in the near band, which may lie beyond every fishing trip.
    seatEconomy(sim, 'standard', ['fishing']);
    expect(decide(sim, order, content)).toBeUndefined();
    hireFisher(sim);
    expect(homePlaced(decide(sim, order, content))).toBe(true);
  });

  describe('once a workshop makes food', () => {
    const content = bakingContent();

    /** A seat of `women` in the feeding stage, wood for every upgrade in store, with built homes of
     *  `homeTypes` west of its HQ. */
    function feedingSeat(women: number, homeTypes: readonly number[]): Simulation {
      const sim = seatWithWomen(women, HOUSING_FOOD_UNITS_PER_WOMAN, content);
      const place = (buildingType: number, x: number, y: number) =>
        sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
      place(BAKERY_TYPE, HQ_X + 6, HQ_Y);
      for (const [i, type] of homeTypes.entries()) place(type, HQ_X - 6, HQ_Y - 6 + 6 * i);
      sim.step();
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), WOOD, UPGRADE_WOOD);
      return sim;
    }

    it('upgrades the base-tier home before placing a new one, on a second home site at once', () => {
      // The stage's lead keeps the slots short of two women.
      const sim = feedingSeat(BASE_SLOTS, [HOME_TYPE]);
      const first = decide(sim, housing, content);
      expect(first).toMatchObject({ kind: 'upgradeBuilding', target: HOME_TOP_TYPE });
      if (first === undefined) throw new Error('expected the upgrade');
      sim.enqueueSetup(first);
      sim.step();
      // The stage holds two home sites, the second beyond the clock's.
      expect(HOUSING_PACE.feeding.sites).toBe(2);
      const second = decide(sim, housing, content);
      expect(homePlaced(second)).toBe(true);
      if (second === undefined) throw new Error('expected the placement');
      sim.enqueueSetup(second);
      sim.step();
      expect(decide(sim, housing, content)).toBeUndefined();
    });

    it("stands its home sites apart from the clock's once the clock has grown", () => {
      const sim = feedingSeat(BASE_SLOTS, []);
      const fillSites = (count: number): void => {
        for (let i = 0; i < count; i++)
          sim.enqueueSetup({
            kind: 'placeBuilding',
            buildingType: FARM_TYPE,
            x: HQ_X + 12 + 6 * i,
            y: HQ_Y + 6,
            tribe: VIKING,
            owner: SEAT,
            underConstruction: true,
          });
        sim.step();
      };
      const at = (tick: number): Command | undefined =>
        [...housing.run(sim.world, { ...ctxOf(sim, tick), content }, SEAT)][0];
      // The grown clock's sites and the feeding stage's extra all taken by other buildings: before the
      // growth the first home site would be one of the clock's, so none is left.
      fillSites(sitePace(AI_PROFILES.hard, SITES_GROW_FROM_TICKS).sites + HOUSING_PACE.feeding.sites - 1);
      expect(at(0)).toBeUndefined();
      // Grown, the lane's sites stand apart from them.
      expect(homePlaced(at(SITES_GROW_FROM_TICKS))).toBe(true);
    });

    it("keeps the tower ring's sites, which stand beyond the clock's, off the home sites", () => {
      const sim = feedingSeat(BASE_SLOTS, []);
      // As many ring towers rising as the clock's sites and the feeding stage's extra.
      const towers = sitePace(AI_PROFILES.hard, 0).sites + HOUSING_PACE.feeding.sites - 1;
      for (let i = 0; i < towers; i++)
        sim.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: TOWER_TYPE,
          x: HQ_X + 12 + 6 * i,
          y: HQ_Y + 6,
          tribe: VIKING,
          owner: SEAT,
          underConstruction: true,
        });
      sim.step();
      expect(homePlaced(decide(sim, housing, content))).toBe(true);
    });

    it('starts a second upgrade only while the standing homes keep a slot free, else places a home', () => {
      // Two base homes hold the women exactly: with one upgrading, the other leaves no room to grow.
      const sim = feedingSeat(2 * BASE_SLOTS, [HOME_TYPE, HOME_TYPE]);
      const first = decide(sim, housing, content);
      expect(first).toMatchObject({ kind: 'upgradeBuilding', target: HOME_TOP_TYPE });
      if (first === undefined) throw new Error('expected the upgrade');
      sim.enqueueSetup(first);
      sim.step();
      expect(homePlaced(decide(sim, housing, content))).toBe(true);
      // A top and two lagging base homes for one woman: the homes standing beside the first lift keep
      // room, so the second goes on.
      const roomy = feedingSeat(1, [HOME_TOP_TYPE, HOME_TYPE, HOME_TYPE]);
      const lift = decide(roomy, housing, content);
      if (lift === undefined) throw new Error('expected the upgrade');
      roomy.enqueueSetup(lift);
      roomy.step();
      expect(decide(roomy, housing, content)).toMatchObject({
        kind: 'upgradeBuilding',
        target: HOME_TOP_TYPE,
      });
    });

    it('lifts a home through no tier whose bill nothing the seat owns makes and the store lacks', () => {
      // The top tier asks for wooden tools, which no building of the fixture makes.
      const toolTop = parseContentSet({
        ...content,
        buildings: content.buildings.map((b) =>
          b.typeId === HOME_TOP_TYPE ? { ...b, construction: [{ goodType: TOOL_WOODEN, amount: 1 }] } : b,
        ),
      });
      const sim = seatWithWomen(BASE_SLOTS, HOUSING_FOOD_UNITS_PER_WOMAN, toolTop);
      const place = (buildingType: number, x: number, y: number) =>
        sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
      place(BAKERY_TYPE, HQ_X + 6, HQ_Y);
      place(HOME_TYPE, HQ_X - 6, HQ_Y - 6);
      sim.step();
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), WOOD, UPGRADE_WOOD);
      // The middle tier adds no slot, so with the top one unsourced a new home is the only way.
      expect(homePlaced(decide(sim, housing, toolTop))).toBe(true);
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), TOOL_WOODEN, 1);
      expect(decide(sim, housing, toolTop)).toMatchObject({ kind: 'upgradeBuilding', target: HOME_TOP_TYPE });
    });

    it('upgrades a home lagging below the highest tier while the slots are not short', () => {
      // One woman: a base and a top home hold her with the stage's whole lead.
      const women = 1;
      expect(BASE_SLOTS + 3).toBeGreaterThanOrEqual(women + HOUSING_PACE.feeding.freeSlots);
      const sim = feedingSeat(women, [HOME_TOP_TYPE, HOME_TYPE]);
      expect(decide(sim, housing, content)).toMatchObject({ kind: 'upgradeBuilding', target: HOME_TOP_TYPE });
      // Before any food is made the same homes stand as they are.
      const opening = seatWithWomen(women, FOOD_RICH_UNITS_PER_SETTLER);
      for (const [i, type] of [HOME_TOP_TYPE, HOME_TYPE].entries())
        opening.enqueueSetup({
          kind: 'placeBuilding',
          buildingType: type,
          x: HQ_X - 6,
          y: HQ_Y - 6 + 6 * i,
          tribe: VIKING,
          owner: SEAT,
        });
      opening.step();
      expect(decide(opening)).toBeUndefined();
    });
  });

  describe('while only the animal farm makes food', () => {
    const content = withFisher(herdingContent());

    /** A seat of one woman with its animal farm, wood for every upgrade in store, and `homes` built base
     *  homes, which hold her with the opening's free slots to spare. */
    function herdingSeat(homes: number, seatContent: ContentSet = content): Simulation {
      const sim = seatWithWomen(1, HOUSING_FOOD_UNITS_PER_WOMAN, seatContent);
      const place = (buildingType: number, x: number, y: number) =>
        sim.enqueueSetup({ kind: 'placeBuilding', buildingType, x, y, tribe: VIKING, owner: SEAT });
      place(ANIMAL_FARM_TYPE, HQ_X + 6, HQ_Y);
      for (let i = 0; i < homes; i++) place(HOME_TYPE, HQ_X - 6, HQ_Y - 6 + 6 * i);
      sim.step();
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), WOOD, UPGRADE_WOOD);
      return sim;
    }

    function upgradeOnce(sim: Simulation): void {
      const next = decide(sim, housing, content);
      expect(next).toMatchObject({ kind: 'upgradeBuilding', target: HOME_TOP_TYPE });
      if (next === undefined) throw new Error('expected the upgrade');
      sim.enqueueSetup(next);
      sim.step();
      // One home site at a time, as in the opening.
      expect(decide(sim, housing, content)).toBeUndefined();
      completeSites(sim);
    }

    it("keeps the opening's pace and raises one home to the capped tier on a lean seat", () => {
      expect(HOUSING_PACE.herding).toEqual(HOUSING_PACE.opening);
      expect(HERDING_TOP_HOMES.lean).toBe(1);
      const sim = herdingSeat(3);
      upgradeOnce(sim);
      // The ceiling is reached: the other homes stand at the base tier.
      expect(decide(sim, housing, content)).toBeUndefined();
    });

    it('places a new home at the capped tier only while the ceiling has room', () => {
      // The capped tier holds so many families that it is the cheapest slot whenever the ceiling allows it.
      const roomyTop = parseContentSet({
        ...content,
        buildings: content.buildings.map((b) =>
          b.typeId === HOME_TOP_TYPE ? { ...b, homeSize: ROOMY_TOP_HOME_SLOTS } : b,
        ),
      });
      // Women enough that the slots stay short through the walk, and no home yet: every pick is a new home.
      const sim = herdingSeat(0, roomyTop);
      const women = HOMES_CAP * ROOMY_TOP_HOME_SLOTS;
      spawnMen(sim, women, WOMAN);
      sim.step();
      // Food enough for these women and the seat's first one to want homes, short of a well-fed seat's.
      setStockAmount(
        sim.world,
        entityOfBuilding(sim, HQ_TYPE),
        FOOD_SIMPLE,
        (women + 1) * HOUSING_FOOD_UNITS_PER_WOMAN,
      );
      const placed: number[] = [];
      for (let decision = 0; decision < HOMES_CAP; decision++) {
        const next = decide(sim, housing, roomyTop);
        if (next?.kind !== 'placeBuilding') throw new Error(`expected a new home, got ${next?.kind}`);
        placed.push(next.buildingType);
        sim.enqueueSetup(next);
        sim.step();
        completeSites(sim);
      }
      expect(placed.length).toBeGreaterThan(HERDING_TOP_HOMES.lean);
      expect(placed.filter((type) => type === HOME_TOP_TYPE)).toHaveLength(HERDING_TOP_HOMES.lean);
    });

    it('raises a second home with much food in store, and every lagging home once the seat fishes', () => {
      expect(HERDING_TOP_HOMES.wellFed).toBe(2);
      const sim = herdingSeat(3);
      setStockAmount(sim.world, entityOfBuilding(sim, HQ_TYPE), FOOD_SIMPLE, FOOD_RICH_UNITS_PER_SETTLER);
      upgradeOnce(sim);
      upgradeOnce(sim);
      expect(decide(sim, housing, content)).toBeUndefined();
      // A fisher feeds the homes as the bakery does: the last base home lags and is upgraded.
      hireFisher(sim);
      upgradeOnce(sim);
    });
  });
});
