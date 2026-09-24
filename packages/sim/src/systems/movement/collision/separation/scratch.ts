import { type Fixed, ZERO } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';

export interface MoverSnapshot {
  x: Fixed;
  y: Fixed;
  hx: Fixed;
  hy: Fixed;
}

/** A point the resolve rewrites in place for each mover. */
export interface ScratchPoint {
  x: Fixed;
  y: Fixed;
}

export interface SeparationScratch {
  readonly movers: Entity[];
  readonly posts: Entity[];
  readonly firmMovers: Set<Entity>;
  readonly before: Map<Entity, MoverSnapshot>;
  readonly snapshotPool: MoverSnapshot[];
  /** Per-mover neighbour lists, valid up to the counts the resolve keeps beside them. */
  readonly nearMovers: Entity[];
  readonly nearPosts: Entity[];
  readonly ghostMemo: Map<Entity, boolean>;
  readonly push: ScratchPoint;
  readonly candidate: ScratchPoint;
}

const scratchByWorld = new WeakMap<World, SeparationScratch>();

/** Reuse all high-churn separation collections while keeping the cache isolated per world. */
export function separationScratch(world: World): SeparationScratch {
  let scratch = scratchByWorld.get(world);
  if (scratch === undefined) {
    scratch = {
      movers: [],
      posts: [],
      firmMovers: new Set(),
      before: new Map(),
      snapshotPool: [],
      nearMovers: [],
      nearPosts: [],
      ghostMemo: new Map(),
      push: { x: ZERO, y: ZERO },
      candidate: { x: ZERO, y: ZERO },
    };
    scratchByWorld.set(world, scratch);
  }
  // Return only the previous tick's active snapshots to a dense pool. Entity ids are monotonic, so an
  // id-indexed array here would grow with every historical mover in a long game.
  for (const snapshot of scratch.before.values()) scratch.snapshotPool.push(snapshot);
  scratch.before.clear();
  scratch.movers.length = 0;
  scratch.posts.length = 0;
  scratch.firmMovers.clear();
  scratch.ghostMemo.clear();
  return scratch;
}
