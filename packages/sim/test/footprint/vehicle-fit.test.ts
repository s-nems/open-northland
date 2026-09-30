import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Position } from '../../src/components/index.js';
import { hexNeighboursOf, ONE, positionOfNode, Simulation, type TerrainMap } from '../../src/index.js';
import { stampResourceFootprintData } from '../../src/systems/footprint/index.js';
import {
  BUILDING_TOLERANCE_NEIGHBOURS,
  landVehicleFits,
  TREE_TOLERANCE_NEIGHBOURS,
} from '../../src/systems/footprint/vehicle-clearance.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

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

function neighbour(index: number): { hx: number; hy: number } {
  const n = neighbours[index];
  if (n === undefined) throw new Error(`no neighbour ${index}`);
  return n;
}

describe('landVehicleFits', () => {
  it('admits a catapult between two trees and refuses it among three', () => {
    const s = sim();
    for (let i = 0; i < TREE_TOLERANCE_NEIGHBOURS; i++) tree(s, neighbour(i).hx, neighbour(i).hy);
    expect(fitsAt(s, CATAPULT_SIZE)).toBe(true);
    const third = neighbour(TREE_TOLERANCE_NEIGHBOURS);
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
});
