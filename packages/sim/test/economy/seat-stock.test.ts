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
import { GENERATION_JOURNAL_LIMIT } from '../../src/ecs/generation-journal.js';
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

  it('counts the unit in the hands of a rider who stands nowhere, as the summary bar does', () => {
    const sim = fixture();
    houseAt(sim, 10, 10, P0, [[WOOD, 2]]);
    const rider = sim.world.create();
    sim.world.add(rider, Owner, { player: P0 });
    sim.world.add(rider, Carrying, { goodType: WOOD, amount: 1 });
    expect(seatStockOf(sim.world, P0).units(WOOD)).toBe(3);
  });

  it('serves one pass to every reader until a store it reads changes', () => {
    const sim = fixture();
    const house = houseAt(sim, 10, 10, P0, [[WOOD, 2]]);
    const first = seatStockOf(sim.world, P0);
    expect(seatStockOf(sim.world, P0)).toBe(first);
    expect(seatStockOf(sim.world, P1)).not.toBe(first);
    sim.world.mut(house, Stockpile).amounts.set(WOOD, 5);
    const fresh = seatStockOf(sim.world, P0);
    expect(fresh).not.toBe(first);
    expect(fresh.units(WOOD)).toBe(5);
    expect(first.units(WOOD)).toBe(2);
  });

  it('keeps the ledger equal to a fresh fold as heaps, anchors, hands and upgrades change between reads', () => {
    const sim = fixture();
    const { world } = sim;
    const expectCoherent = (): void => {
      seatStockOf(world, P0);
      expect(world.verifyCaches()).toEqual([]);
    };
    const house = houseAt(sim, 10, 10, P0, [[WOOD, 2]]);
    const heap = heapAt(sim, 30, 10, [[STONE, 4]]);
    const farHeap = heapAt(sim, 120, 40, [[WOOD, 9]]);
    expectCoherent();
    expect(seatStockOf(world, P0).units(STONE)).toBe(4);

    // A post raised beside the far heap brings it in reach; razing it takes the heap out again.
    const post = signpostAt(sim, 118, 40, P0);
    expectCoherent();
    expect(seatStockOf(world, P0).units(WOOD)).toBe(11);
    world.destroy(post);
    expectCoherent();
    expect(seatStockOf(world, P0).units(WOOD)).toBe(2);

    // A signpost relocates by re-adding its marker around the Position write.
    const moved = signpostAt(sim, 60, 20, P1);
    world.remove(moved, Signpost);
    const at = world.mut(moved, Position);
    const target = positionOfNode(118, 40);
    at.x = target.x;
    at.y = target.y;
    world.add(moved, Signpost, { links: [] });
    expectCoherent();
    expect(seatStockOf(world, P1).units(WOOD)).toBe(9);

    // The heap drains and refills in place; a seat's house changes hands.
    world.mut(heap, Stockpile).amounts.set(STONE, 1);
    expectCoherent();
    world.mut(house, Owner).player = P1;
    expectCoherent();
    expect(seatStockOf(world, P0).units(STONE)).toBe(0);
    expect(seatStockOf(world, P1).units(STONE)).toBe(1);
    world.mut(house, Owner).player = P0;

    // Hands and an upgrade's set-aside stock.
    const carrier = world.create();
    world.add(carrier, Owner, { player: P0 });
    world.add(carrier, Carrying, { goodType: STONE, amount: 1 });
    expectCoherent();
    world.mut(carrier, Carrying).amount = 2;
    world.add(house, Upgrading, { savedStock: new Map([[WOOD, 3]]), seeded: new Map() });
    expectCoherent();
    world.mut(house, Upgrading).savedStock.set(WOOD, 5);
    world.remove(carrier, Carrying);
    expectCoherent();

    // A heap claimed by a seat stops counting as ground and counts as its own pile.
    world.add(farHeap, Owner, { player: P0 });
    expectCoherent();
    expect(seatStockOf(world, P0).units(WOOD)).toBe(2 + 5 + 9);
    world.destroy(heap);
    expectCoherent();
  });

  it('rebuilds from the stores when more changes landed than the journals keep', () => {
    const sim = fixture();
    const { world } = sim;
    houseAt(sim, 10, 10, P0, []);
    const heap = heapAt(sim, 12, 12, [[WOOD, 0]]);
    expect(seatStockOf(world, P0).units(WOOD)).toBe(0);
    for (let amount = 1; amount <= GENERATION_JOURNAL_LIMIT + 1; amount++) {
      world.mut(heap, Stockpile).amounts.set(WOOD, amount);
    }
    expect(seatStockOf(world, P0).units(WOOD)).toBe(GENERATION_JOURNAL_LIMIT + 1);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('drops a heap whose only post was razed while more signpost changes landed than the journals keep', () => {
    const sim = fixture();
    const { world } = sim;
    heapAt(sim, 62, 22, [[WOOD, 4]]);
    const post = signpostAt(sim, 60, 20, P0);
    expect(seatStockOf(world, P0).units(WOOD)).toBe(4);
    world.destroy(post);
    // Only the anchors read Signpost, so the gap rebuilds them alone and the heap must be re-tested.
    const marker = world.create();
    for (let i = 0; i <= GENERATION_JOURNAL_LIMIT; i++) {
      world.add(marker, Signpost, { links: [] });
      world.remove(marker, Signpost);
    }
    expect(seatStockOf(world, P0).units(WOOD)).toBe(0);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('reports a heap written into reach in place, which no system does', () => {
    const sim = fixture();
    const { world } = sim;
    houseAt(sim, 10, 10, P0, []);
    const heap = heapAt(sim, 120, 40, [[WOOD, 9]]);
    expect(seatStockOf(world, P0).units(WOOD)).toBe(0);
    const at = world.mut(heap, Position);
    const near = positionOfNode(12, 10);
    at.x = near.x;
    at.y = near.y;
    expect(world.verifyCaches()).toEqual([
      `seatStock of player ${P0}, good ${WOOD}, disagrees with a fresh fold`,
    ]);
  });
});
