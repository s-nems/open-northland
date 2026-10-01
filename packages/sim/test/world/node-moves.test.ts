import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { World } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/nav/halfcell.js';
import { type NodeMoveFeed, watchNodeMoves } from '../../src/systems/spatial/node-moves.js';

/** An east step far short of a half-cell node's width, so it never leaves the node's centre column. */
const SUB_NODE_STEP = fx.div(ONE, fx.fromInt(16));

const drained = (feed: NodeMoveFeed): Entity[] => {
  const out: Entity[] = [];
  feed.drain((e) => out.push(e));
  return out;
};

function placeAt(world: World, e: Entity, hx: number, hy: number): void {
  const at = positionOfNode(hx, hy);
  const p = world.mut(e, Position);
  p.x = at.x;
  p.y = at.y;
}

describe('watchNodeMoves', () => {
  it('names an entity when its node changes, not for a step inside the node', () => {
    const world = new World();
    const walker = world.create();
    world.add(walker, Position, positionOfNode(4, 2));
    const feed = watchNodeMoves(world);

    world.mut(walker, Position).x = fx.add(world.get(walker, Position).x, SUB_NODE_STEP);
    expect(drained(feed)).toEqual([]);

    placeAt(world, walker, 5, 2);
    expect(drained(feed)).toEqual([walker]);
    expect(world.verifyCaches()).toEqual([]);
  });

  it('gives every subscriber the changes since its own last drain', () => {
    const world = new World();
    const walker = world.create();
    world.add(walker, Position, positionOfNode(4, 2));
    const early = watchNodeMoves(world);
    const late = watchNodeMoves(world);

    placeAt(world, walker, 5, 2);
    expect(drained(early)).toEqual([walker]);
    placeAt(world, walker, 6, 2);
    expect(drained(late)).toEqual([walker]);
    expect(drained(early)).toEqual([walker]);
  });

  it('follows a Position re-added elsewhere, so a step back onto the old node is still named', () => {
    const world = new World();
    const walker = world.create();
    world.add(walker, Position, positionOfNode(4, 2));
    const feed = watchNodeMoves(world);

    world.remove(walker, Position);
    world.add(walker, Position, positionOfNode(10, 2));
    drained(feed);
    placeAt(world, walker, 4, 2);
    expect(drained(feed)).toEqual([walker]);
  });

  it('reports a node the shared pass missed', () => {
    const world = new World();
    const walker = world.create();
    world.add(walker, Position, positionOfNode(4, 2));
    watchNodeMoves(world);
    expect(world.verifyCaches()).toEqual([]);

    // A write past `mut`, which no feed hears.
    const unlogged = world.get(walker, Position) as { x: Fixed; y: Fixed };
    unlogged.y = positionOfNode(4, 6).y;
    expect(world.verifyCaches()).toContain(`nodeMoves holds a stale node for entity ${walker}`);
  });
});
