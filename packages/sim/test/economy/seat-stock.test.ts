import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  Owner,
  Position,
  Signpost,
  Stockpile,
  Upgrading,
  WALK_RANGE_NODES,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { seatStockOf } from '../../src/systems/stores/index.js';
import { testContent } from '../fixtures/content.js';
import { grassNodeMap } from '../fixtures/terrain.js';

const WOOD = 1;
const STONE = 2;
const P0 = 0;
const P1 = 1;
const HOUSE_TYPE = 1;
/** Nodes across the fixture: the far heap lies beyond `WALK_RANGE_NODES` of every anchor. */
const MAP_WIDTH = 160;
const MAP_HEIGHT = 64;

function fixture(): Simulation {
  return new Simulation({ seed: 1, content: testContent(), map: grassNodeMap(MAP_WIDTH, MAP_HEIGHT) });
}

function heapAt(sim: Simulation, hx: number, hy: number, goods: [number, number][]): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

function signpostAt(sim: Simulation, hx: number, hy: number, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Signpost, { links: [] });
  return e;
}

function houseAt(sim: Simulation, hx: number, hy: number, player: number, goods: [number, number][]): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Owner, { player });
  sim.world.add(e, Building, { buildingType: HOUSE_TYPE, tribe: 0, built: fx.fromInt(1), level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map(goods) });
  return e;
}

describe('seatStockOf: the one seat-stock rule the summary bar and the AI share', () => {
  it("sums the seat's own piles and the heaps in reach of its signposts and buildings, never a far heap", () => {
    const sim = fixture();
    houseAt(sim, 10, 10, P0, [[WOOD, 10]]);
    signpostAt(sim, 60, 20, P0);
    heapAt(sim, 62, 22, [[WOOD, 4]]); // two nodes from the post
    heapAt(sim, 12, 12, [[STONE, 1]]); // beside the house
    heapAt(sim, 150, 50, [[WOOD, 99]]); // beyond fifty nodes of any anchor
    houseAt(sim, 14, 10, P1, [[WOOD, 7]]); // another seat's house counts for nobody else
    const stock = seatStockOf(sim.world, P0);
    expect(stock.units(WOOD)).toBe(14);
    expect(stock.units(STONE)).toBe(1);
    expect(stock.exceeds(WOOD, 13)).toBe(true);
    expect(stock.exceeds(WOOD, 14)).toBe(false);
  });

  it('leaves a heap out at exactly the walk range, and opens it from an own post or house alone', () => {
    const sim = fixture();
    heapAt(sim, 10 + WALK_RANGE_NODES, 10, [[WOOD, 5]]);
    expect(seatStockOf(sim.world, P0).units(WOOD)).toBe(0);
    signpostAt(sim, 10, 10, P1);
    expect(seatStockOf(sim.world, P0).units(WOOD)).toBe(0);
    signpostAt(sim, 11, 10, P0);
    expect(seatStockOf(sim.world, P0).units(WOOD)).toBe(5);
  });

  it("counts the unit in an own settler's hands and the stock an upgrading building keeps aside", () => {
    const sim = fixture();
    const house = houseAt(sim, 10, 10, P0, [[WOOD, 2]]);
    sim.world.add(house, Upgrading, { savedStock: new Map([[STONE, 3]]), seeded: new Map() });
    const carrier = sim.world.create();
    sim.world.add(carrier, Position, positionOfNode(12, 10));
    sim.world.add(carrier, Owner, { player: P0 });
    sim.world.add(carrier, Carrying, { goodType: WOOD, amount: 1 });
    const stock = seatStockOf(sim.world, P0);
    expect(stock.units(WOOD)).toBe(3);
    expect(stock.units(STONE)).toBe(3);
  });
});
