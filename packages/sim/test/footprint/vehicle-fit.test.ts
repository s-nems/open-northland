import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position, Settler, seatPassenger, VehicleDrive } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  type HalfCellNode,
  hexNeighboursOf,
  nodeOfPosition,
  ONE,
  playerCommand,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import {
  BUILDING_TOLERANCE_NEIGHBOURS,
  landVehicleFits,
  RESOURCE_TOLERANCE_NEIGHBOURS,
  vehicleStandable,
} from '../../src/systems/footprint/vehicle-clearance.js';
import { boardRider, createVehicle, snapVehicleTarget } from '../../src/systems/vehicles/index.js';
import { TEST_MANIFEST, testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';

/**
 * The land vehicle fit (docs/formats/VEHICLES.md "Movement"): a catapult's disc may overlap up to two
 * tree cells and two building cells beside an open anchor, while walls, water and a cart's class
 * test stay as they were.
 */

const GRASS = 0;
const WATER = 1;
const BLOCK_TYPE = 30; // walk-blocks its anchor node
const VIKING = 1;
const WALL_TYPE = 1;
const CATAPULT_SIZE = 1;
const CART_SIZE = 0;
const NODE_W = 24;
const NODE_H = 24;
/** An even-row node well inside the map, whose six neighbours the cases block in turn. */
const AT = { hx: 10, hy: 10 } as const;
/** An odd-row node, whose neighbours in the rows above and below lean one column east. */
const AT_ODD = { hx: 10, hy: 11 } as const;

function map(water: (hx: number, hy: number) => boolean = () => false): TerrainMap {
  const typeIds: number[] = [];
  for (let hy = 0; hy < NODE_H; hy++) {
    for (let hx = 0; hx < NODE_W; hx++) typeIds.push(water(hx, hy) ? WATER : GRASS);
  }
  const wall = { maxHitpoints: 100, repairPerStrike: 1, construction: [] };
  return {
    resolution: 'half-cell',
    width: NODE_W,
    height: NODE_H,
    typeIds,
    landscapes: {
      types: [{ typeId: WALL_TYPE, walk: [{ dx: 0, dy: 0 }], build: [], groups: [], wall }],
      placements: [],
    },
  };
}

function sim(terrainMap: TerrainMap = map()): Simulation {
  const content = parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    buildings: [
      { typeId: BLOCK_TYPE, id: 'block', kind: 'storage', footprint: { blocked: [{ dx: 0, dy: 0 }] } },
    ],
  });
  return new Simulation({ seed: 1, content, map: terrainMap });
}

function tree(s: Simulation, hx: number, hy: number): void {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  stampResourceFootprintData(s.world, e, { walk: [{ dx: 0, dy: 0 }], build: [], work: [] });
}

function house(s: Simulation, hx: number, hy: number): void {
  const e = s.world.create();
  s.world.add(e, Position, positionOfNode(hx, hy));
  s.world.add(e, Building, { buildingType: BLOCK_TYPE, tribe: VIKING, built: ONE, level: 0 });
}

function wall(s: Simulation, hx: number, hy: number): void {
  s.enqueueSetup({ kind: 'placePalisade', gfxIndex: WALL_TYPE, x: hx, y: hy, tribe: VIKING, owner: 0 });
}

const neighbours = hexNeighboursOf(AT.hx, AT.hy);

function fitsAt(s: Simulation, size: number, at: { hx: number; hy: number } = AT): boolean {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('map missing');
  return landVehicleFits(s.world, ctxOf(s), terrain, size)(terrain.nodeAt(at.hx, at.hy));
}

function standsAt(s: Simulation, size: number, at: { hx: number; hy: number }): boolean {
  const terrain = s.terrain;
  if (terrain === undefined) throw new Error('map missing');
  return vehicleStandable(s.world, ctxOf(s), terrain, size)(terrain.nodeAt(at.hx, at.hy));
}

function neighbour(index: number, of = neighbours): { hx: number; hy: number } {
  const n = of[index];
  if (n === undefined) throw new Error(`no neighbour ${index}`);
  return n;
}

describe('landVehicleFits', () => {
  it('admits a catapult between two trees and refuses it among three', () => {
    const s = sim();
    for (let i = 0; i < RESOURCE_TOLERANCE_NEIGHBOURS; i++) tree(s, neighbour(i).hx, neighbour(i).hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(true);
    const third = neighbour(RESOURCE_TOLERANCE_NEIGHBOURS);
    tree(s, third.hx, third.hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);
  });

  it('admits a catapult beside two houses and refuses it beside three', () => {
    const s = sim();
    for (let i = 0; i < BUILDING_TOLERANCE_NEIGHBOURS; i++) house(s, neighbour(i).hx, neighbour(i).hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(true);
    const third = neighbour(BUILDING_TOLERANCE_NEIGHBOURS);
    house(s, third.hx, third.hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);
  });

  it('counts trees and houses apart: two of each still fit', () => {
    const s = sim();
    tree(s, neighbour(0).hx, neighbour(0).hy);
    tree(s, neighbour(1).hx, neighbour(1).hy);
    house(s, neighbour(2).hx, neighbour(2).hy);
    house(s, neighbour(3).hx, neighbour(3).hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(true);
  });

  it('never admits a blocked anchor', () => {
    const s = sim();
    tree(s, AT.hx, AT.hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);
  });

  it('keeps a wall hard: one wall neighbour refuses the catapult, as does a house touching a wall', () => {
    const s = sim();
    wall(s, neighbour(0).hx, neighbour(0).hy);
    s.step();
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);

    const t = sim();
    // A house beside the anchor whose far side leans on a wall two steps out.
    const inner = neighbour(0);
    house(t, inner.hx, inner.hy);
    wall(t, inner.hx + 1, inner.hy);
    t.step();
    expect(fitsAt(t, CATAPULT_SIZE)).toBe(false);
  });

  it('keeps water hard for a land vehicle', () => {
    const s = sim(map((hx, hy) => hx === neighbour(0).hx && hy === neighbour(0).hy));
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);
  });

  it('leaves carts on the class test: a cart fits anywhere open', () => {
    const s = sim();
    for (const n of neighbours) tree(s, n.hx, n.hy);
    expect(fitsAt(s, CART_SIZE)).toBe(true);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(false);
  });

  it('counts an odd-row anchor disc with the row lean', () => {
    const s = sim();
    const odd = hexNeighboursOf(AT_ODD.hx, AT_ODD.hy);
    // The north-east neighbour of an odd-row node sits a column east of the even-row frame's.
    const northEast = { hx: AT_ODD.hx + 1, hy: AT_ODD.hy - 1 };
    expect(odd).toContainEqual(northEast);
    tree(s, northEast.hx, northEast.hy);
    tree(s, neighbour(1, odd).hx, neighbour(1, odd).hy);
    expect(fitsAt(s, CATAPULT_SIZE, AT_ODD)).toBe(true);
    // A tree one column further east lies outside the disc and changes nothing.
    tree(s, northEast.hx + 1, northEast.hy);
    expect(fitsAt(s, CATAPULT_SIZE, AT_ODD)).toBe(true);
    const sw = odd.find((n) => n.hy === AT_ODD.hy + 1 && n.hx === AT_ODD.hx);
    if (sw === undefined) throw new Error('no south-west neighbour');
    tree(s, sw.hx, sw.hy);
    expect(fitsAt(s, CATAPULT_SIZE, AT_ODD)).toBe(false);
  });

  it('refuses a disc reaching off the map', () => {
    const s = sim();
    expect(fitsAt(s, CATAPULT_SIZE, { hx: AT.hx, hy: 0 })).toBe(false);
    expect(fitsAt(s, CATAPULT_SIZE, { hx: 0, hy: AT.hy })).toBe(false);
    expect(fitsAt(s, CATAPULT_SIZE, { hx: AT.hx, hy: 1 })).toBe(true);
  });

  it('lets a catapult pass a gap it may not stand in', () => {
    const s = sim();
    tree(s, neighbour(0).hx, neighbour(0).hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(true);
    expect(standsAt(s, CATAPULT_SIZE, AT)).toBe(false);
    expect(standsAt(s, CATAPULT_SIZE, { hx: AT.hx, hy: AT.hy + 4 })).toBe(true);
  });
});

describe('a catapult at rest', () => {
  const MAP_CELLS = 16;
  const CATAPULT = 5;
  const SCOUT = 27;
  const P0 = 0;
  /** The tree line's column and the one-node gap in it. */
  const LINE_HX = 10;
  const GAP = { hx: LINE_HX, hy: 8 } as const;
  const DRIVE_TICKS = 400;

  function commandedCatapult(s: Simulation, x: number, y: number): Entity {
    const vehicle = createVehicle(s.world, ctxOf(s), {
      vehicleType: CATAPULT,
      x,
      y,
      tribe: VIKING,
      owner: P0,
    });
    if (vehicle === null) throw new Error('catapult not in the fixture');
    s.enqueueSetup({ kind: 'spawnSettler', jobType: SCOUT, x, y, tribe: VIKING, owner: P0 });
    s.step();
    const rider = [...s.world.query(Settler)].at(-1);
    if (rider === undefined || !seatPassenger(s.world, vehicle, rider)) throw new Error('no commander');
    boardRider(s.world, rider, vehicle);
    return vehicle;
  }

  function treeLine(s: Simulation): void {
    for (let hy = 0; hy < 2 * MAP_CELLS; hy++) if (hy !== GAP.hy) tree(s, LINE_HX, hy);
  }

  function anchorOf(s: Simulation, e: Entity): HalfCellNode {
    const p = s.world.get(e, Position);
    return nodeOfPosition(p.x, p.y);
  }

  it('snaps a goal in a gap to a node it may stand on', () => {
    const s = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const terrain = s.terrain;
    if (terrain === undefined) throw new Error('map missing');
    treeLine(s);
    const catapult = commandedCatapult(s, 4, GAP.hy);
    expect(fitsAt(s, CATAPULT_SIZE, GAP)).toBe(true);
    const goal = snapVehicleTarget(s.world, ctxOf(s), terrain, catapult, GAP);
    if (goal === null) throw new Error('no goal');
    expect(goal).not.toBe(terrain.nodeAt(GAP.hx, GAP.hy));
    expect(vehicleStandable(s.world, ctxOf(s), terrain, CATAPULT_SIZE)(goal)).toBe(true);
  });

  it('drives on out of a gap its goal closed into during the drive', () => {
    const s = new Simulation({ seed: 1, content: testContent(), map: grassCellMap(MAP_CELLS, MAP_CELLS) });
    const catapult = commandedCatapult(s, 4, GAP.hy);
    s.enqueue(playerCommand(P0, { kind: 'moveVehicle', vehicle: catapult, x: GAP.hx, y: GAP.hy }));
    s.step();
    treeLine(s); // the goal was open when snapped
    for (let t = 0; s.world.has(catapult, VehicleDrive); t++) {
      if (t > DRIVE_TICKS) throw new Error('drive never ended');
      s.step();
    }
    const rest = anchorOf(s, catapult);
    expect(rest).not.toEqual(GAP);
    expect(standsAt(s, CATAPULT_SIZE, rest)).toBe(true);
  });
});
