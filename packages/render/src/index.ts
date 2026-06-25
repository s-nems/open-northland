import { ONE as SIM_ONE, type Simulation } from '@vinland/sim';

/** Fixed-point scale (one whole tile), re-exported so the scene layer reads snapshot positions. */
export const ONE: number = SIM_ONE;

export { buildScene, type DrawItem, type DrawKind, type SceneTerrain } from './scene.js';
export { createPixiApp, renderScene, type Camera } from './pixi-renderer.js';

/**
 * The renderer is a PURE CONSUMER of sim state (see docs/ARCHITECTURE.md). It reads a snapshot
 * and draws; it never mutates the sim and the sim never imports this package. It interpolates
 * between the previous and current tick using the `alpha` from the fixed-timestep driver so motion
 * is smooth regardless of the 20Hz sim rate.
 *
 * This is the Phase-2 interface stub. Implementation uses PixiJS:
 *  - isometric tile layer from the map's landscape grid
 *  - depth-sorted sprite layer (sort by world Y / feet anchor)
 *  - animation playback driven by each entity's logical state (state -> anim name in content)
 *  - camera (pan/zoom) and picking (screen -> tile) for input
 */
export interface Renderer {
  /** Initialise GPU resources, load atlases referenced by the content set. */
  init(canvas: HTMLCanvasElement): Promise<void>;
  /** Draw one frame. `alpha` in [0,1) blends previous->current tick positions. */
  draw(sim: Simulation, alpha: number): void;
  /** Convert a screen coordinate to a world tile (for input/picking). */
  screenToTile(sx: number, sy: number): { tileX: number; tileY: number };
  dispose(): void;
}

/** Isometric projection constants — tile diamond half-extents in pixels. Tune to the art. */
export const TILE_HALF_W = 32;
export const TILE_HALF_H = 16;

/** Cartesian tile (col,row) -> isometric screen offset (before camera). Pure, unit-tested-able. */
export function tileToScreen(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * TILE_HALF_W,
    y: (col + row) * TILE_HALF_H,
  };
}

// TODO(Phase 2): implement PixiRenderer satisfying Renderer. See docs/ROADMAP.md.
