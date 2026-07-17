import { describe, expect, it } from 'vitest';
import * as components from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { dropOrStackGood } from '../../src/systems/agents/effects-goods/index.js';
import { stockpilesAtNode } from '../../src/systems/stockpile-index.js';
import { testContent } from '../fixtures/content.js';

/**
 * The stockpile NODE index (`systems/stockpile-index.ts`) — the golden-rule-6 fix that turns the per-drop tile
 * lookup in `effects-goods/piles.ts` from a scan over every alive entity (~17k on a decoded map) into an O(1)
 * bucket read. Pinned here: buckets hold every stockpile on the node ascending-id (the canonical first-wins
 * order `dropOrStackGood`/`stackOntoTile` pick through, including the candidates they reject and skip), the
 * index refreshes on the Stockpile store generation, and its verifier fires if a positioned stockpile ever
 * moves in place — the invariant the whole memo rests on. Winner parity itself rides the goods/gatherer suites
 * and the golden slice, which all run through the indexed path.
 */

const { Position, Stockpile } = components;
const WOOD = 1;
const STONE = 2;

function newSim(): Simulation {
  return new Simulation({ seed: 1, content: testContent() });
}

/** A bare loose heap of `good` at half-cell node (hx, hy) — the shape `dropOrStackGood` stacks onto. */
function heapAt(sim: Simulation, hx: number, hy: number, good: number, amount: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map([[good, amount]]) });
  return e;
}

describe('stockpilesAtNode (the per-drop tile lookup index)', () => {
  it('buckets every stockpile on the node ascending-id, and nothing from a neighbouring node', () => {
    const sim = newSim();
    const b = heapAt(sim, 10, 10, WOOD, 1);
    const a = heapAt(sim, 10, 10, STONE, 1); // same node, higher id — must follow `b`
    const neighbour = heapAt(sim, 11, 10, WOOD, 1);
    expect(stockpilesAtNode(sim.world, 10, 10)).toEqual([b, a]);
    expect(stockpilesAtNode(sim.world, 10, 10)).not.toContain(neighbour);
    expect(stockpilesAtNode(sim.world, 99, 99)).toEqual([]);
  });

  it('refreshes when a stockpile is created or destroyed (Stockpile store generation)', () => {
    const sim = newSim();
    const a = heapAt(sim, 4, 4, WOOD, 1);
    expect(stockpilesAtNode(sim.world, 4, 4)).toEqual([a]);
    const b = heapAt(sim, 4, 4, WOOD, 1);
    expect(stockpilesAtNode(sim.world, 4, 4)).toEqual([a, b]); // generation moved → rebuilt
    sim.world.destroy(a);
    expect(stockpilesAtNode(sim.world, 4, 4)).toEqual([b]);
    expect(sim.world.verifyCaches()).toEqual([]);
  });

  it('verifier reports a positioned stockpile that moved in place (the moving-hull tripwire)', () => {
    const sim = newSim();
    const heap = heapAt(sim, 6, 6, WOOD, 1);
    expect(stockpilesAtNode(sim.world, 6, 6)).toEqual([heap]); // build the index at the old node
    const moved = positionOfNode(20, 20);
    const p = sim.world.get(heap, Position); // an in-place write bumps no generation — exactly the silent case
    p.x = moved.x;
    p.y = moved.y;
    expect(sim.world.verifyCaches()).toEqual([
      'stockpileNodeIndex bucket (20,20) diverges from a fresh rebuild — a positioned stockpile moved in place',
    ]);
  });

  it('dropOrStackGood still stacks onto the lowest-id matching heap, skipping a different good on the tile', () => {
    const sim = newSim();
    const stone = heapAt(sim, 8, 8, STONE, 1); // lowest id, but holds another good — rejected and skipped
    const wood = heapAt(sim, 8, 8, WOOD, 1); // the canonical winner
    const later = heapAt(sim, 8, 8, WOOD, 1); // a second match — must lose to `wood`
    const at = positionOfNode(8, 8);

    expect(dropOrStackGood(sim.world, at.x, at.y, WOOD, 2)).toBe(wood);
    expect(sim.world.get(wood, Stockpile).amounts.get(WOOD)).toBe(3);
    expect(sim.world.get(stone, Stockpile).amounts.get(STONE)).toBe(1); // never overwritten
    expect(sim.world.get(later, Stockpile).amounts.get(WOOD)).toBe(1); // untouched
  });

  it('dropOrStackGood starts a fresh heap on an empty node without scanning a neighbour heap in', () => {
    const sim = newSim();
    const neighbour = heapAt(sim, 12, 12, WOOD, 1);
    const at = positionOfNode(13, 12);
    const made = dropOrStackGood(sim.world, at.x, at.y, WOOD, 2);
    expect(made).not.toBe(neighbour);
    expect(stockpilesAtNode(sim.world, 13, 12)).toEqual([made]);
    expect(sim.world.get(neighbour, Stockpile).amounts.get(WOOD)).toBe(1);
  });
});
