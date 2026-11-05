import { buildingFootprintFor, type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  Owner,
  PalisadeBlocking,
  Position,
  UnderConstruction,
} from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  type NodeArea,
  type NodeGridAnswer,
  nodeGridAccepts,
  ONE,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { shipWaterWorkshopsOf } from '../../src/simulation/probe-answers.js';
import { doorNodeOf } from '../../src/systems/footprint/geometry.js';
import {
  chainShipHouse,
  SHIP_SITE_RINGS,
  shipWaterWithin,
  vehicleSiteWorkPoint,
} from '../../src/systems/footprint/placement/vehicle-site.js';
import { testContent } from '../fixtures/content.js';
import { SHIP_DOOR, SHIP_HULL, SHIP_WORK_AREA } from '../fixtures/ship-yard.js';

/**
 * The placement hint's ship-water grid (`Simulation.shipWaterGrid`): whether a workshop placed at each
 * anchor of an area would find ship water in its crew's yard search. The fixture pairs the yard rows of
 * `vehicle-yard.test.ts` with a two-tier joinery chain, so the verdict is read off the same ship house
 * the crew would raise, through the same rule the yard search runs.
 */

const P0 = 0;
const P1 = 1;
const VIKING = 1;
const GRASS = 0;
const WATER = 1;
const WOOD = 1;
const PLANK = 2;
const CART_GOOD = 50;
const SHIP_GOOD = 51;
const CART_YARD = 50;
const SHIP_YARD = 51;
const SHIP_WRIGHT = 52;
const JOINERY_00 = 53;
const JOINERY_03 = 54;
const CART_WRIGHT = 55;
const HEADQUARTERS = 1;
const HANDCART = 1;
const SHIP_SMALL = 3;
const MAP_CELLS = 24;
/** Cell rows that are open water at the top of the map. */
const SEA_ROWS = 4;
/** Cell column of the one-cell river that splits the river map into two banks. */
const RIVER_COLUMN = 12;
/** The ship wright on the shore, a few cells south of the sea; inland; and on the river's west bank. */
const SHOP_AT = cellNode(12, 6);
const SHOP_INLAND_AT = cellNode(12, 18);
const SHOP_WEST_BANK_AT = cellNode(6, 12);
/** A ship yard site in the river, its work area on both banks. */
const RIVER_SITE_AT = cellNode(RIVER_COLUMN, 10);
/** A ship wright on land a few cells north of a sea along the map's bottom. */
const SHOP_NORTH_OF_SEA_AT = cellNode(12, 15);
/** Every node of the {@link MAP_CELLS} map. */
const WHOLE_MAP = nodesOf(MAP_CELLS);
/** The rule comparison's map edge in cells. */
const WIDE_MAP_CELLS = 64;

function nodesOf(cells: number): NodeArea {
  return { minHx: 0, minHy: 0, maxHx: 2 * cells - 1, maxHy: 2 * cells - 1 };
}

/** The half-cell node of cell `(c, r)`. */
function cellNode(c: number, r: number): { readonly x: number; readonly y: number } {
  return { x: 2 * c + (r & 1), y: 2 * r };
}

function shipContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    goods: [
      ...base.goods,
      { typeId: CART_GOOD, id: 'handcart', weight: 1, vehicleHouse: CART_YARD },
      { typeId: SHIP_GOOD, id: 'ship_small', weight: 1, vehicleHouse: SHIP_YARD },
    ],
    buildings: [
      ...base.buildings,
      {
        typeId: CART_YARD,
        id: 'cart_yard',
        kind: 'vehicle',
        vehicleType: HANDCART,
        construction: [{ goodType: WOOD, amount: 2 }],
        hitpoints: 100,
        footprint: {
          blocked: [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
          ],
          familyBody: [
            { dx: 0, dy: -1 },
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 0, dy: 1 },
          ],
          reserved: [
            { dx: -1, dy: -1 },
            { dx: 0, dy: -1 },
            { dx: 1, dy: -1 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 0 },
            { dx: 1, dy: 0 },
            { dx: 2, dy: 0 },
            { dx: -1, dy: 1 },
            { dx: 0, dy: 1 },
            { dx: 1, dy: 1 },
          ],
          door: { dx: -1, dy: 1 },
        },
      },
      {
        typeId: SHIP_YARD,
        id: 'ship_yard',
        kind: 'vehicle',
        vehicleType: SHIP_SMALL,
        ignoreContinents: true,
        construction: [{ goodType: WOOD, amount: 3 }],
        hitpoints: 100,
        footprint: {
          blocked: SHIP_HULL,
          familyBody: SHIP_HULL,
          reserved: SHIP_HULL,
          door: SHIP_DOOR,
          workArea: SHIP_WORK_AREA,
        },
      },
      {
        // The shop whose own recipes name the ship good beside the land vehicles.
        typeId: SHIP_WRIGHT,
        id: 'ship_wright',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [],
        produces: [PLANK, CART_GOOD, SHIP_GOOD],
        recipes: [
          { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: PLANK, amount: 1 }], ticks: 20 },
          { inputs: [], outputs: [{ goodType: CART_GOOD, amount: 1 }], ticks: 20 },
          { inputs: [], outputs: [{ goodType: SHIP_GOOD, amount: 1 }], ticks: 20 },
        ],
      },
      {
        // The chain's lower tier makes no vehicle good; the ship water verdict rides its upgradeTarget.
        typeId: JOINERY_00,
        id: 'joinery_00',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [],
        produces: [PLANK],
        recipes: [
          { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: PLANK, amount: 1 }], ticks: 20 },
        ],
        upgradeTarget: JOINERY_03,
      },
      {
        typeId: JOINERY_03,
        id: 'joinery_03',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [],
        produces: [PLANK, CART_GOOD, SHIP_GOOD],
        recipes: [
          { inputs: [], outputs: [{ goodType: CART_GOOD, amount: 1 }], ticks: 20 },
          { inputs: [], outputs: [{ goodType: SHIP_GOOD, amount: 1 }], ticks: 20 },
        ],
      },
      {
        // A wright whose chain builds land vehicles only, so no verdict applies to its placements.
        typeId: CART_WRIGHT,
        id: 'cart_wright',
        kind: 'workplace',
        workers: [{ jobType: 2, count: 1 }],
        stock: [],
        produces: [CART_GOOD],
        recipes: [{ inputs: [], outputs: [{ goodType: CART_GOOD, amount: 1 }], ticks: 20 }],
      },
    ],
  });
}

/** The top `waterRows` cell rows open water, land below. */
function seaMap(waterRows: number): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < waterRows; row++) {
    for (let col = 0; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

/** The bottom `waterRows` cell rows open water, land above: a yard's door, south of its hull, lands in
 *  the sea, so only its work area reaches the shore. */
function southSeaMap(waterRows: number): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = MAP_CELLS - waterRows; row < MAP_CELLS; row++) {
    for (let col = 0; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

/** A {@link WIDE_MAP_CELLS} square with {@link southSeaMap}'s sea and {@link riverMap}'s river running
 *  down into it: wide enough that its far corner lies past every ring. */
function wideSouthSeaRiverMap(): TerrainMap {
  const typeIds = new Array<number>(WIDE_MAP_CELLS * WIDE_MAP_CELLS).fill(GRASS);
  for (let row = 0; row < WIDE_MAP_CELLS; row++) {
    for (let col = 0; col < WIDE_MAP_CELLS; col++) {
      if (row >= WIDE_MAP_CELLS - SEA_ROWS || col === RIVER_COLUMN)
        typeIds[row * WIDE_MAP_CELLS + col] = WATER;
    }
  }
  return halfCellMapFromCells({ width: WIDE_MAP_CELLS, height: WIDE_MAP_CELLS, typeIds });
}

/** A grass map cut by a one-cell river: water in reach, but none the hull's clearance admits. */
function riverMap(): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < MAP_CELLS; row++) typeIds[row * MAP_CELLS + RIVER_COLUMN] = WATER;
  return halfCellMapFromCells({ width: MAP_CELLS, height: MAP_CELLS, typeIds });
}

function sim(map: TerrainMap): Simulation {
  return new Simulation({ seed: 5, content: shipContent(), map });
}

/** A building anchored at node `(x, y)`. */
function buildingAt(s: Simulation, buildingType: number, x: number, y: number, owner = P0): Entity {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(x, y));
  s.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  s.world.add(e, Owner, { player: owner });
  return e;
}

/** An unfinished ship yard site anchored at node `(x, y)`. */
function shipSiteAt(s: Simulation, x: number, y: number, owner = P0): Entity {
  const e = buildingAt(s, SHIP_YARD, x, y, owner);
  s.world.mut(e, Building).built = fx.fromInt(0);
  s.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  return e;
}

/** Whether the grid over the whole map answers ship water for a workshop anchored at `at`. */
function shipWaterAt(
  s: Simulation,
  buildingType: number,
  at: { readonly x: number; readonly y: number },
  player = P0,
): boolean | null {
  const grid = s.shipWaterGrid(buildingType, VIKING, WHOLE_MAP, player);
  return grid === null ? null : nodeGridAccepts(grid, at.x, at.y);
}

describe('shipWaterGrid', () => {
  it('answers ship water for a ship wright placed beside the open sea', () => {
    expect(shipWaterAt(sim(seaMap(SEA_ROWS)), SHIP_WRIGHT, SHOP_AT)).toBe(true);
  });

  it('answers ship water where the yard door would stand in the sea, through the work area', () => {
    expect(shipWaterAt(sim(southSeaMap(SEA_ROWS)), SHIP_WRIGHT, SHOP_NORTH_OF_SEA_AT)).toBe(true);
  });

  it('refuses a ship wright on a map without water', () => {
    expect(shipWaterAt(sim(seaMap(0)), SHIP_WRIGHT, SHOP_INLAND_AT)).toBe(false);
  });

  it('refuses water in reach that the hull does not fit, and counts the seat yard there', () => {
    expect(shipWaterAt(sim(riverMap()), SHIP_WRIGHT, SHOP_WEST_BANK_AT)).toBe(false);

    // The seat's unfinished ship yard on the river, worked from the worker's bank, is ship water.
    const crewed = sim(riverMap());
    shipSiteAt(crewed, RIVER_SITE_AT.x, RIVER_SITE_AT.y, P0);
    expect(shipWaterAt(crewed, SHIP_WRIGHT, SHOP_WEST_BANK_AT)).toBe(true);

    // A rival's yard there is no ship water of this seat's.
    const rival = sim(riverMap());
    shipSiteAt(rival, RIVER_SITE_AT.x, RIVER_SITE_AT.y, P1);
    expect(shipWaterAt(rival, SHIP_WRIGHT, SHOP_WEST_BANK_AT)).toBe(false);
  });

  it('answers each anchor as the per-anchor yard rule does', () => {
    const s = sim(wideSouthSeaRiverMap());
    shipSiteAt(s, RIVER_SITE_AT.x, RIVER_SITE_AT.y, P0);
    const area = nodesOf(WIDE_MAP_CELLS);
    const terrain = s.terrain;
    const content = shipContent();
    const house = chainShipHouse(contentIndex(content), SHIP_WRIGHT);
    const yards = s.world.canonicalQuery(UnderConstruction);
    const grid = s.shipWaterGrid(SHIP_WRIGHT, VIKING, area, P0);
    expect(terrain === undefined || house === null || grid === null).toBe(false);
    if (terrain === undefined || house === null || grid === null) return;
    const shop = buildingFootprintFor(contentIndex(content).buildings.get(SHIP_WRIGHT) ?? never(), VIKING);
    let accepted = 0;
    let sampled = 0;
    for (let hy = 0; hy <= area.maxHy; hy += SAMPLE_STEP) {
      for (let hx = 0; hx <= area.maxHx; hx += SAMPLE_STEP) {
        sampled++;
        const shore = terrain.componentOf(doorNodeOf(terrain, shop, hx, hy) ?? terrain.nodeAt(hx, hy));
        const expected = shipWaterWithin(
          s.world,
          { content },
          terrain,
          house,
          VIKING,
          P0,
          { hx, hy },
          shore,
          SHIP_SITE_RINGS,
          yards,
          (site) => vehicleSiteWorkPoint(s.world, { content }, terrain, site, shore) !== null,
        );
        expect(nodeGridAccepts(grid, hx, hy), `anchor ${hx},${hy}`).toBe(expected);
        if (expected) accepted++;
      }
    }
    // The sample holds both answers, so the comparison is not vacuous.
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(sampled);
    // An area the app asks for, inside the map at an odd origin, answers as the whole map does.
    const inner = s.shipWaterGrid(SHIP_WRIGHT, VIKING, INNER_AREA, P0);
    for (let hy = INNER_AREA.minHy; hy <= INNER_AREA.maxHy; hy++) {
      for (let hx = INNER_AREA.minHx; hx <= INNER_AREA.maxHx; hx++) {
        expect(inner === null ? null : nodeGridAccepts(inner, hx, hy), `inner ${hx},${hy}`).toBe(
          nodeGridAccepts(grid, hx, hy),
        );
      }
    }
  });

  it('answers the lower tier of the chain by its upgrade target', () => {
    const s = sim(seaMap(SEA_ROWS));
    expect(gridOf(s, JOINERY_00)).toEqual(gridOf(s, JOINERY_03));
    expect(shipWaterAt(s, JOINERY_00, SHOP_AT)).toBe(true);
  });

  it('answers null where the chain builds no ships and for a typeless building', () => {
    const s = sim(seaMap(SEA_ROWS));
    expect(s.shipWaterGrid(CART_WRIGHT, VIKING, WHOLE_MAP, P0)).toBeNull();
    expect(s.shipWaterGrid(HEADQUARTERS, VIKING, WHOLE_MAP, P0)).toBeNull();
  });

  it('names the chain tiers in the workshop set and leaves the land-vehicle wright out', () => {
    const workshops = shipWaterWorkshopsOf(shipContent());
    expect(workshops.has(SHIP_WRIGHT)).toBe(true);
    expect(workshops.has(JOINERY_00)).toBe(true);
    expect(workshops.has(JOINERY_03)).toBe(true);
    expect(workshops.has(CART_WRIGHT)).toBe(false);
    expect(workshops.has(HEADQUARTERS)).toBe(false);
  });

  it("moves the answer's key when a blocker stands or a wall closes, and not on a construction stroke", () => {
    const s = sim(seaMap(SEA_ROWS));
    const site = shipSiteAt(s, RIVER_SITE_AT.x, RIVER_SITE_AT.y);
    const before = gridOf(s, SHIP_WRIGHT)?.key;
    s.world.mut(site, Building).built = fx.div(ONE, fx.fromInt(2));
    expect(gridOf(s, SHIP_WRIGHT)?.key).toEqual(before);
    buildingAt(s, HEADQUARTERS, SHOP_AT.x + 4, SHOP_AT.y);
    const placed = gridOf(s, SHIP_WRIGHT)?.key;
    expect(placed).not.toEqual(before);
    s.world.add(site, PalisadeBlocking, {});
    expect(gridOf(s, SHIP_WRIGHT)?.key).not.toEqual(placed);
  });
});

/** A probe-sized area inside the wide map at an odd origin, where the river's reuse yard and the
 *  sea's far edge both pass through. */
const INNER_AREA: NodeArea = { minHx: 37, minHy: 33, maxHx: 68, maxHy: 64 };

/** Every how many nodes the rule comparison samples an anchor, per axis. */
const SAMPLE_STEP = 5;

function gridOf(s: Simulation, buildingType: number): NodeGridAnswer | null {
  return s.shipWaterGrid(buildingType, VIKING, WHOLE_MAP, P0);
}

function never(): never {
  throw new Error('fixture row missing');
}
