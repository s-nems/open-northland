import { describe, expect, it } from 'vitest';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Position,
  Stockpile,
  setStockAmount,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, ONE, Simulation } from '../../src/index.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../src/nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { yardOccupancy } from '../../src/systems/settlers/targets/yard-occupancy.js';
import { testContent } from '../fixtures/content.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/** Fixture goods: 1 = wood, 2 = stone. */
const WOOD = 1;
const STONE = 2;
const HEADQUARTERS = 1;
const VIKING = 1;

function fixture(): { sim: Simulation; terrain: TerrainGraph } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 4) });
  if (sim.terrain === undefined) throw new Error('fixture map missing');
  return { sim, terrain: sim.terrain };
}

function heapAt(sim: Simulation, x: number, amounts: ReadonlyMap<number, number>): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(1) });
  sim.world.add(e, Stockpile, { amounts: new Map(amounts) });
  return e;
}

function nodeOf(terrain: TerrainGraph, x: number): NodeId {
  const px = fx.fromInt(x);
  const py = fx.fromInt(1);
  return terrain.nodeAtClamped(nodeHxOfPosition(px, py), nodeHyOfPosition(py));
}

describe('yardOccupancy - the yard heaps by node, kept across ticks', () => {
  it('reads the lowest stocked good of each yard heap, the higher id where heaps share a node', () => {
    const { sim, terrain } = fixture();
    heapAt(
      sim,
      2,
      new Map([
        [STONE, 3],
        [WOOD, 2],
      ]),
    );
    heapAt(sim, 4, new Map([[WOOD, 1]]));
    heapAt(sim, 4, new Map([[STONE, 5]]));
    heapAt(sim, 6, new Map([[WOOD, 0]])); // drained, nothing to report
    const trunk = heapAt(sim, 8, new Map([[WOOD, 4]]));
    sim.world.add(trunk, GroundDrop, { goodType: WOOD });
    const flag = heapAt(sim, 10, new Map([[WOOD, 4]]));
    sim.world.add(flag, DeliveryFlag, {});
    const store = heapAt(sim, 12, new Map([[WOOD, 4]]));
    sim.world.add(store, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });

    const occupied = yardOccupancy(sim.world, terrain);

    expect(new Map(occupied)).toEqual(
      new Map([
        [nodeOf(terrain, 2), { good: WOOD, fill: 2 }],
        [nodeOf(terrain, 4), { good: STONE, fill: 5 }],
      ]),
    );
  });

  it('holds still between calls and follows stock writes, new heaps and removals on the next one', () => {
    const { sim, terrain } = fixture();
    const first = heapAt(sim, 2, new Map([[WOOD, 1]]));
    const second = heapAt(sim, 4, new Map([[STONE, 2]]));
    const occupied = yardOccupancy(sim.world, terrain);

    setStockAmount(sim.world, first, WOOD, 3);
    sim.world.destroy(second);
    heapAt(sim, 6, new Map([[STONE, 1]]));

    expect(occupied.get(nodeOf(terrain, 2))).toEqual({ good: WOOD, fill: 1 });
    expect(occupied.has(nodeOf(terrain, 4))).toBe(true);
    const caughtUp = yardOccupancy(sim.world, terrain);
    expect(new Map(caughtUp)).toEqual(
      new Map([
        [nodeOf(terrain, 2), { good: WOOD, fill: 3 }],
        [nodeOf(terrain, 6), { good: STONE, fill: 1 }],
      ]),
    );
    expect(sim.world.verifyCaches()).toEqual([]);
  });
});
