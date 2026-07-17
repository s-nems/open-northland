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
 * (create/destroy). That memo is only sound because a positioned stockpile never moves and never loses its
 * Position without dying — true of a building, a heap, and today's boat hull (`command/placement.ts` places a
 * hull as a static store; its movement is a deferred slice). The registered verifier re-derives the buckets and
 * fires the moment that stops holding, so a future moving hull surfaces here instead of as a silent wrong pick.
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
    list,
    buckets: new NodeBuckets(world, list),
  };
}

/** Re-derive membership and every member's bucket, reporting divergence from the live copy (empty = coherent). */
function verify(world: World): string[] {
  const cached = cache.get(world);
  if (cached === undefined || cached.generation !== world.componentGeneration(Stockpile)) return [];
  const fresh = canonicalById(world.query(Stockpile, Position));
  if (fresh.length !== cached.list.length || fresh.some((e, i) => cached.list[i] !== e)) {
    return [
      `stockpileNodeIndex holds ${cached.list.length} stockpiles but re-derived ${fresh.length} — a Stockpile/Position changed without a Stockpile-store generation bump`,
    ];
  }
  for (const e of fresh) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    if (!cached.buckets.at(n.hx, n.hy).includes(e)) {
      return [
        `stockpileNodeIndex lost stockpile ${e} at node (${n.hx},${n.hy}) — a positioned stockpile moved in place`,
      ];
    }
  }
  return [];
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
