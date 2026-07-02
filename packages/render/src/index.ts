import type { Simulation } from '@vinland/sim';

export { ONE, TILE_HALF_W, TILE_HALF_H, tileToScreen, type Camera } from './iso.js';
export {
  buildScene,
  buildSpriteScene,
  drawableEntityRefs,
  terrainMapToScene,
  type DrawItem,
  type DrawKind,
  type SceneGround,
  type SceneTerrain,
  type SpriteState,
} from './scene.js';
export {
  atlasFromManifest,
  indexAtlasFrames,
  pickByJob,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveSpriteFrame,
  resolveSpriteBobId,
  DEFAULT_FACING,
  type AtlasFrame,
  type AtlasManifest,
  type AtlasManifestFrame,
  type BuildingBobRef,
  type BuildingDraw,
  type BuildingTypeBinding,
  type ByJobTable,
  type CarryingBinding,
  type ConstructionLayerRef,
  type DirectionalAnim,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteBindings,
  type SpriteFrameRef,
  type SpriteKind,
} from './sprites.js';
export {
  createPixiApp,
  createWindowPixiApp,
  loadAtlasSource,
  type GroundPattern,
  type SettlerCharacter,
  type SettlerCharacterSet,
  type SpriteSheet,
  type SpriteLayer,
  type TerrainTextureSet,
} from './pixi-renderer.js';
export {
  WorldRenderer,
  reconcileSprites,
  DEFAULT_HUD_STYLE,
  type HudStyle,
  type HudFrame,
  type MapObjectSprite,
} from './world-renderer.js';
export {
  AnimationGallery,
  galleryCellLayout,
  clipDirs,
  galleryBobId,
  headBobId,
  GALLERY_DIRS,
  COMPASS_TO_BLOCK,
  type GalleryClip,
  type GalleryCellSpec,
  type GalleryDirection,
  type GalleryCellBox,
} from './animation-gallery.js';
export {
  cameraViewport,
  isVisible,
  visibleTileRange,
  type Viewport,
  type TileRange,
} from './viewport.js';
export {
  DIAMOND_INDICES,
  TRIANGLE_A_CORNERS,
  TRIANGLE_B_CORNERS,
  diamondCorners,
  rectUVs,
  patternSrcRect,
  triangleCorners,
  triangleUVs,
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

// TODO(Phase 2): implement PixiRenderer satisfying Renderer. See docs/ROADMAP.md.
