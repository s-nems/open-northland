import { Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { NodeBuckets } from './spatial.js';
import { createSpatialMemo } from './spatial-memo.js';

/**
 * The per-world STOCKPILE node index — every positioned {@link Stockpile} bucketed by its half-cell node, so
 * "which heap is on this tile?" costs O(1) instead of a scan over every alive entity. It is the golden-rule-6
 * lever for the per-drop tile lookups: the ground-pile drops (`effects-goods/piles.ts`) and the sow occupancy
 * test used to walk `canonicalEntities()`, ~17k on a decoded map, nearly all of them resource nodes carrying no
 * stock at all — the store this indexes holds only buildings, boat hulls and loose heaps.
 *
 * Derived read-state, never hashed: a {@link createSpatialMemo} rider, maintained incrementally against the
 * Stockpile store generation (create/destroy). Two invariants make that key sound, and the registered verifier
 * re-derives the buckets and fires if either stops holding — a future violation surfaces there instead of as a
 * silent wrong pick:
 *
 * - A positioned stockpile never moves and never loses its Position without dying. True of a building, a heap,
 *   and today's boat hull (`command/placement.ts` places a hull as a static store; its movement is a deferred
 *   slice); the movers (settlers, animals, projectiles) carry no Stockpile.
 * - An entity's Position is added BEFORE its Stockpile. The generation this keys on is Stockpile's, so a
 *   Stockpile added first would bump while the entity is still unindexable and the later Position add would
 *   bump nothing, stranding it out of the index. Every creation site adds Position first.
 */

const memo = createSpatialMemo<NodeBuckets, { hx: number; hy: number }>(
  Stockpile,
  { verifier: 'stockpileNodeIndex', plural: 'stockpiles', component: 'Stockpile' },
  {
    empty: (world) => new NodeBuckets(world, []),
    member: (_world, _e, hx, hy) => ({ hx, hy }),
    insert: (buckets, e, m) => buckets.insert(e, m.hx, m.hy),
    remove: (buckets, e, m) => buckets.remove(e, m.hx, m.hy),
    // Element-wise bucket compare, not membership: ascending-id bucket ORDER is what makes a caller's
    // first-match the canonical winner, so a reordered bucket is a wrong pick `includes` would wave through.
    diverges: (held, fresh) => {
      for (const b of fresh.buckets()) {
        const heldBucket = held.at(b.x, b.y);
        if (heldBucket.length !== b.entities.length || b.entities.some((e, i) => heldBucket[i] !== e)) {
          return [
            `stockpileNodeIndex bucket (${b.x},${b.y}) diverges from a fresh rebuild — a positioned stockpile moved in place`,
          ];
        }
      }
      return [];
    },
  },
);

/**
 * Every positioned {@link Stockpile} whose Position snaps to half-cell node `(hx, hy)`, ascending-id — empty
 * when the node holds none. A superset of the entities at any one exact Position on that node (a fractional
 * drop and a lattice-snapped heap share a node), so a caller re-checking its own exact-Position and marker
 * filters over this list picks the same entity a full canonical scan would.
 */
export function stockpilesAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return memo.read(world).at(hx, hy);
}
