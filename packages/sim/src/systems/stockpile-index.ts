import { Position, Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import { canonicalById, NodeBuckets } from './spatial.js';

/**
 * The per-world STOCKPILE node index — every positioned {@link Stockpile} bucketed by its half-cell node, so
 * "which heap is on this tile?" costs O(1) instead of a scan over every alive entity. It is the golden-rule-6
 * lever for the per-drop tile lookups: the ground-pile drops (`effects-goods/piles.ts`) and the sow occupancy
 * test used to walk `canonicalEntities()`, ~17k on a decoded map, nearly all of them resource nodes carrying no
 * stock at all — the store this indexes holds only buildings, boat hulls and loose heaps.
 *
 * Derived read-state, never hashed: rebuilt wholesale whenever the Stockpile store generation moves
 * (create/destroy). Two invariants make that key sound, and the registered verifier re-derives the buckets and
 * fires if either stops holding — a future violation surfaces there instead of as a silent wrong pick:
 *
 * - A positioned stockpile never moves and never loses its Position without dying. True of a building, a heap,
 *   and today's boat hull (`command/placement.ts` places a hull as a static store; its movement is a deferred
 *   slice); the movers (settlers, animals, projectiles) carry no Stockpile.
 * - An entity's Position is added BEFORE its Stockpile. The generation this keys on is Stockpile's, so a
 *   Stockpile added first would bump while the entity is still unindexable and the later Position add would
 *   bump nothing, stranding it out of the index. Every creation site adds Position first.
 */

interface StockpileIndexState {
  generation: number;
  /** The indexed entities, ascending-id — kept beside the buckets so the verifier can re-derive membership. */
  list: readonly Entity[];
  buckets: NodeBuckets;
}

const cache = new WeakMap<World, StockpileIndexState>();

function build(world: World): StockpileIndexState {
  // canonicalById first: NodeBuckets preserves input order, and ascending-id buckets are what let a caller's
  // first-match loop land on the same winner a full canonical scan picked.
  const list = canonicalById(world.query(Stockpile, Position));
  return {
    generation: world.componentGeneration(Stockpile),
    // Frozen like the region index's shared memo: an in-place .sort() by a future consumer throws at the
    // mutation site instead of silently reordering the buckets every pick depends on.
    list: Object.freeze(list),
    buckets: new NodeBuckets(world, list),
  };
}

/**
 * Re-derive membership and every node's bucket, reporting divergence from the live copy (empty = coherent).
 * Buckets are compared element-wise, not by membership: ascending-id bucket ORDER is what makes a caller's
 * first-match the canonical winner, so a reordered bucket is a wrong pick a `includes` check would wave through.
 */
function verify(world: World): string[] {
  const cached = cache.get(world);
  if (cached === undefined || cached.generation !== world.componentGeneration(Stockpile)) return [];
  const fresh = canonicalById(world.query(Stockpile, Position));
  if (fresh.length !== cached.list.length) {
    return [
      `stockpileNodeIndex holds ${cached.list.length} stockpiles but re-derived ${fresh.length} — a Stockpile/Position changed without a Stockpile-store generation bump`,
    ];
  }
  const diverged = fresh.findIndex((e, i) => cached.list[i] !== e);
  if (diverged !== -1) {
    return [
      `stockpileNodeIndex holds stockpile ${cached.list[diverged]} at position ${diverged} but re-derived ${fresh[diverged]} — the indexed membership changed without a Stockpile-store generation bump`,
    ];
  }
  for (const [key, bucket] of freshBuckets(world, fresh)) {
    const held = cached.buckets.at(bucket.hx, bucket.hy);
    if (held.length !== bucket.entities.length || bucket.entities.some((e, i) => held[i] !== e)) {
      return [
        `stockpileNodeIndex bucket ${key} diverges from a fresh rebuild — a positioned stockpile moved in place`,
      ];
    }
  }
  return [];
}

/** The nodes `list` buckets to right now, keyed for reporting — the verifier's fresh side. */
function freshBuckets(
  world: World,
  list: readonly Entity[],
): Map<string, { hx: number; hy: number; entities: Entity[] }> {
  const out = new Map<string, { hx: number; hy: number; entities: Entity[] }>();
  for (const e of list) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const key = `(${n.hx},${n.hy})`;
    const bucket = out.get(key) ?? { hx: n.hx, hy: n.hy, entities: [] };
    bucket.entities.push(e); // `list` is ascending-id, so each bucket builds ascending too
    out.set(key, bucket);
  }
  return out;
}

function state(world: World): StockpileIndexState {
  const cached = cache.get(world);
  if (cached !== undefined && cached.generation === world.componentGeneration(Stockpile)) return cached;
  const fresh = build(world);
  cache.set(world, fresh);
  world.registerCacheVerifier('stockpileNodeIndex', () => verify(world));
  return fresh;
}

/**
 * Every positioned {@link Stockpile} whose Position snaps to half-cell node `(hx, hy)`, ascending-id — empty
 * when the node holds none. A superset of the entities at any one exact Position on that node (a fractional
 * drop and a lattice-snapped heap share a node), so a caller re-checking its own exact-Position and marker
 * filters over this list picks the same entity a full canonical scan would.
 */
export function stockpilesAtNode(world: World, hx: number, hy: number): readonly Entity[] {
  return state(world).buckets.at(hx, hy);
}
