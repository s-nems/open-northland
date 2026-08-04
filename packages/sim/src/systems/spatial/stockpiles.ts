import { Stockpile } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { createSpatialMemo } from './memo.js';
import { NodeBuckets } from './nodes.js';

/**
 * Every positioned {@link Stockpile} bucketed by its half-cell node, so "which heap is on this tile?"
 * costs O(1) instead of a scan over every alive entity. Derived read-state, never hashed, maintained
 * incrementally against the Stockpile store generation. Two invariants make that key sound, and the
 * registered verifier fires if either stops holding:
 *
 * - A positioned stockpile never moves and never loses its Position without dying. Buildings, heaps and
 *   boat hulls satisfy this; the movers carry no Stockpile.
 * - An entity's Position is added before its Stockpile. Adding Stockpile first would bump the generation
 *   while the entity is still unindexable, and the later Position add bumps nothing, stranding it out of
 *   the index.
 */

const memo = createSpatialMemo<NodeBuckets, { hx: number; hy: number }>(
  Stockpile,
  { verifier: 'stockpileNodeIndex', plural: 'stockpiles', component: 'Stockpile' },
  {
    empty: (world) => new NodeBuckets(world, []),
    member: (_world, _e, hx, hy) => ({ hx, hy }),
    insert: (buckets, e, m) => buckets.insert(e, m.hx, m.hy),
    remove: (buckets, e, m) => buckets.remove(e, m.hx, m.hy),
    // Element-wise, not membership: ascending-id bucket order is what makes a caller's first match the
    // canonical winner, so a reordered bucket is a wrong pick a membership test would wave through.
    diverges: (held, fresh) => {
      for (const b of fresh.buckets()) {
        const heldBucket = held.at(b.x, b.y);
        if (heldBucket.length !== b.entities.length || b.entities.some((e, i) => heldBucket[i] !== e)) {
          return [
            `stockpileNodeIndex bucket (${b.x},${b.y}) diverges from a fresh rebuild - a positioned stockpile moved in place`,
          ];
        }
      }
      return [];
    },
  },
);

/**
 * Every positioned {@link Stockpile} whose Position snaps to half-cell node `(hx, hy)`, ascending-id. A
 * superset of the entities at any one exact Position on that node, since a fractional drop and a
 * lattice-snapped heap share a node, so a caller must re-check its own exact-Position filter.
 */
export function stockpilesAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return memo.read(world).at(hx, hy);
}
