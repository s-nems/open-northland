import { type Fixed, ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';

/** A mover's pre-separation state, kept across ticks while it walks and refreshed by each census. */
export interface MoverSnapshot {
  x: Fixed;
  y: Fixed;
  hx: Fixed;
  hy: Fixed;
  /** A firm collider: an owned fighter. */
  firm: boolean;
  /** The census that last saw this mover; an older stamp means it stopped walking. */
  census: number;
}

/** A point the resolve rewrites in place for each mover. */
export interface ScratchPoint {
  x: Fixed;
  y: Fixed;
}

/**
 * Collections the separation pass refills every tick without reallocating them: an emptied Map, Set or
 * `length = 0` array drops its storage, and regrowing it cost more than the rest of the pass.
 */
export interface SeparationScratch {
  /** This tick's movers and posts, rewritten in place and trimmed to length. */
  readonly movers: Entity[];
  readonly posts: Entity[];
  /** Keyed by mover; an entry leaves when a census no longer finds its mover walking, so entity ids that
   *  stopped moving are never retained. */
  readonly before: Map<Entity, MoverSnapshot>;
  readonly snapshotPool: MoverSnapshot[];
  census: number;
  /** Per-mover neighbour lists, valid up to the counts the resolve keeps beside them. */
  readonly nearMovers: Entity[];
  readonly nearPosts: Entity[];
  readonly ghostMemo: Map<Entity, boolean>;
  readonly push: ScratchPoint;
  readonly candidate: ScratchPoint;
}

const scratchByWorld = new WeakMap<World, SeparationScratch>();

/** The world's separation scratch, its per-tick ghost memo emptied. */
export function separationScratch(world: World): SeparationScratch {
  let scratch = scratchByWorld.get(world);
  if (scratch === undefined) {
    scratch = {
      movers: [],
      posts: [],
      before: new Map(),
      snapshotPool: [],
      census: 0,
      nearMovers: [],
      nearPosts: [],
      ghostMemo: new Map(),
      push: { x: ZERO, y: ZERO },
      candidate: { x: ZERO, y: ZERO },
    };
    scratchByWorld.set(world, scratch);
  }
  scratch.ghostMemo.clear();
  return scratch;
}
