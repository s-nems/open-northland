import type { ContentSet } from '@vinland/data';
import type { World } from '../ecs/world.js';
import type { EventBuffer } from '../events.js';
import type { Rng } from '../rng.js';
import type { TerrainGraph } from '../terrain.js';

/**
 * A System is a pure function over the world for one tick. Systems run in a fixed registered
 * order (see SYSTEM_ORDER in index.ts and docs/ECS.md). They may read/write components and use
 * ctx.rng, but must not touch wall-clock, Math.random, the DOM, or I/O.
 */
export interface SystemContext {
  readonly content: ContentSet;
  readonly rng: Rng;
  /** Monotonic tick counter. */
  readonly tick: number;
  /** Emit one-shot events for render/audio (never read back in sim logic). */
  readonly events: EventBuffer;
  /**
   * The terrain cell-adjacency graph — the navigation/placement model (see terrain.ts). Optional
   * because trivial fixtures (the determinism golden) run with no map; the pathfinding/terrain
   * systems that need it must check and no-op when it is absent rather than assume it exists.
   */
  readonly terrain?: TerrainGraph;
}

export type System = (world: World, ctx: SystemContext) => void;
