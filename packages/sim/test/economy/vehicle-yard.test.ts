import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  CraftSelection,
  JobAssignment,
  Owner,
  Position,
  Production,
  Settler,
  SiteAssignment,
  Stockpile,
  UnderConstruction,
  Vehicle,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation, type TerrainMap } from '../../src/index.js';
import { type HalfCellNode, hexagonRing, hexDistance, nodeOfPosition } from '../../src/nav/halfcell.js';
import {
  findVehicleSite,
  VEHICLE_SITE_PLACEMENT_RINGS,
  VEHICLE_SITE_REUSE_RINGS,
} from '../../src/systems/footprint/index.js';
import { plannerSystem } from '../../src/systems/index.js';
import { createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The VEHICLE YARD drive (docs/formats/VEHICLES.md "Construction"): a workshop operator whose rotation
 * reaches a vehicle good raises the good's yard house as a hidden site beside the workshop, crews it
 * like a builder, and the finished site launches the vehicle. The yard rows are appended below to the
 * shared fixture: a handcart good and its 2-wood yard, a ship good and its yard on the water, and a
 * wainwright, the joinery shape that makes planks beside the two vehicles; the HQ holds the wood.
 */

const P0 = 0;
const P1 = 1;
const VIKING = 1;
const GRASS = 0;
const WATER = 1;
const WOOD = 1;
const PLANK = 2;
const HANDCART_GOOD = 50;
const SHIP_GOOD = 51;
const HANDCART_YARD = 50;
const SHIP_YARD = 51;
const WAINWRIGHT = 52;
const HEADQUARTERS = 1;
const CARPENTER = 2;
/** The fixture's tech enabler: a plank is producible once a woodcutter lives in the tribe. */
const WOODCUTTER = 1;
const HANDCART = 1;
const SHIP_SMALL = 3;
const HANDCART_WOOD = 2;
/** The fixture's `needforgood PLANK` gate: the wood track's raw XP that clears it. */
const WOOD_TRACK = 1;
const PLANK_GATE_RAW_XP = 300;
const MAP_CELLS = 24;
/** Well past the 2-wood site's fetch, delivery and hammering. */
const BUILD_BUDGET_TICKS = 3000;

/** The shared fixture plus the yard rows; local to this file so the save fixture's content fingerprint
 *  stays put. */
function yardContent(): ContentSet {
  const base = testContent();
  return parseContentSet({
    ...base,
    // Each vehicle good pairs with the yard house that builds it (the real `vehicleHouse` shape).
    goods: [
      ...base.goods,
      { typeId: HANDCART_GOOD, id: 'handcart', weight: 1, vehicleHouse: HANDCART_YARD },
      { typeId: SHIP_GOOD, id: 'ship_small', weight: 1, vehicleHouse: SHIP_YARD },
    ],
    buildings: [
      ...base.buildings,
      {
        // The handcart yard (the real house 42 shape: `vehicle` kind, `logicvehicletype 1`, 2 wood) with
        // the real footprint, door on the south-west.
        typeId: HANDCART_YARD,
        id: 'handcart_yard',
        kind: 'vehicle',
        vehicleType: HANDCART,
        construction: [{ goodType: WOOD, amount: HANDCART_WOOD }],
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
        // The small-ship yard (the real house 44 shape: `logicignorecontinentsflag 1`): its site lies on
        // the water with the door three rows south on the shore. A one-node body keeps the water fixture
        // small; the ship's own `logicSize` 2 disc is what the water clearance reads.
        typeId: SHIP_YARD,
        id: 'ship_yard',
        kind: 'vehicle',
        vehicleType: SHIP_SMALL,
        ignoreContinents: true,
        construction: [{ goodType: WOOD, amount: 3 }],
        hitpoints: 100,
        footprint: {
          blocked: [{ dx: 0, dy: 0 }],
          familyBody: [{ dx: 0, dy: 0 }],
          reserved: [{ dx: 0, dy: 0 }],
          door: { dx: 0, dy: 3 },
        },
      },
      {
        // The joinery shape that lists vehicle goods among its products (real joinery 02:
        // `logicproduction 59`, `logicstock 59 20 0`) beside wood -> plank.
        typeId: WAINWRIGHT,
        id: 'wainwright',
        kind: 'workplace',
        workers: [{ jobType: CARPENTER, count: 1 }],
        stock: [
          { goodType: WOOD, capacity: 20, initial: 0 },
          { goodType: PLANK, capacity: 20, initial: 0 },
          { goodType: HANDCART_GOOD, capacity: 20, initial: 0 },
          { goodType: SHIP_GOOD, capacity: 20, initial: 0 },
        ],
        produces: [PLANK, HANDCART_GOOD, SHIP_GOOD],
        recipes: [
          { inputs: [{ goodType: WOOD, amount: 1 }], outputs: [{ goodType: PLANK, amount: 1 }], ticks: 20 },
          { inputs: [], outputs: [{ goodType: HANDCART_GOOD, amount: 1 }], ticks: 20 },
          { inputs: [], outputs: [{ goodType: SHIP_GOOD, amount: 1 }], ticks: 20 },
        ],
      },
    ],
  });
}

function sim(map: TerrainMap = grassCellMap(MAP_CELLS, MAP_CELLS)): Simulation {
  return new Simulation({ seed: 5, content: yardContent(), map });
}

/** The top `waterRows` cell rows open water on continent 1, land below; land nodes read continent 0. */
function shoreMap(waterRows: number): TerrainMap {
  const typeIds = new Array<number>(MAP_CELLS * MAP_CELLS).fill(GRASS);
  for (let row = 0; row < waterRows; row++) {
    for (let col = 0; col < MAP_CELLS; col++) typeIds[row * MAP_CELLS + col] = WATER;
  }
  const width = MAP_CELLS * 2;
  const height = MAP_CELLS * 2;
  const nodeTypes = new Array<number>(width * height);
  const waterContinents = new Array<number>(width * height);
  for (let hy = 0; hy < height; hy++) {
    for (let hx = 0; hx < width; hx++) {
      const t = typeIds[(hy >> 1) * MAP_CELLS + (hx >> 1)] ?? GRASS;
      nodeTypes[hy * width + hx] = t;
      waterContinents[hy * width + hx] = t === WATER ? 1 : 0;
    }
  }
  return { resolution: 'half-cell', width, height, typeIds: nodeTypes, waterContinents };
}

function buildingAt(s: Simulation, buildingType: number, x: number, y: number, owner = P0): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  s.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  s.world.add(e, Stockpile, { amounts: new Map() });
  s.world.add(e, Owner, { player: owner });
  return e;
}

function siteAt(s: Simulation, buildingType: number, x: number, y: number, owner = P0): Entity {
  const e = buildingAt(s, buildingType, x, y, owner);
  s.world.mut(e, Building).built = fx.fromInt(0);
  s.world.add(e, UnderConstruction, { labor: fx.fromInt(0) });
  return e;
}

function carpenterAt(s: Simulation, x: number, y: number, workplace: Entity, owner = P0): Entity {
  const e = s.world.create();
  s.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(s.world, e, {
    tribe: VIKING,
    jobType: CARPENTER,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map(),
  });
  s.world.add(e, JobAssignment, { workplace });
  s.world.add(e, Owner, { player: owner });
  return e;
}

function anchorOf(s: Simulation, e: Entity): HalfCellNode {
  const p = s.world.get(e, Position);
  return nodeOfPosition(p.x, p.y);
}

function sitesOf(s: Simulation, buildingType: number): Entity[] {
  return [...s.world.query(Building, UnderConstruction)].filter(
    (e) => s.world.get(e, Building).buildingType === buildingType,
  );
}

/** Step until the worker's crew membership is gone, within the next plan or so. */
function stepUntilReleased(s: Simulation, worker: Entity, budget = 100): boolean {
  for (let i = 0; i < budget && s.world.has(worker, SiteAssignment); i++) s.step();
  return !s.world.has(worker, SiteAssignment);
}

function vehiclesOf(s: Simulation, vehicleType: number): Entity[] {
  return [...s.world.query(Vehicle)].filter((e) => s.world.get(e, Vehicle).vehicleType === vehicleType);
}

/** A wainwright at the map's middle with its carpenter on the door and an HQ full of wood beside it. */
function yardWorld(s: Simulation, select: readonly number[] = [HANDCART_GOOD]) {
  const shop = buildingAt(s, WAINWRIGHT, 12, 12);
  const store = buildingAt(s, HEADQUARTERS, 6, 12);
  s.world.mut(store, Stockpile).amounts.set(WOOD, 10);
  const worker = carpenterAt(s, 12, 13, shop);
  s.world.add(worker, CraftSelection, { goods: [...select], cursor: 0 });
  return { shop, store, worker };
}

describe('the yard site search', () => {
  it('opens the site at the first admissible ring point of the work centre, inside the placement ring', () => {
    const s = sim();
    const { shop, worker } = yardWorld(s);
    plannerSystem(s.world, ctxOf(s));
    const [site] = sitesOf(s, HANDCART_YARD);
    if (site === undefined) throw new Error('no yard site opened');
    const centre = anchorOf(s, shop);
    const at = anchorOf(s, site);
    expect(hexDistance(centre, at)).toBeLessThan(VEHICLE_SITE_PLACEMENT_RINGS);
    // The walk visits the rings in the original's order: ring 0 is the workshop's own node and every
    // ring-1 anchor keeps that node inside the yard's reserved margin, so ring 2's first point, two steps
    // north-west of the centre, takes the site.
    const [first] = [...hexagonRing(centre, 2)];
    expect(at).toEqual(first?.point);
    expect(s.world.get(worker, SiteAssignment)).toEqual({ site, pinned: false });
    expect(s.world.get(site, Owner).player).toBe(P0);
    expect(s.world.get(site, Building)).toMatchObject({ buildingType: HANDCART_YARD, tribe: VIKING });
  });

  it('reuses an unfinished yard of the owner inside the reuse ring instead of opening another', () => {
    const s = sim();
    const { shop, worker } = yardWorld(s);
    const centre = anchorOf(s, shop);
    const near = siteAt(s, HANDCART_YARD, 12 + 7, 12); // 14 hex steps east, inside r < 20
    expect(hexDistance(centre, anchorOf(s, near))).toBeLessThan(VEHICLE_SITE_REUSE_RINGS);
    plannerSystem(s.world, ctxOf(s));
    expect(sitesOf(s, HANDCART_YARD)).toEqual([near]);
    expect(s.world.get(worker, SiteAssignment).site).toBe(near);
  });

  it('leaves a yard past the reuse ring, and another player’s yard, alone', () => {
    const s = sim();
    const { shop } = yardWorld(s);
    const centre = anchorOf(s, shop);
    const far = siteAt(s, HANDCART_YARD, 12 + 11, 12); // 22 hex steps east, past r < 20
    expect(hexDistance(centre, anchorOf(s, far))).toBeGreaterThanOrEqual(VEHICLE_SITE_REUSE_RINGS);
    const rival = siteAt(s, HANDCART_YARD, 12, 12 + 4, P1);
    plannerSystem(s.world, ctxOf(s));
    const sites = sitesOf(s, HANDCART_YARD);
    expect(sites).toHaveLength(3);
    expect(sites).toContain(far);
    expect(sites).toContain(rival);
  });

  it('reports the yard occupied when a parked cart is all that stands in the one spot', () => {
    // A 2x2-cell map with the wainwright on its top-left node leaves exactly one anchor whose reserved
    // margin fits the map and misses the workshop.
    const s = sim(grassCellMap(2, 2));
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const shop = buildingAt(s, WAINWRIGHT, 0, 0);
    const centre = anchorOf(s, shop);
    const here = terrain.nodeAt(centre.hx, centre.hy);
    // Park a cart on each spot the search opens in turn: a parked cart is skipped where it stands, and
    // once nothing else fits the verdict names the cart rather than the ground.
    const taken: HalfCellNode[] = [];
    let verdict = findVehicleSite(s.world, ctxOf(s), terrain, HANDCART_YARD, centre, here);
    while (verdict.kind === 'site' && taken.length < 8) {
      expect(taken).not.toContainEqual(verdict.node);
      taken.push(verdict.node);
      createVehicle(s.world, ctxOf(s), {
        vehicleType: HANDCART,
        x: verdict.node.hx,
        y: verdict.node.hy,
        tribe: VIKING,
      });
      verdict = findVehicleSite(s.world, ctxOf(s), terrain, HANDCART_YARD, centre, here);
    }
    expect(taken.length).toBeGreaterThan(0);
    expect(verdict).toEqual({ kind: 'occupied' });
  });

  it('reports no site on ground too small for the yard, once, and parks the worker', () => {
    const s = sim(grassCellMap(2, 2));
    const shop = buildingAt(s, WAINWRIGHT, 1, 1);
    const worker = carpenterAt(s, 1, 1, shop);
    s.world.add(worker, CraftSelection, { goods: [HANDCART_GOOD], cursor: 0 });
    const refusals = () =>
      s.events
        .current()
        .flatMap((ev) => (ev.kind === 'vehicleSiteRefused' ? [`${ev.entity}:${ev.reason}`] : []));
    s.step();
    expect(refusals()).toEqual([`${worker}:notFound`]);
    s.step();
    expect(refusals()).toEqual([]);
    expect(sitesOf(s, HANDCART_YARD)).toEqual([]);
    expect(s.world.has(worker, SiteAssignment)).toBe(false);
  });

  it('lands a ship yard on the water beside the shipyard with its work point on the worker’s shore', () => {
    const s = sim(shoreMap(MAP_CELLS / 2));
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('mapped sim');
    const shop = buildingAt(s, WAINWRIGHT, 12, 13); // two cell rows below the shore
    const worker = carpenterAt(s, 12, 14, shop);
    s.world.add(worker, CraftSelection, { goods: [SHIP_GOOD], cursor: 0 });
    plannerSystem(s.world, ctxOf(s));
    const [site] = sitesOf(s, SHIP_YARD);
    if (site === undefined) throw new Error('no ship yard opened');
    const at = anchorOf(s, site);
    expect(terrain.isWalkable(terrain.nodeAt(at.hx, at.hy))).toBe(false);
    expect(hexDistance(anchorOf(s, shop), at)).toBeLessThan(VEHICLE_SITE_PLACEMENT_RINGS);
    // The fixture's door lies three rows south of the anchor: on the shore, on the worker's continent.
    const door = terrain.nodeAt(at.hx, at.hy + 3);
    const workerNode = terrain.nodeAt(anchorOf(s, worker).hx, anchorOf(s, worker).hy);
    expect(terrain.isWalkable(door)).toBe(true);
    expect(terrain.componentOf(door)).toBe(terrain.componentOf(workerNode));
  });

  it('refuses a ship yard to a shipyard with no water in reach', () => {
    const s = sim();
    const { worker } = yardWorld(s, [SHIP_GOOD]);
    s.step();
    expect(s.events.current().filter((ev) => ev.kind === 'vehicleSiteRefused')).toEqual([
      { kind: 'vehicleSiteRefused', entity: worker, reason: 'notFound' },
    ]);
  });
});

describe('building the vehicle', () => {
  it('fetches the bill through the site, launches the cart on it, and never shelves the good', () => {
    const s = sim();
    const { shop, store, worker } = yardWorld(s);
    let ticks = 0;
    let shelved = 0;
    while (vehiclesOf(s, HANDCART).length === 0 && ticks < BUILD_BUDGET_TICKS) {
      s.step();
      ticks++;
      shelved = Math.max(shelved, s.world.get(shop, Stockpile).amounts.get(HANDCART_GOOD) ?? 0);
    }
    const [cart] = vehiclesOf(s, HANDCART);
    if (cart === undefined) throw new Error(`no handcart after ${ticks} ticks`);
    expect(shelved).toBe(0);
    expect(sitesOf(s, HANDCART_YARD)).toEqual([]); // the site left with the launch
    expect(s.world.get(cart, Owner).player).toBe(P0);
    expect(s.world.get(cart, Vehicle)).toMatchObject({ vehicleType: HANDCART, tribe: VIKING });
    // The two wood went into the cart, from the HQ, through the site: nothing else consumed wood.
    expect(s.world.get(store, Stockpile).amounts.get(WOOD)).toBe(10 - HANDCART_WOOD);
    expect(s.world.get(shop, Stockpile).amounts.get(WOOD) ?? 0).toBe(0);
    // With carts the only product picked, the next turn is a cart again: a fresh site opens and the
    // worker crews it, so the joinery keeps turning out carts.
    for (let i = 0; i < 20 && sitesOf(s, HANDCART_YARD).length === 0; i++) s.step();
    const [next] = sitesOf(s, HANDCART_YARD);
    expect(next).toBeDefined();
    expect(s.world.get(worker, SiteAssignment).site).toBe(next);
    expect(s.checkInvariants()).toEqual([]);
  });

  it('alternates: the cart turn follows a plank start and the rotation moves past it once built', () => {
    const s = sim();
    const { shop, worker } = yardWorld(s, [PLANK, HANDCART_GOOD]);
    s.world.mut(shop, Stockpile).amounts.set(WOOD, 5);
    s.world.mut(worker, Settler).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP); // planks are earned
    s.enqueueSetup({ kind: 'spawnSettler', jobType: WOODCUTTER, x: 4, y: 4, tribe: VIKING, owner: P0 }); // and unlocked
    let ticks = 0;
    let plankStarted = false;
    while (vehiclesOf(s, HANDCART).length === 0 && ticks < BUILD_BUDGET_TICKS) {
      s.step();
      ticks++;
      plankStarted ||= s.world.tryGet(shop, Production)?.cycles.some((c) => c.goodType === PLANK) === true;
    }
    expect(vehiclesOf(s, HANDCART)).toHaveLength(1);
    expect(plankStarted).toBe(true); // the plank turn came first, and its batch waits for the operator
    expect(stepUntilReleased(s, worker)).toBe(true);
    expect(s.world.get(worker, CraftSelection).cursor).toBe(0); // past the cart, back to the plank
  });
});
