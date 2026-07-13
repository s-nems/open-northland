import type { Fixed } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';

export interface MoverSnapshot {
  x: Fixed;
  y: Fixed;
  hx: Fixed;
  hy: Fixed;
}

export interface SeparationScratch {
  readonly movers: Entity[];
  readonly posts: Entity[];
  readonly firmMovers: Set<Entity>;
  readonly before: Array<MoverSnapshot | undefined>;
  readonly nearMovers: Entity[];
  readonly nearPosts: Entity[];
  readonly ghostMemo: Map<Entity, boolean>;
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
      before: [],
      nearMovers: [],
      nearPosts: [],
      ghostMemo: new Map(),
    };
    scratchByWorld.set(world, scratch);
  }
  scratch.movers.length = 0;
  scratch.posts.length = 0;
  scratch.firmMovers.clear();
  scratch.nearMovers.length = 0;
  scratch.nearPosts.length = 0;
  scratch.ghostMemo.clear();
  return scratch;
}
