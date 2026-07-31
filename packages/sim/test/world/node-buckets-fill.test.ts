import { describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { positionOfNode } from '../../src/index.js';
import { NodeBuckets } from '../../src/systems/spatial/nodes.js';

/**
 * The `alsoVisit` sink of the {@link NodeBuckets} build: a second structure indexing the same list through
 * the same resolver is fed by this walk instead of paying its own. What it must guarantee is coverage, not
 * merely a call count, because the combat tick's coarse presence grid gates a ring search over these very
 * buckets: every (entity, node) pair a bucket holds has to reach the sink, including the several nodes a
 * multi-node resolver gives a building.
 */

/** Half-cell nodes; the multi-node case stands in for a building's wall cells. */
const WALLS = [
  { x: 4, y: 4 },
  { x: 5, y: 4 },
  { x: 4, y: 5 },
];
const UNIT_NODE = { x: 9, y: 9 };

function visited(buckets: NodeBuckets): string[] {
  return [...buckets.buckets()].flatMap(({ x, y, entities }) => entities.map((e) => `${e}@${x},${y}`)).sort();
}

describe('NodeBuckets: alsoVisit shares the build walk', () => {
  it('hands the sink every (entity, node) pair the buckets hold, multi-node targets included', () => {
    // No Position on either: a multi-node resolver wins the ladder outright, so the walk never reads one.
    const world = new World();
    const unit = world.create();
    const building = world.create();

    const seen: string[] = [];
    const nodesOf = (e: Entity): { x: number; y: number }[] => (e === building ? WALLS : [UNIT_NODE]);
    const buckets = new NodeBuckets(world, [unit, building], undefined, nodesOf, (e, x, y) => {
      seen.push(`${e}@${x},${y}`);
    });

    expect(seen.slice().sort()).toEqual(visited(buckets));
    expect(seen).toHaveLength(1 + WALLS.length);
  });

  it('still appends rather than sorts, so a sink cannot mask an uncanonical feed', () => {
    const world = new World();
    const lower = world.create();
    const higher = world.create();
    for (const e of [lower, higher]) world.add(e, Position, positionOfNode(2, 2));

    // Fed descending, the bucket comes out descending: the ascending-id order `nearest` relies on is the
    // caller's canonicalById list, never something the build imposes.
    const buckets = new NodeBuckets(world, [higher, lower], undefined, undefined, () => {});

    expect(buckets.at(2, 2)).toEqual([higher, lower]);
  });
});
