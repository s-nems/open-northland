import { Position, Settler } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { NodeBuckets } from '../spatial/nodes.js';

interface SettlerNodes {
  readonly membership: ChangeFeed;
  readonly moves: NodeMoveFeed;
  readonly nodes: Map<Entity, { hx: number; hy: number }>;
  readonly buckets: NodeBuckets;
}
const indexes = new WeakMap<World, SettlerNodes>();

/** Shared occupancy for gate retries and evictions. Only changed memberships and node crossings
 * update buckets; fractional steps within the same node leave the index alone. */
export function settlersByNode(world: World): NodeBuckets {
  let index = indexes.get(world);
  if (index === undefined) {
    index = {
      membership: world.watchChanges([Settler, Position], []),
      moves: watchNodeMoves(world),
      nodes: new Map(),
      buckets: new NodeBuckets(world, []),
    };
    indexes.set(world, index);
    rebuild(world, index);
    world.registerCacheVerifier('settlerNodes', () => verify(world));
  }
  const resync = (e: Entity): void => {
    const held = index.nodes.get(e);
    const p = world.has(e, Settler) ? world.tryGet(e, Position) : undefined;
    const next = p === undefined ? undefined : nodeOfPosition(p.x, p.y);
    if (held?.hx === next?.hx && held?.hy === next?.hy) return;
    if (held !== undefined) index.buckets.remove(e, held.hx, held.hy);
    if (next === undefined) index.nodes.delete(e);
    else {
      index.nodes.set(e, next);
      index.buckets.insert(e, next.hx, next.hy);
    }
  };
  const membershipLost = index.membership.drain(resync);
  const movesLost = index.moves.drain(resync);
  if (membershipLost || movesLost) rebuild(world, index);
  return index.buckets;
}

function rebuild(world: World, index: SettlerNodes): void {
  const entities = world.canonicalQuery(Settler, Position);
  index.buckets.refill(world, entities);
  index.nodes.clear();
  for (const e of entities) {
    const p = world.get(e, Position);
    index.nodes.set(e, nodeOfPosition(p.x, p.y));
  }
}

function verify(world: World): string[] {
  const held = settlersByNode(world);
  const fresh = new NodeBuckets(world, world.canonicalQuery(Settler, Position));
  for (const buckets of [held, fresh]) {
    for (const { x, y } of buckets.buckets()) {
      const a = held.at(x, y),
        b = fresh.at(x, y);
      if (a.length !== b.length || a.some((e, i) => e !== b[i])) return [`settlerNodes stale at ${x},${y}`];
    }
  }
  return [];
}
