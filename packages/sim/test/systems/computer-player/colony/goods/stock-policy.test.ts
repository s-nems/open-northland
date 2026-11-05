import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { aiControlEntity, Building, ComputerColony } from '../../../../../src/components/index.js';
import { NO_COMPONENT } from '../../../../../src/nav/terrain/index.js';
import { everyBuildingOf } from '../../../../../src/systems/ai-shared/home-roster.js';
import {
  type ColonyStockPolicy,
  chainIntermediates,
  colonyStockPolicy,
  colonyStockReadsOf,
  type StockPolicyRead,
  WORKSHOP_INPUT_FLOOR,
} from '../../../../../src/systems/computer-player/colony/goods/stock-policy.js';
import { colonists } from '../../../../../src/systems/computer-player/colony/roster.js';
import { addStock } from '../../../../../src/systems/missions/stock.js';
import {
  blankColony,
  colonyContent,
  colonyWorld,
  editColony,
  FOOD,
  looseColonyEnv,
  WHEAT,
} from '../../../../fixtures/colony-islands.js';
import { CIVILIST, FARM_TYPE, MILL_TYPE, SEAT, STOCK_TOP_TYPE, VIKING } from '../../support.js';

const WOOD = 1;
const BRICK = 2;
const SHOES = 3;
const MEAD = 4;
const LEATHER = 5;
const SWORD = 6;
const HANDCART = 7;
const GOLD = 8;
const WOOD_FLOOR = 20;
const BRICK_FLOOR = 15;
const SHOES_RESERVE = 4;
const HOME_KEEPS = 9;
/** A spot on the colony fixture's east island, in half-cell nodes. */
const EAST_ISLAND_AT = { x: 160, y: 40 };
/** More colonists than the larder's old cap of 40 food fed at three units each. */
const MOUTHS = 20;
const MOUTHS_A_ROW = 5;
const MOUTH_STEP = 4;
/** The food a colonist eats over a trader round. */
const FOOD_PER_MOUTH_ROUND = 3;
const FLOUR = 48;
const MILL_TICKS = 60;
const SEED = 7;
/** Where the chain's workshops stand, a row on open ground, in half-cell nodes. */
const CHAIN_AT = { x: 170, y: 100 };
const CHAIN_STEP = 12;
/** Grain in the colony's store, well past its building floor of ten. */
const GRAIN_HELD = 40;

function read(overrides: Partial<StockPolicyRead> = {}): StockPolicyRead {
  return {
    buildingFloor: new Map([
      [WOOD, WOOD_FLOOR],
      [BRICK, BRICK_FLOOR],
    ]),
    plainFloor: new Map([
      [WOOD, WOOD_FLOOR],
      [BRICK, BRICK_FLOOR],
    ]),
    settlerReserve: new Map([[SHOES, SHOES_RESERVE]]),
    wants: new Map(),
    workshopInputs: new Map(),
    makes: new Set(),
    held: new Map(),
    keptOnColony: new Set(),
    outboundNow: new Set(),
    homeKeep: () => HOME_KEEPS,
    homeWants: new Set(),
    siteLack: new Map(),
    ...overrides,
  };
}

const inboundOf = (policy: ColonyStockPolicy, good: number) => policy.inbound.find((m) => m.good === good);
const outboundOf = (policy: ColonyStockPolicy, good: number) => policy.outbound.find((m) => m.good === good);

describe('a colony stock policy', () => {
  it('fills the colony to its building floor and settler reserve, home keeping its own share', () => {
    const policy = colonyStockPolicy(read());
    expect(policy.inbound).toEqual([
      { good: WOOD, upTo: WOOD_FLOOR, keep: HOME_KEEPS },
      { good: BRICK, upTo: BRICK_FLOOR, keep: HOME_KEEPS },
      { good: SHOES, upTo: SHOES_RESERVE, keep: HOME_KEEPS },
    ]);
    expect(policy.outbound).toEqual([]);
  });

  it('asks nothing it makes but its building floor, and sends home what it makes above its floor', () => {
    const policy = colonyStockPolicy(
      read({
        makes: new Set([WOOD, SHOES, SWORD]),
        held: new Map([
          [WOOD, WOOD_FLOOR + 1],
          [SWORD, 3],
        ]),
      }),
    );
    expect(inboundOf(policy, SHOES)).toBeUndefined();
    expect(outboundOf(policy, SHOES)).toEqual({ good: SHOES, keep: SHOES_RESERVE });
    expect(outboundOf(policy, WOOD)).toEqual({ good: WOOD, keep: WOOD_FLOOR });
    expect(outboundOf(policy, SWORD)).toEqual({ good: SWORD, keep: 0 });
  });

  it("sends home what it holds above its floor of an input home's workshops lack, made there or not", () => {
    const held = new Map([[BRICK, BRICK_FLOOR + 2]]);
    expect(outboundOf(colonyStockPolicy(read({ held })), BRICK)).toBeUndefined();
    const policy = colonyStockPolicy(read({ held, homeWants: new Set([BRICK]) }));
    expect(outboundOf(policy, BRICK)).toEqual({ good: BRICK, keep: BRICK_FLOOR });
    expect(inboundOf(policy, BRICK)).toBeUndefined();
    const short = colonyStockPolicy(
      read({ held: new Map([[BRICK, BRICK_FLOOR - 1]]), homeWants: new Set([BRICK]) }),
    );
    expect(outboundOf(short, BRICK)).toBeUndefined();
  });

  it('moves a good it both makes and is filled up to one way at a time, meeting at the floor', () => {
    const at = (held: number, sending: boolean) =>
      colonyStockPolicy(
        read({
          makes: new Set([WOOD]),
          held: new Map([[WOOD, held]]),
          outboundNow: new Set(sending ? [WOOD] : []),
        }),
      );
    for (const policy of [at(WOOD_FLOOR - 1, true), at(WOOD_FLOOR, false)]) {
      expect(inboundOf(policy, WOOD)?.upTo).toBe(WOOD_FLOOR);
      expect(outboundOf(policy, WOOD)).toBeUndefined();
    }
    for (const policy of [at(WOOD_FLOOR + 1, false), at(WOOD_FLOOR, true)]) {
      expect(outboundOf(policy, WOOD)?.keep).toBe(WOOD_FLOOR);
      expect(inboundOf(policy, WOOD)).toBeUndefined();
    }
  });

  it('keeps at the colony what it fills the colony up to, for every good it moves either way', () => {
    const reads = [0, WOOD_FLOOR, 2 * WOOD_FLOOR].flatMap((held) =>
      [true, false].map((sending) =>
        read({
          makes: new Set([WOOD, BRICK, MEAD]),
          workshopInputs: new Map([
            [LEATHER, 0],
            [WOOD, 0],
          ]),
          settlerReserve: new Map([
            [SHOES, SHOES_RESERVE],
            [MEAD, 2],
          ]),
          held: new Map([
            [WOOD, held],
            [BRICK, held],
            [MEAD, held],
          ]),
          outboundNow: new Set(sending ? [WOOD, BRICK, MEAD] : []),
        }),
      ),
    );
    const upTo = new Map<number, number>();
    const keep = new Map<number, number>();
    for (const r of reads) {
      const policy = colonyStockPolicy(r);
      for (const m of policy.inbound) upTo.set(m.good, m.upTo);
      for (const m of policy.outbound) keep.set(m.good, m.keep);
      for (const m of policy.inbound) expect(outboundOf(policy, m.good)).toBeUndefined();
    }
    for (const [good, units] of keep) if (upTo.has(good)) expect(units).toBe(upTo.get(good));
    expect([...keep.keys()].filter((good) => upTo.has(good)).sort()).toEqual([WOOD, BRICK].sort());
  });

  it('brings in the inputs of its workshops at a small floor, unless it makes them', () => {
    const policy = colonyStockPolicy(
      read({
        workshopInputs: new Map([
          [LEATHER, 0],
          [GOLD, 0],
        ]),
        makes: new Set([GOLD]),
      }),
    );
    expect(inboundOf(policy, LEATHER)).toEqual({
      good: LEATHER,
      upTo: WORKSHOP_INPUT_FLOOR,
      keep: HOME_KEEPS,
    });
    expect(inboundOf(policy, GOLD)).toBeUndefined();
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: WORKSHOP_INPUT_FLOOR });
  });

  it('keeps an input its own workshops use up to their shelves before sending the rest home', () => {
    const shelves = 12;
    const policy = colonyStockPolicy(
      read({
        workshopInputs: new Map([[GOLD, shelves]]),
        makes: new Set([GOLD]),
        held: new Map([[GOLD, 20]]),
      }),
    );
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: shelves });
  });

  it('brings in what its buildings want past the rules, unless it makes it', () => {
    const oil = 9;
    const policy = colonyStockPolicy(read({ wants: new Map([[oil, 1]]) }));
    expect(inboundOf(policy, oil)).toEqual({ good: oil, upTo: 1, keep: HOME_KEEPS });
    expect(
      inboundOf(colonyStockPolicy(read({ wants: new Map([[oil, 1]]), makes: new Set([oil]) })), oil),
    ).toBeUndefined();
  });

  it('never sends what it keeps or what home brought it, and sends what it gathered', () => {
    const policy = colonyStockPolicy(
      read({
        makes: new Set([HANDCART]),
        keptOnColony: new Set([HANDCART]),
        held: new Map([
          [HANDCART, 2],
          [SHOES, 2 * SHOES_RESERVE],
          [GOLD, 3],
        ]),
      }),
    );
    expect(outboundOf(policy, HANDCART)).toBeUndefined();
    expect(outboundOf(policy, SHOES)).toBeUndefined();
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: 0 });
  });
});

describe("a colony's sites", () => {
  it('ask what they lack past the colony store with nothing kept at home, and only that much', () => {
    const policy = colonyStockPolicy(read({ siteLack: new Map([[BRICK, 2]]), held: new Map([[BRICK, 1]]) }));
    expect(inboundOf(policy, BRICK)).toEqual({ good: BRICK, upTo: 2, keep: 0 });
    const covered = colonyStockPolicy(read({ siteLack: new Map([[BRICK, 2]]), held: new Map([[BRICK, 2]]) }));
    expect(inboundOf(covered, BRICK)).toEqual({ good: BRICK, upTo: BRICK_FLOOR, keep: HOME_KEEPS });
  });

  it('keep at the colony a good it makes past its floor while a site lacks it', () => {
    const made = { makes: new Set([WOOD]), held: new Map([[WOOD, WOOD_FLOOR + 5]]) };
    expect(outboundOf(colonyStockPolicy(read(made)), WOOD)).toEqual({ good: WOOD, keep: WOOD_FLOOR });
    const lacking = colonyStockPolicy(read({ ...made, siteLack: new Map([[WOOD, 1]]) }));
    expect(outboundOf(lacking, WOOD)).toBeUndefined();
  });

  it("send home all above the plain floor of a good home lacks, whatever the colony's open bills owe", () => {
    const owed = WOOD_FLOOR + 30;
    const colony = {
      makes: new Set([WOOD]),
      held: new Map([[WOOD, WOOD_FLOOR + 10]]),
      buildingFloor: new Map([[WOOD, owed]]),
    };
    expect(outboundOf(colonyStockPolicy(read(colony)), WOOD)).toBeUndefined();
    const homeShort = colonyStockPolicy(read({ ...colony, homeWants: new Set([WOOD]) }));
    expect(outboundOf(homeShort, WOOD)).toEqual({ good: WOOD, keep: WOOD_FLOOR });
  });

  it('give way to home: what home lacks goes home above the colony floor, and none is asked of home', () => {
    const homeShort = { homeWants: new Set([WOOD]), siteLack: new Map([[WOOD, 3]]) };
    const surplus = colonyStockPolicy(
      read({ ...homeShort, makes: new Set([WOOD]), held: new Map([[WOOD, WOOD_FLOOR + 5]]) }),
    );
    expect(outboundOf(surplus, WOOD)).toEqual({ good: WOOD, keep: WOOD_FLOOR });
    const short = colonyStockPolicy(read({ ...homeShort, held: new Map([[WOOD, 1]]) }));
    expect(inboundOf(short, WOOD)).toEqual({ good: WOOD, upTo: WOOD_FLOOR, keep: HOME_KEEPS });
  });
});

describe("a colony's own chain", () => {
  /** The fixture's farm growing wheat, flagged an input good, and a mill grinding it into flour. */
  function chainContent(flagged: boolean) {
    const content = colonyContent();
    return parseContentSet({
      ...content,
      goods: [
        ...content.goods.map((g) =>
          g.typeId === WHEAT ? { ...g, classification: { ...g.classification, inputGood: flagged } } : g,
        ),
        { typeId: FLOUR, id: 'flour', weight: 1 },
      ],
      buildings: content.buildings.map((b) => {
        if (b.typeId === FARM_TYPE) return { ...b, produces: [WHEAT] };
        if (b.typeId !== MILL_TYPE) return b;
        const recipe = {
          inputs: [{ goodType: WHEAT, amount: 1 }],
          outputs: [{ goodType: FLOUR, amount: 1 }],
        };
        return { ...b, recipes: [{ ...recipe, ticks: MILL_TICKS }] };
      }),
    });
  }

  function chainOf(flagged: boolean, buildings: readonly { type: number; site: boolean }[]) {
    const sim = colonyWorld(SEED, chainContent(flagged));
    buildings.forEach(({ type, site }, i) => {
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: type,
        x: CHAIN_AT.x + i * CHAIN_STEP,
        y: CHAIN_AT.y,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction: site,
      });
    });
    sim.step();
    const env = looseColonyEnv(sim, blankColony(NO_COMPONENT));
    return chainIntermediates(env, everyBuildingOf(sim.world, SEAT));
  }

  it('keeps an input good one of its workshops makes while another of them, a site too, takes it in', () => {
    const farm = { type: FARM_TYPE, site: false };
    expect(chainOf(true, [farm, { type: MILL_TYPE, site: true }]).has(WHEAT)).toBe(true);
    expect(chainOf(true, [farm, { type: MILL_TYPE, site: false }]).has(WHEAT)).toBe(true);
    expect(chainOf(true, [farm]).has(WHEAT)).toBe(false);
    expect(
      chainOf(true, [
        { type: FARM_TYPE, site: true },
        { type: MILL_TYPE, site: false },
      ]).has(WHEAT),
    ).toBe(false);
  });

  it('never sends grain home, even with no mill of its own to take it in', () => {
    const sim = colonyWorld(SEED, chainContent(true));
    const carrier = aiControlEntity(sim.world, SEAT);
    const terrain = sim.terrain;
    if (carrier === null || terrain === undefined) throw new Error('setup: no AI seat or terrain');
    const land = terrain.componentOf(terrain.nodeAt(EAST_ISLAND_AT.x, EAST_ISLAND_AT.y));
    sim.world.add(carrier, ComputerColony, { colonies: [blankColony(land)], rejected: [], retryAt: 0 });
    for (const [i, type] of [FARM_TYPE, STOCK_TOP_TYPE].entries())
      sim.enqueueSetup({
        kind: 'placeBuilding',
        buildingType: type,
        x: EAST_ISLAND_AT.x + i * CHAIN_STEP,
        y: EAST_ISLAND_AT.y,
        tribe: VIKING,
        owner: SEAT,
        force: true,
        underConstruction: false,
      });
    sim.step();
    const store = everyBuildingOf(sim.world, SEAT).find(
      (e) => sim.world.get(e, Building).buildingType === STOCK_TOP_TYPE,
    );
    if (store === undefined) throw new Error('setup: no warehouse');
    addStock(sim.world, store, WHEAT, GRAIN_HELD);
    const policy = colonyStockPolicy({
      ...colonyStockReadsOf(looseColonyEnv(sim, editColony(sim))),
      outboundNow: new Set(),
    });

    expect(outboundOf(policy, WHEAT)).toBeUndefined();
  });

  it('lets a good the content does not flag as an input good go home', () => {
    expect(
      chainOf(false, [
        { type: FARM_TYPE, site: false },
        { type: MILL_TYPE, site: false },
      ]).size,
    ).toBe(0);
  });
});

describe("a colony's larder", () => {
  it('asks the food its people eat over a trader round, three units a mouth with no cap', () => {
    const sim = colonyWorld();
    const carrier = aiControlEntity(sim.world, SEAT);
    const terrain = sim.terrain;
    if (carrier === null || terrain === undefined) throw new Error('setup: no AI seat or terrain');
    const land = terrain.componentOf(terrain.nodeAt(EAST_ISLAND_AT.x, EAST_ISLAND_AT.y));
    const colony = blankColony(land);
    sim.world.add(carrier, ComputerColony, { colonies: [colony], rejected: [], retryAt: 0 });
    for (let i = 0; i < MOUTHS; i++)
      sim.enqueueSetup({
        kind: 'spawnSettler',
        jobType: CIVILIST,
        x: EAST_ISLAND_AT.x + MOUTH_STEP * (i % MOUTHS_A_ROW),
        y: EAST_ISLAND_AT.y + MOUTH_STEP * Math.floor(i / MOUTHS_A_ROW),
        tribe: VIKING,
        owner: SEAT,
      });
    sim.step();
    const env = looseColonyEnv(sim, editColony(sim));
    expect(colonists(env)).toHaveLength(MOUTHS);

    const policy = colonyStockPolicy({ ...colonyStockReadsOf(env), outboundNow: new Set() });

    expect(inboundOf(policy, FOOD)?.upTo).toBe(FOOD_PER_MOUTH_ROUND * MOUTHS);
  });
});
