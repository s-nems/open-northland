import { Owner, Person, Position, Resting, Settler } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, rowReachLeft, rowReachRight } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { standsAtPost } from '../conflict/tower-post.js';
import { HeldNodes, NO_NODE } from '../spatial/held-nodes.js';
import { moverNode } from '../spatial/mover-node.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { NodeBuckets } from '../spatial/nodes.js';

/** Shared occupancy for gate retries and evictions, a walker on its {@link moverNode}. Only changed
 * memberships and node crossings update buckets; fractional steps within the same node leave the index
 * alone. The bucketed nodes are held in typed columns, so catching up on a backlog of moves allocates
 * nothing. */
class SettlerNodes {
  private readonly membership: ChangeFeed;
  private readonly moves: NodeMoveFeed;
  /** Each settler's bucketed node, {@link NO_NODE} for an entity not bucketed. */
  private readonly nodes = new HeldNodes();
  readonly buckets: NodeBuckets;
  /** The membership drain's consumer, a field so the feed calls it directly. */
  private readonly resync = (e: Entity): void => {
    const world = this.world;
    const p = world.has(e, Settler) ? world.tryGet(e, Position) : undefined;
    if (p === undefined) {
      this.bucket(e, NO_NODE, 0);
      return;
    }
    const node = moverNode(world, e, p);
    this.bucket(e, node.hx, node.hy);
  };
  /** The move drain's consumer, which reads the node the move feed already derived. */
  private readonly follow = (e: Entity): void => {
    if (this.world.has(e, Settler)) this.bucket(e, this.moves.heldHx(e), this.moves.heldHy(e));
    else this.bucket(e, NO_NODE, 0);
  };

  /** Bucket `e` at `(hx, hy)`, or drop it for {@link NO_NODE}. */
  private bucket(e: Entity, hx: number, hy: number): void {
    const world = this.world;
    const nodes = this.nodes;
    const heldX = nodes.hx(e);
    const heldY = nodes.hy(e);
    if (heldX === hx && heldY === hy) return;
    if (heldX !== NO_NODE) this.buckets.remove(e, heldX, heldY);
    nodes.set(e, hx, hy, world.nextEntityId);
    if (hx !== NO_NODE) this.buckets.insert(e, hx, hy);
  }

  constructor(private readonly world: World) {
    this.membership = world.watchChanges([Settler, Position], []);
    this.moves = watchNodeMoves(world);
    this.buckets = new NodeBuckets(world, []);
    this.rebuild();
  }

  catchUp(): NodeBuckets {
    const membershipLost = this.membership.drain(this.resync);
    const movesLost = this.moves.drain(this.follow);
    if (membershipLost || movesLost) this.rebuild();
    return this.buckets;
  }

  private rebuild(): void {
    const world = this.world;
    const entities = world.canonicalQuery(Settler, Position);
    const idLimit = world.nextEntityId;
    this.buckets.refill(world, entities);
    this.nodes.reset(idLimit);
    for (const e of entities) {
      const node = moverNode(world, e, world.get(e, Position));
      this.nodes.set(e, node.hx, node.hy, idLimit);
    }
  }
}
const indexes = new WeakMap<World, SettlerNodes>();

export function settlersByNode(world: World): NodeBuckets {
  let index = indexes.get(world);
  if (index === undefined) {
    index = new SettlerNodes(world);
    indexes.set(world, index);
    world.registerCacheVerifier('settlerNodes', () => verify(world));
  }
  return index.catchUp();
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

/** `player`'s people out in the open within `radius` map points of `at`, ascending (distance, id). */
export function peopleNear(
  world: World,
  terrain: TerrainGraph,
  player: number,
  at: NodeId,
  radius: number,
): Entity[] {
  const centre = { hx: terrain.xOf(at), hy: terrain.yOf(at) };
  const byNode = settlersByNode(world);
  const near: { entity: Entity; distance: number }[] = [];
  const lastRow = Math.min(terrain.height - 1, centre.hy + radius);
  for (let hy = Math.max(0, centre.hy - radius); hy <= lastRow; hy++) {
    const right = Math.min(terrain.width - 1, rowReachRight(centre, hy, radius));
    for (let hx = Math.max(0, rowReachLeft(centre, hy, radius)); hx <= right; hx++) {
      for (const e of byNode.at(hx, hy)) {
        if (world.tryGet(e, Owner)?.player !== player || !world.has(e, Person)) continue;
        if (world.has(e, Resting) && standsAtPost(world, e) === null) continue; // indoors
        near.push({ entity: e, distance: hexDistanceBetween(hx, hy, centre.hx, centre.hy) });
      }
    }
  }
  near.sort((a, b) => a.distance - b.distance || a.entity - b.entity);
  return near.map((n) => n.entity);
}
