import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/index.js';
import { NodeBuckets } from '../../src/systems/spatial/nodes.js';

/**
 * How a {@link NodeBuckets} bucket comes to hold ascending ids - the order every ring search's first-match
 * tie-break rests on. The two fill paths reach it differently: the constructor appends, so the CALLER's
 * canonical list is the guarantee, while `insert` splices, so a caller filling out of order (the combat
 * index, realizing one coarse cell at a time) still gets an ascending bucket.
 */

const NODE = { x: 2, y: 2 };

describe('NodeBuckets fill order', () => {
  it('appends rather than sorts, so an uncanonical feed stays uncanonical', () => {
    const world = new World();
    const lower = world.create();
    const higher = world.create();
    for (const e of [lower, higher]) world.add(e, Position, positionOfNode(NODE.x, NODE.y));

    const buckets = new NodeBuckets(world, [higher, lower]);

    expect(buckets.at(NODE.x, NODE.y)).toEqual([higher, lower]);
  });

  it('drops an entity with no Position instead of bucketing it at the origin', () => {
    const world = new World();
    const placed = world.create();
    world.add(placed, Position, positionOfNode(NODE.x, NODE.y));
    const unplaced = world.create();

    const buckets = new NodeBuckets(world, [placed, unplaced]);

    expect([...buckets.buckets()]).toEqual([{ x: NODE.x, y: NODE.y, entities: [placed] }]);
  });

  it('splices an out-of-order insert into ascending-id place', () => {
    const world = new World();
    const lower = world.create();
    const higher = world.create();
    const buckets = new NodeBuckets(world, []);

    buckets.insert(higher, NODE.x, NODE.y);
    buckets.insert(lower, NODE.x, NODE.y);

    expect(buckets.at(NODE.x, NODE.y)).toEqual([lower, higher]);
  });
});
