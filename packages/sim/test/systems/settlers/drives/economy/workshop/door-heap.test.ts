import { describe, expect, it } from 'vitest';
import {
  Building,
  Carrying,
  Owner,
  Position,
  SettlerProgress,
  Stockpile,
} from '../../../../../../src/components/index.js';
import type { Entity } from '../../../../../../src/ecs/world.js';
import { type NodeId, positionOfNode, Simulation } from '../../../../../../src/index.js';
import {
  MASTERY_BONUS_TENTHS,
  OUTPUT_TENTHS_PER_UNIT,
} from '../../../../../../src/systems/economy/production/bonus-output.js';
import { dynamicBlockOverlay } from '../../../../../../src/systems/footprint/index.js';
import {
  DOOR_HEAP_RADIUS_NODES,
  doorHeapRoom,
} from '../../../../../../src/systems/settlers/drives/economy/workshop/door-heap.js';
import { interactionCell } from '../../../../../../src/systems/settlers/targets/index.js';
import { ringOffsetCount, ringOffsetDx, ringOffsetDy } from '../../../../../../src/systems/spatial/metric.js';
import { MAX_GROUND_STACK, seatStockOf, stockCapacity } from '../../../../../../src/systems/stores/index.js';
import { testContent } from '../../../../../fixtures/content.js';
import {
  buildingAt,
  CARPENTER,
  CARRIER,
  ctxOf,
  grassMap,
  HEADQUARTERS,
  PLANK,
  PLANK_GATE_RAW_XP,
  SAWMILL,
  settlerAt,
  WOOD,
  WOOD_TRACK,
  WOODCUTTER,
} from '../../../../economy/production/producer-supply/support.js';

const PLAYER = 0;
const MAP_CELLS = 12;
const MILL_CELL = 5;
const WOOD_STOCK = 4;
/** A good that is not the mill's, heaped around its door in the cramped case. */
const FOREIGN_GOOD = 4;
const FOREIGN_FILL = 1;
/** Ample for a worker to lift, walk and work every unit of the door's heap. */
const HEAP_TICKS = 6000;
const CARRY_IN_TICKS = 6000;
/** The whole bonus units one cycle can shelve: a remainder short of a unit plus a master's tenths. */
const MOST_BONUS_UNITS_PER_CYCLE = Math.floor(
  (OUTPUT_TENTHS_PER_UNIT - 1 + MASTERY_BONUS_TENTHS) / OUTPUT_TENTHS_PER_UNIT,
);
/** Two ground stacks, the most the heap once took. */
const PAST_TWO_STACKS = 2 * MAX_GROUND_STACK;

interface Mill {
  readonly sim: Simulation;
  readonly mill: Entity;
  readonly worker: Entity;
  readonly shelf: number;
}

/** A sawmill with a full plank shelf and wood on hand, its worker at the door. */
function fullMill(): Mill {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(MAP_CELLS, MAP_CELLS) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.step();
  const mill = buildingAt(sim, SAWMILL, MILL_CELL, MILL_CELL);
  sim.world.add(mill, Owner, { player: PLAYER });
  const shelf = stockCapacity(sim.world, ctxOf(sim), mill, PLANK);
  const stock = sim.world.mut(mill, Stockpile).amounts;
  stock.set(PLANK, shelf);
  stock.set(WOOD, WOOD_STOCK);
  sim.world.add(settlerAt(sim, 1, 1, WOODCUTTER), Owner, { player: PLAYER }); // unlocks the plank
  const worker = settlerAt(sim, MILL_CELL, MILL_CELL, CARPENTER, mill);
  sim.world.add(worker, Owner, { player: PLAYER });
  sim.world.mut(worker, SettlerProgress).experience.set(WOOD_TRACK, PLANK_GATE_RAW_XP);
  return { sim, mill, worker, shelf };
}

/** Run the mill, its wood kept up, as a supplier would. */
function runMill({ sim, mill }: Mill, ticks: number): void {
  for (let t = 0; t < ticks; t++) {
    if ((sim.world.get(mill, Stockpile).amounts.get(WOOD) ?? 0) === 0)
      sim.world.mut(mill, Stockpile).amounts.set(WOOD, WOOD_STOCK);
    sim.step();
  }
}

function heaped(sim: Simulation, good: number): number {
  let units = 0;
  for (const e of sim.world.query(Stockpile, Position))
    if (!sim.world.has(e, Building)) units += sim.world.get(e, Stockpile).amounts.get(good) ?? 0;
  return units;
}

function doorOf(sim: Simulation, mill: Entity): NodeId {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('mapped fixture');
  return interactionCell(sim.world, ctxOf(sim), terrain, mill);
}

describe('a workshop door heap', () => {
  it('takes a full shelf no store clears onto the ground by the door until none there has room, and only then reports the shelf', () => {
    const fixture = fullMill();
    const { sim, mill, worker, shelf } = fixture;
    expect(sim.workStatus(worker)).toBeUndefined();
    runMill(fixture, HEAP_TICKS);
    const heap = heaped(sim, PLANK);
    expect(heap).toBeGreaterThan(PAST_TWO_STACKS);
    // A cycle starts only with room for its recipe output; its bonus lands whole past the shelf, and
    // with no ground left nothing lifts it to the door.
    const held = sim.world.get(mill, Stockpile).amounts.get(PLANK) ?? 0;
    expect(held - shelf).toBeGreaterThanOrEqual(0);
    expect(held - shelf).toBeLessThanOrEqual(MOST_BONUS_UNITS_PER_CYCLE);
    expect(sim.world.has(worker, Carrying)).toBe(false);
    expect(sim.workStatus(worker)).toMatchObject({ kind: 'outputFull' });
    expect(seatStockOf(sim.world, PLAYER).units(PLANK)).toBe(held + heap);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    expect(doorHeapRoom(sim.world, ctxOf(sim), terrain, doorOf(sim, mill), PLANK)).toBe(0);
    expect(dynamicBlockOverlay(sim.world, ctxOf(sim), terrain).has(doorOf(sim, mill))).toBe(false);
  });

  it('goes to a store a porter works once one takes the good', () => {
    const fixture = fullMill();
    const { sim } = fixture;
    runMill(fixture, HEAP_TICKS);
    const heap = heaped(sim, PLANK);
    const hq = buildingAt(sim, HEADQUARTERS, MILL_CELL + 2, MILL_CELL);
    sim.world.add(hq, Owner, { player: PLAYER });
    sim.world.add(settlerAt(sim, MILL_CELL + 2, MILL_CELL, CARRIER, hq), Owner, { player: PLAYER });
    // The mill's wood is no longer kept up, so the heap drains.
    sim.run(CARRY_IN_TICKS);
    expect(heaped(sim, PLANK)).toBeLessThan(heap);
    expect(sim.world.get(hq, Stockpile).amounts.get(PLANK) ?? 0).toBeGreaterThan(PAST_TWO_STACKS);
  });

  it('stops a worker on cramped ground with no tile free near the door', () => {
    const fixture = fullMill();
    const { sim, mill, worker, shelf } = fixture;
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('mapped fixture');
    const { x, y } = terrain.coordsOf(doorOf(sim, mill));
    for (let ring = 0; ring <= DOOR_HEAP_RADIUS_NODES; ring++) {
      for (let i = 0; i < ringOffsetCount(ring); i++) {
        const pile = sim.world.create();
        sim.world.add(pile, Position, positionOfNode(x + ringOffsetDx(ring, i), y + ringOffsetDy(ring, i)));
        sim.world.add(pile, Stockpile, { amounts: new Map([[FOREIGN_GOOD, FOREIGN_FILL]]) });
      }
    }
    runMill(fixture, HEAP_TICKS);
    expect(heaped(sim, PLANK)).toBe(0);
    expect(sim.world.get(mill, Stockpile).amounts.get(PLANK)).toBe(shelf);
    expect(sim.workStatus(worker)).toMatchObject({ kind: 'outputFull' });
  });
});
