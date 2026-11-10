import {
  Building,
  Owner,
  Position,
  Settler,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';

// Everything an eye's footprint reads besides its node: which kinds it is, its owner, and its radius.
const EYE_MEMBERSHIP: readonly Component<unknown>[] = [
  Settler,
  Building,
  Vehicle,
  Owner,
  Position,
  UnderConstruction,
  Upgrading,
];
const EYE_VALUES: readonly Component<unknown>[] = [Settler, Building, Vehicle, Owner];

/**
 * The entities whose eye footprint may have changed since the last vision rebuild: a node move, or a
 * write to a store the footprint reads. A memoizing rebuild visits only these while the fog's eye memo
 * still holds every other eye; another rebuild drains them unread.
 */
class EyeChanges {
  private readonly identity: ChangeFeed;
  private readonly moves: NodeMoveFeed;
  /** The fog's {@link FogState.eyeMemo} at the last memoizing rebuild, -1 before one. */
  private memoAt = -1;
  /** The changed entities of the rebuild in hand, reused; may repeat an entity. Written by index and
   *  trimmed after, since an emptied array drops its storage. */
  private readonly changed: Entity[] = [];
  private count = 0;
  private readonly collect = (e: Entity): void => {
    this.changed[this.count++] = e;
  };

  constructor(world: World) {
    this.identity = world.watchChanges(EYE_MEMBERSHIP, EYE_VALUES);
    this.moves = watchNodeMoves(world);
  }

  /**
   * The entities to visit in this rebuild, or null when it must visit every eye: not memoizing, the
   * memo was dropped since the last memoizing rebuild, or a feed overflowed. Either way the feeds are
   * drained, and `memo` records the memo this rebuild leaves.
   */
  take(memoizing: boolean, memo: number): readonly Entity[] | null {
    this.count = 0;
    const identityLost = this.identity.drain(this.collect);
    const movesLost = this.moves.drain(this.collect);
    if (this.changed.length !== this.count) this.changed.length = this.count;
    const lost = identityLost || movesLost;
    const replay = memoizing && !lost && this.memoAt === memo;
    this.memoAt = memoizing ? memo : -1;
    return replay ? this.changed : null;
  }

  /** Whether the next memoizing rebuild under `memo` would visit only changed eyes. */
  replays(memo: number): boolean {
    return this.memoAt === memo;
  }

  /** Hand every pending entity to `visit` without draining, for a verifier; true instead when a feed
   *  lost entries, so the next rebuild visits every eye. */
  peek(visit: (entity: Entity) => void): boolean {
    const identityLost = this.identity.peek(visit);
    return this.moves.peek(visit) || identityLost;
  }
}

const byWorld = new WeakMap<World, EyeChanges>();

export function eyeChangesOf(world: World): EyeChanges {
  let changes = byWorld.get(world);
  if (changes === undefined) {
    changes = new EyeChanges(world);
    byWorld.set(world, changes);
  }
  return changes;
}
