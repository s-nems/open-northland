import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { type Entity, World } from '../../src/ecs/world.js';
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

  it('answers after a refill as a fresh build over the same entities', () => {
    const world = new World();
    const entities: Entity[] = [];
    for (let i = 0; i < ENTITY_COUNT; i++) entities.push(world.create());
    const reused = new NodeBuckets(world, []);
    // Clustered rounds grow and shrink buckets, a spread round leaves most old buckets stale, and an
    // empty round clears everything.
    const rounds: ReadonlyArray<{
      entities: readonly Entity[];
      place: (i: number) => { x: number; y: number };
    }> = [
      { entities, place: (i) => ({ x: i % 3, y: 2 * (i % 2) }) },
      { entities, place: (i) => ({ x: (i * 7) % SPREAD, y: 2 * ((i * 3) % SPREAD) }) },
      { entities: entities.slice(0, 3), place: (i) => ({ x: 1, y: 2 * (i % 2) }) },
      { entities: [], place: () => ({ x: 0, y: 0 }) },
      { entities, place: (i) => ({ x: i % 2, y: 0 }) },
    ];
    for (const round of rounds) {
      round.entities.forEach((e, i) => {
        const node = round.place(i);
        world.add(e, Position, positionOfNode(node.x, node.y));
      });
      reused.refill(world, round.entities);
      const fresh = new NodeBuckets(world, round.entities);

      expect(snapshot(reused)).toEqual(snapshot(fresh));
      for (let x = -1; x <= SPREAD; x++) {
        for (let y = -1; y <= 2 * SPREAD; y++) expect(reused.at(x, y)).toEqual(fresh.at(x, y));
      }
      expect(reused.nearest(0, 0, 0, 2 * SPREAD, () => true)).toEqual(
        fresh.nearest(0, 0, 0, 2 * SPREAD, () => true),
      );
    }
  });
});

const ENTITY_COUNT = 12;
/** Wide enough that the spread round lands most entities on nodes the clustered rounds never used. */
const SPREAD = 11;

function snapshot(buckets: NodeBuckets): Array<{ x: number; y: number; entities: readonly Entity[] }> {
  return [...buckets.buckets()].sort((a, b) => a.x - b.x || a.y - b.y);
}
