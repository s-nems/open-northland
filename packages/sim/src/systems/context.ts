import type { ContentSet } from '@open-northland/data';
import type { CommandQueue } from '../core/command-queue.js';
import type { EventBuffer } from '../core/events.js';
import type { Rng } from '../core/rng.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import type { FogState } from './vision/index.js';

/**
 * A System is a pure function over the world for one tick. Systems run in a fixed registered
 * order (see SYSTEM_ORDER in schedule.ts and docs/ECS.md). They may read/write components and use
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
   * The serializable command queue — the single mutation seam. CommandSystem drains and applies it;
   * other systems never touch it. Exposed on the context so CommandSystem (a plain System function)
   * can reach the per-sim queue the same way it reaches the world.
   */
  readonly commands: CommandQueue;
  /**
   * The terrain cell-adjacency graph — the navigation/placement model (see nav/terrain/). Optional
   * because trivial fixtures (the determinism golden) run with no map; the pathfinding/terrain
   * systems that need it must check and no-op when it is absent rather than assume it exists.
   */
  readonly terrain?: TerrainGraph;
  /**
   * The per-player fog-of-war masks (see systems/vision.ts) — a mutable world resource the
   * VisionSystem rebuilds and the combat gates read. Optional like `terrain` (a mapless sim has no
   * grid to mask); present but inert while the fog mode is OFF (the default).
   */
  readonly fog?: FogState;
}

export type System = (world: World, ctx: SystemContext) => void;
