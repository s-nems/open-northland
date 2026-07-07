import { beforeEach, describe, expect, it } from 'vitest';
import { Position } from '../../src/components/index.js';
import { fx } from '../../src/core/fixed.js';
import { type Entity, World } from '../../src/ecs/world.js';
import { TileBuckets } from '../../src/systems/shared.js';

/**
 * Unit tests for the {@link TileBuckets.nearest} grid RING SEARCH — the spatial primitive behind the
 * combat enemy query (packages/sim/AGENTS.md "Full ring-search nearest-X", plan tier 3). The
 * contract these pin: the winner is the canonical (min-distance, then min-id) one a full scan would
 * pick, found by completing the whole minimum-distance ring; the `[minDist, maxDist]` band is honored
 * on both ends; and the search short-circuits past its radius (an empty query never scans forever).
 */

/** Build a World with a Position-only entity at each coordinate, returning the entities in creation
 *  (ascending-id) order so a test can name them by index. */
function place(coords: ReadonlyArray<{ x: number; y: number }>): { world: World; ids: Entity[] } {
  const world = new World();
  const ids: Entity[] = [];
  for (const c of coords) {
    const e = world.create();
    world.add(e, Position, { x: fx.fromInt(c.x), y: fx.fromInt(c.y) });
    ids.push(e);
  }
  return { world, ids };
}

const ALL = (): boolean => true;

beforeEach(() => {
  Position.store.clear();
});

describe('TileBuckets.nearest — grid ring search', () => {
  it('finds the nearest entity by integer Manhattan distance', () => {
    const { world, ids } = place([
      { x: 5, y: 0 }, // dist 5
      { x: 2, y: 0 }, // dist 2 — nearest
      { x: 3, y: 0 }, // dist 3
    ]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 10, ALL)).toEqual({ entity: ids[1], distance: 2 });
  });

  it('returns the integer Manhattan distance (diagonal offset)', () => {
    const { world, ids } = place([{ x: 3, y: 4 }]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 20, ALL)).toEqual({ entity: ids[0], distance: 7 });
  });

  it('completes the whole minimum-distance ring and breaks a tie by ascending entity id', () => {
    // Two entities equidistant (Manhattan 2) from the origin. The LOWER-id one is at +x (scanned LATE
    // in the dx sweep), the HIGHER-id one at -x (scanned FIRST) — so a naive first-hit would return the
    // wrong one. The min-id-over-the-whole-ring rule must pick the lower id regardless of scan order.
    const { world, ids } = place([
      { x: 2, y: 0 }, // id 0 (lower) — encountered LAST in the dx sweep (dx = +2)
      { x: -2, y: 0 }, // id 1 (higher) — encountered FIRST (dx = -2)
    ]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 10, ALL)).toEqual({ entity: ids[0], distance: 2 });
  });

  it('picks the smallest id when several enemies share the nearest tile', () => {
    const { world, ids } = place([
      { x: 2, y: 0 },
      { x: 2, y: 0 }, // same tile as ids[0] — the bucket keeps ascending id
      { x: 2, y: 0 },
    ]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 10, ALL)).toEqual({ entity: ids[0], distance: 2 });
  });

  it('honors the near floor: an entity closer than minDist is skipped', () => {
    const { world, ids } = place([
      { x: 1, y: 0 }, // dist 1 — inside the near floor
      { x: 4, y: 0 }, // dist 4 — the nearest at or beyond minDist
    ]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 3, 10, ALL)).toEqual({ entity: ids[1], distance: 4 });
  });

  it('short-circuits past maxDist: nothing beyond the radius is returned', () => {
    const { world, ids } = place([{ x: 5, y: 0 }]); // dist 5, beyond maxDist 4
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 4, ALL)).toBeNull();
  });

  it('applies the accept predicate: the nearest ACCEPTED entity, not the nearest overall', () => {
    const { world, ids } = place([
      { x: 1, y: 0 }, // nearer, but rejected
      { x: 3, y: 0 }, // the nearest accepted
    ]);
    const buckets = new TileBuckets(world, ids);
    const accept = (e: Entity): boolean => e === ids[1];
    expect(buckets.nearest(0, 0, 0, 10, accept)).toEqual({ entity: ids[1], distance: 3 });
  });

  it('finds a same-tile (distance 0) entity when the near floor allows it', () => {
    const { world, ids } = place([{ x: 4, y: 4 }]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(4, 4, 0, 5, ALL)).toEqual({ entity: ids[0], distance: 0 });
  });

  it('returns null on an empty band (no entities in range at all)', () => {
    const { world, ids } = place([{ x: 8, y: 8 }]);
    const buckets = new TileBuckets(world, ids);
    expect(buckets.nearest(0, 0, 0, 3, ALL)).toBeNull();
  });
});
