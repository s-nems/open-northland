import { PathFollow, PathRoute, Position } from '../../components/index.js';
import { ChangeFeed } from '../../ecs/change-feed.js';
import type { Entity, World } from '../../ecs/world.js';
import { HeldNodes, NO_NODE } from './held-nodes.js';
import { moverNode } from './mover-node.js';

/** The read side of a {@link NodeMoves} subscription: a {@link ChangeFeed} of node changes. */
export interface NodeMoveFeed {
  readonly pending: boolean;
  drain(consume: (entity: Entity) => void): boolean;
  peek(visit: (entity: Entity) => void): boolean;
  /** The node `e` was held at by the last pump, {@link NO_NODE} in `hx` for no Position: inside a
   *  {@link drain}'s consumer, the node `e` reads now, so the consumer need not re-derive it. */
  heldHx(e: Entity): number;
  heldHy(e: Entity): number;
}

/**
 * The entities whose half-cell node changed, fanned out to every index keyed on an entity's node, a
 * mover's by {@link moverNode}. One feed takes every Position and route write and the shared pass forwards
 * only a node change, so a walker's in-node steps cost one compare instead of one replay per index. Each
 * subscriber gets an entity at least once whenever its node at the subscriber's drain differs from its
 * node at the previous drain; an index that reads a sub-node position watches Position values itself.
 */
class NodeMoves {
  private readonly writes: ChangeFeed;
  private readonly subscribers: ChangeFeed[] = [];
  /** Each entity's node at the last pass, {@link NO_NODE} for one without a Position. */
  private readonly nodes = new HeldNodes();
  /** The pump's per-write consumer, a field rather than a method so the drain calls it directly. */
  private readonly compare = (e: Entity): void => {
    const p = this.world.tryGet(e, Position);
    let hx = NO_NODE;
    let hy = 0;
    if (p !== undefined) {
      const node = moverNode(this.world, e, p);
      hx = node.hx;
      hy = node.hy;
    }
    const nodes = this.nodes;
    if (nodes.hx(e) === hx && nodes.hy(e) === hy) return;
    nodes.set(e, hx, hy, this.world.nextEntityId);
    const subscribers = this.subscribers;
    for (let i = 0; i < subscribers.length; i++) subscribers[i]?.record(e);
  };

  constructor(private readonly world: World) {
    // Membership too: a Position re-added elsewhere must move the held node, or a later step back
    // onto the old node would compare equal and go unseen. A route installed, advanced or dropped can
    // start or end a column step without a Position write.
    this.writes = world.watchChanges([Position, PathFollow, PathRoute], [Position, PathFollow, PathRoute]);
    this.resync();
  }

  heldHx(e: Entity): number {
    return this.nodes.hx(e);
  }

  heldHy(e: Entity): number {
    return this.nodes.hy(e);
  }

  subscribe(): NodeMoveFeed {
    const feed = new ChangeFeed();
    this.subscribers.push(feed);
    return new Subscription(this, feed);
  }

  /** Forward the node changes since the last pass. */
  pump(): void {
    if (!this.writes.pending) return;
    if (this.writes.drain(this.compare)) {
      for (const feed of this.subscribers) feed.lose();
      this.resync();
    }
  }

  private resync(): void {
    const idLimit = this.world.nextEntityId;
    this.nodes.reset(idLimit);
    for (const e of this.world.query(Position)) {
      const node = moverNode(this.world, e, this.world.get(e, Position));
      this.nodes.set(e, node.hx, node.hy, idLimit);
    }
  }

  /** Every held node against the live Position after a pass, so a missed write surfaces here instead of
   *  as a stale subscriber index. */
  verify(): string[] {
    this.pump();
    for (let e = 0; e < this.nodes.size; e++) {
      const p = this.world.tryGet(e as Entity, Position);
      const node = p === undefined ? undefined : moverNode(this.world, e as Entity, p);
      const hx = node === undefined ? NO_NODE : node.hx;
      const hy = node === undefined ? 0 : node.hy;
      if (this.nodes.hx(e as Entity) !== hx || (p !== undefined && this.nodes.hy(e as Entity) !== hy)) {
        return [`nodeMoves holds a stale node for entity ${e}`];
      }
    }
    for (const e of this.world.query(Position)) {
      if (e >= this.nodes.size) return [`nodeMoves never held positioned entity ${e}`];
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

  heldHx(e: Entity): number {
    return this.moves.heldHx(e);
  }

  heldHy(e: Entity): number {
    return this.moves.heldHy(e);
  }
}

const byWorld = new WeakMap<World, NodeMoves>();

/** A new feed of the entities whose node changed from now on, shared with every other
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
