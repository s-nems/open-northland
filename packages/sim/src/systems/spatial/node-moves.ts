import { Position } from '../../components/index.js';
import { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';

/** The held `hx` of an entity without a Position: the Int32 minimum, which no node's `hx` reaches. An
 *  off-map entity's node is negative, so no smaller sentinel is safe. */
const NO_NODE = -(2 ** 31);

/** The read side of a {@link NodeMoves} subscription: a {@link ChangeFeed} of node changes. */
export interface NodeMoveFeed {
  readonly pending: boolean;
  drain(consume: (entity: Entity) => void): boolean;
  peek(visit: (entity: Entity) => void): boolean;
}

/**
 * The entities whose half-cell node changed, fanned out to every index keyed on a Position's node. One
 * feed takes every Position write and the shared pass forwards only a node change, so a walker's
 * in-node steps cost one compare instead of one replay per index. Each subscriber gets an entity at
 * least once whenever its node at the subscriber's drain differs from its node at the previous drain;
 * an index that reads a sub-node position watches Position values itself.
 */
class NodeMoves {
  private readonly writes: ChangeFeed;
  private readonly subscribers: ChangeFeed[] = [];
  /** Each entity's node at the last pass by id, {@link NO_NODE} in `hxs` for one without a Position. */
  private hxs = new Int32Array(0);
  private hys = new Int32Array(0);
  private readonly compareEntity = (e: Entity): void => this.compare(e);

  constructor(private readonly world: World) {
    // Membership too: a Position re-added elsewhere must move the held node, or a later step back
    // onto the old node would compare equal and go unseen.
    this.writes = world.watchChanges([Position], [Position]);
    this.resync();
  }

  subscribe(): NodeMoveFeed {
    const feed = new ChangeFeed();
    this.subscribers.push(feed);
    return new Subscription(this, feed);
  }

  /** Forward the node changes since the last pass. */
  pump(): void {
    if (!this.writes.pending) return;
    if (this.writes.drain(this.compareEntity)) {
      for (const feed of this.subscribers) feed.lose();
      this.resync();
    }
  }

  private compare(e: Entity): void {
    const p = this.world.tryGet(e, Position);
    if (e >= this.hxs.length) this.grow(e);
    let hx = NO_NODE;
    let hy = 0;
    if (p !== undefined) {
      hx = nodeHxOfPosition(p.x, p.y);
      hy = nodeHyOfPosition(p.y);
    }
    if (this.hxs[e] === hx && this.hys[e] === hy) return;
    this.hxs[e] = hx;
    this.hys[e] = hy;
    const subscribers = this.subscribers;
    for (let i = 0; i < subscribers.length; i++) subscribers[i]?.record(e);
  }

  private grow(e: Entity): void {
    const size = Math.max(this.world.nextEntityId, e + 1, 2 * this.hxs.length);
    const hxs = new Int32Array(size).fill(NO_NODE);
    hxs.set(this.hxs);
    const hys = new Int32Array(size);
    hys.set(this.hys);
    this.hxs = hxs;
    this.hys = hys;
  }

  private resync(): void {
    this.hxs = new Int32Array(this.world.nextEntityId).fill(NO_NODE);
    this.hys = new Int32Array(this.world.nextEntityId);
    for (const e of this.world.query(Position)) {
      const p = this.world.get(e, Position);
      this.hxs[e] = nodeHxOfPosition(p.x, p.y);
      this.hys[e] = nodeHyOfPosition(p.y);
    }
  }

  /** Every held node against the live Position after a pass, so a missed write surfaces here instead of
   *  as a stale subscriber index. */
  verify(): string[] {
    this.pump();
    for (let e = 0; e < this.hxs.length; e++) {
      const p = this.world.tryGet(e as Entity, Position);
      const hx = p === undefined ? NO_NODE : nodeHxOfPosition(p.x, p.y);
      const hy = p === undefined ? 0 : nodeHyOfPosition(p.y);
      if (this.hxs[e] !== hx || (p !== undefined && this.hys[e] !== hy)) {
        return [`nodeMoves holds a stale node for entity ${e}`];
      }
    }
    for (const e of this.world.query(Position)) {
      if (e >= this.hxs.length) return [`nodeMoves never held positioned entity ${e}`];
    }
    return [];
  }
}

class Subscription implements NodeMoveFeed {
  constructor(
    private readonly moves: NodeMoves,
    private readonly feed: ChangeFeed,
  ) {}

  get pending(): boolean {
    this.moves.pump();
    return this.feed.pending;
  }

  drain(consume: (entity: Entity) => void): boolean {
    this.moves.pump();
    return this.feed.drain(consume);
  }

  peek(visit: (entity: Entity) => void): boolean {
    this.moves.pump();
    return this.feed.peek(visit);
  }
}

const byWorld = new WeakMap<World, NodeMoves>();

/** A new feed of the entities whose Position node changed from now on, shared with every other
 *  subscriber of `world`. */
export function watchNodeMoves(world: World): NodeMoveFeed {
  let moves = byWorld.get(world);
  if (moves === undefined) {
    const created = new NodeMoves(world);
    world.registerCacheVerifier('nodeMoves', () => created.verify());
    byWorld.set(world, created);
    moves = created;
  }
  return moves.subscribe();
}
