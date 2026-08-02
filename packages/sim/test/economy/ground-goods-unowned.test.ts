import { describe, expect, it } from 'vitest';
import { Carrying, Owner, ownerOf, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { dropCarryAtOwnTile } from '../../src/systems/settlers/atomics/effects/goods/index.js';
import { collectTargets, nearestFreeYardNode } from '../../src/systems/settlers/targets/index.js';
import { stockpilesAtNode } from '../../src/systems/spatial/stockpiles.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap as grassMap } from '../fixtures/terrain.js';

/**
 * Goods resting on the ground belong to nobody: a heap is never owner-stamped, so any settler may add to
 * one or take from it whoever left it there. Pinned at the drop seam (`stackOntoTile`, through
 * `dropCarryAtOwnTile`) and at the yard steering that has to agree with it.
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

/** A settler of `player` standing at half-cell node (hx, hy) carrying one unit of `good`. */
function carrierAt(sim: Simulation, hx: number, hy: number, good: number, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Carrying, { goodType: good, amount: 1 });
  sim.world.add(e, Owner, { player });
  return e;
}

describe('goods lying on the ground have no owner', () => {
  it('a set-down leaves an unowned heap either side may add to', () => {
    const { sim } = fixture();
    const first = carrierAt(sim, HEAP_HX, HEAP_HY, WOOD, P0);
    expect(dropCarryAtOwnTile(sim.world, first)).toBe(1);
    const [pile] = stockpilesAtNode(sim.world, HEAP_HX, HEAP_HY);
    if (pile === undefined) throw new Error('the drop left no pile on the tile');
    expect(ownerOf(sim.world, pile)).toBeUndefined();

    const other = carrierAt(sim, HEAP_HX, HEAP_HY, WOOD, P1);
    expect(dropCarryAtOwnTile(sim.world, other)).toBe(1); // another player's heap is just a heap
    expect(sim.world.has(other, Carrying)).toBe(false);
    expect(sim.world.get(pile, Stockpile).amounts.get(WOOD)).toBe(2);
    expect(ownerOf(sim.world, pile)).toBeUndefined(); // and it stays unowned
  });

  it('the yard steering offers a heap with room to any gatherer', () => {
    const { sim, terrain } = fixture();
    const flag = sim.world.create();
    sim.world.add(flag, Position, positionOfNode(HEAP_HX, HEAP_HY));
    // A heap with room ON the flag's own node, left there by another player's settler.
    const dropper = carrierAt(sim, HEAP_HX, HEAP_HY, WOOD, P1);
    dropCarryAtOwnTile(sim.world, dropper);
    const yard = collectTargets(sim.world, ctxOf(sim), terrain).yard;
    const here = terrain.nodeAt(HEAP_HX - 2, HEAP_HY);

    // Not steered past it: the drop would merge, so the steering must offer the same tile.
    expect(nearestFreeYardNode(yard, sim.world, terrain, flag, WOOD, here)).toBe(
      terrain.nodeAt(HEAP_HX, HEAP_HY),
    );
  });
});
