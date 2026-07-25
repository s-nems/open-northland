import { describe, expect, it } from 'vitest';
import { Carrying, Owner, ownerOf, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { dropCarryAtOwnTile } from '../../src/systems/agents/effects-goods/index.js';
import { collectTargets, nearestFreeYardNode } from '../../src/systems/agents/targets/index.js';
import { stockpilesAtNode } from '../../src/systems/stockpile-index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * The same-side rule on the yard DROP seam: a settler's set-down never merges into a rival's heap
 * (`stackOntoTile` refuses, the load stays on its back), and the yard steering
 * (`nearestFreeYardNode`) treats that rival heap as occupied - the two ends agree, so a gatherer is
 * never walked to a tile whose drop would return 0 (the livelock the pairing prevents).
 */

const WOOD = 1;
const P0 = 0;
const P1 = 1;
const HEAP_HX = 10;
const HEAP_HY = 10;

function fixture(): { sim: Simulation; terrain: NonNullable<Simulation['terrain']> } {
  const sim = new Simulation({ seed: 1, content: testContent(), map: grassMap(16, 8) });
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture map missing');
  return { sim, terrain };
}

/** A bare loose heap (the yard-heap shape) of `good` at half-cell node (hx, hy), owned by `player`. */
function heapAt(
  sim: Simulation,
  hx: number,
  hy: number,
  good: number,
  amount: number,
  player: number,
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
  sim.world.add(e, Owner, { player });
  return e;
}

/** A settler of `player` standing at half-cell node (hx, hy) carrying one unit of `good`. */
function carrierAt(sim: Simulation, hx: number, hy: number, good: number, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Carrying, { goodType: good, amount: 1 });
  sim.world.add(e, Owner, { player });
  return e;
}

describe('the same-side rule on the yard drop', () => {
  it("a set-down never merges into a rival's heap; its own side's heap takes it", () => {
    const { sim } = fixture();
    const heap = heapAt(sim, HEAP_HX, HEAP_HY, WOOD, 2, P1);

    const rival = carrierAt(sim, HEAP_HX, HEAP_HY, WOOD, P0);
    expect(dropCarryAtOwnTile(sim.world, rival)).toBe(0); // a rival's heap counts as a full tile
    expect(sim.world.has(rival, Carrying)).toBe(true); // the load stays on its back, goods conserved
    expect(sim.world.get(heap, Stockpile).amounts.get(WOOD)).toBe(2); // the heap is untouched

    const ally = carrierAt(sim, HEAP_HX, HEAP_HY, WOOD, P1);
    expect(dropCarryAtOwnTile(sim.world, ally)).toBe(1); // its own side's heap merges as before
    expect(sim.world.get(heap, Stockpile).amounts.get(WOOD)).toBe(3);
  });

  it("a fresh heap carries the dropper's player", () => {
    const { sim } = fixture();
    const dropper = carrierAt(sim, HEAP_HX + 2, HEAP_HY, WOOD, P0);
    expect(dropCarryAtOwnTile(sim.world, dropper)).toBe(1);
    const [pile] = stockpilesAtNode(sim.world, HEAP_HX + 2, HEAP_HY);
    if (pile === undefined) throw new Error('the drop left no pile on the tile');
    expect(ownerOf(sim.world, pile)).toBe(P0);
  });

  it('the yard steering skips the rival-heap tile exactly where the drop would refuse it', () => {
    const { sim, terrain } = fixture();
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(HEAP_HX, HEAP_HY));
    heapAt(sim, HEAP_HX, HEAP_HY, WOOD, 2, P1); // a rival's heap with room, ON the flag's own node
    const yard = collectTargets(sim.world, ctxOf(sim), terrain).yard;
    const here = terrain.nodeAt(HEAP_HX - 2, HEAP_HY);
    const flagNode = terrain.nodeAt(HEAP_HX, HEAP_HY);

    // A same-side gatherer stacks straight onto the flag-node heap; a rival is steered past it.
    expect(nearestFreeYardNode(yard, sim.world, terrain, flag, WOOD, here, P1)).toBe(flagNode);
    const steered = nearestFreeYardNode(yard, sim.world, terrain, flag, WOOD, here, P0);
    expect(steered).not.toBeNull();
    expect(steered).not.toBe(flagNode);
  });
});
