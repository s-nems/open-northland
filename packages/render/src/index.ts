import { ONE as SIM_ONE, type Simulation } from '@vinland/sim';

/** Fixed-point scale (one whole tile), re-exported so the scene layer reads snapshot positions. */
export const ONE: number = SIM_ONE;

export {
  buildScene,
  terrainMapToScene,
  type DrawItem,
  type DrawKind,
  type SceneTerrain,
  type SpriteState,
} from './scene.js';
export {
  atlasFromManifest,
  indexAtlasFrames,
  resolveSpriteFrame,
  resolveSpriteBobId,
  DEFAULT_FACING,
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  type DirectionalAnim,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type SpriteKind,
} from './sprites.js';
export {
  createPixiApp,
  loadAtlasSource,
  renderScene,
  renderHud,
  DEFAULT_HUD_STYLE,
  type Camera,
  type SpriteSheet,
  type SpriteLayer,
  type TerrainTextureSet,
  type HudStyle,
} from './pixi-renderer.js';
export {
  DIAMOND_INDICES,
  diamondCorners,
  rectUVs,
  patternSrcRect,
  type SrcRect,
  type CellTexture,
} from './terrain.js';
export {
  buildHud,
  layoutHud,
  placeHud,
  IDLE_JOB,
  type HudModel,
  type HudLayout,
  type HudTextRow,
  type HudPlacement,
  type HudCorner,
  type HudScreen,
  type JobCount,
  type StockCount,
} from './hud.js';
export {
  createSyntheticAtlasSource,
  syntheticAtlasFrames,
  SYNTHETIC_BINDINGS,
  SYNTHETIC_ATLAS_WIDTH,
  SYNTHETIC_ATLAS_HEIGHT,
} from './synthetic-atlas.js';

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
