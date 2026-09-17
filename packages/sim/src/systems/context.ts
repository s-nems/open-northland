import type { ContentSet } from '@open-northland/data';
import type { AiProgramScript } from '../components/ai-program.js';
import type { CommandQueue } from '../core/command-queue.js';
import type { EventBuffer } from '../core/events.js';
import type { Rng } from '../core/rng.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import type { MissionScript } from './missions/index.js';
import type { FogState } from './vision/index.js';

export interface SystemContext {
  readonly content: ContentSet;
  readonly rng: Rng;
  /** Monotonic tick counter. */
  readonly tick: number;
  /** Emit one-shot events for render/audio (never read back in sim logic). */
  readonly events: EventBuffer;
  /**
   * The serializable command queue, the single mutation seam: CommandSystem drains and applies it and the
   * AiPlayerSystem enqueues into it; no other system touches it.
   */
  readonly commands: CommandQueue;
  /**
   * The terrain cell-adjacency graph. Optional because a trivial fixture runs with no map, so a system
   * that needs it must check and no-op rather than assume it exists.
   */
  readonly terrain?: TerrainGraph;
  /**
   * The per-player fog-of-war masks, a mutable world resource the VisionSystem rebuilds and the combat
   * gates read. Optional like `terrain`, and present but inert while the fog mode is off.
   */
  readonly fog?: FogState;
  /** The map's mission script. Absent for a world that runs none, which is every world whose builder
   *  wires none. */
  readonly missions?: MissionScript;
  /** The map's `[AIData]` rows, one per seat that authored any. Absent like `missions`. */
  readonly aiScript?: AiProgramScript;
}

/**
 * One tick of pure behavior over the world, run in the fixed order of `SYSTEM_ORDER` (schedule.ts,
 * docs/ECS.md). May read and write components and use `ctx.rng`, but must not touch wall-clock,
 * `Math.random`, the DOM, or I/O.
 */
export type System = (world: World, ctx: SystemContext) => void;

/** The slice of a {@link SystemContext} a pure content lookup reads. A helper taking this is callable
 *  outside a tick - from a read view, which holds a `ContentSet` and no live context. */
export type ContentContext = Pick<SystemContext, 'content'>;

/** {@link ContentContext} plus the optional terrain, for a lookup that also resolves map geometry. A helper
 *  taking this is callable from a derived-cache verifier, which runs outside a tick and holds no live
 *  context. */
export type MapContext = Pick<SystemContext, 'content' | 'terrain'>;
