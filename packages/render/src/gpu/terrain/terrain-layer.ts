import { BufferImageSource, Container } from 'pixi.js';
import { makeBrightnessField } from '../../data/brightness.js';
import { type ElevationField, makeElevationField } from '../../data/elevation.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import { aabbIntersects, type Viewport } from '../../data/viewport.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { padLaneRows } from '../shading.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { buildFlat } from './build-flat.js';
import { buildTextured } from './build-ground.js';
import type { LaneShading, TerrainChunk } from './geometry.js';

/**
 * The retained terrain layer — the static ground, meshed ONCE per map and drawn per visible block.
 *
 * THE MESH is the original's tessellation (`data/terrain.ts`): vertices are cell-centre NODES and
 * each cell contributes two triangles spanning BETWEEN neighbouring centres (△ A down to the
 * SW/SE-below cells, ▽ B across to the E cell) — so per-triangle pattern picks and transition
 * overlays blend organically across cells instead of along per-cell diamond seams. Per-node
 * elevation lift (`elevation/16` half-row-steps, border clamped to 0) warps the whole ground
 * continuously; the map's `emt1..emt4` transition lanes draw as translucent RGBA overlay meshes
 * composited base → layer 2 → layer 1 by child order.
 *
 * Terrain is static geometry, but a whole-map single mesh still rasterizes off-screen ground every
 * frame (a whole-map mesh once pinned software-GL at 1fps). So the grid is meshed in
 * {@link import('./geometry.js').TERRAIN_CHUNK_TILES}-square blocks each with a world-space AABB, and
 * {@link TerrainLayer.cull} toggles each block's `.visible` against the viewport per frame: **render cost
 * tracks the SCREEN, not the map** (the RTS rule — OpenRA's `Viewport` visible-cell region, our
 * `viewport.ts`), so a 1024² map draws the same handful of blocks a 64² one does. The geometry + page
 * textures are built ONCE by the {@link import('./build-ground.js')} / {@link import('./build-flat.js')}
 * emitters and RETAINED here, so no terrain work happens per frame beyond the cheap visibility toggle.
 */

/** A flat field (no lift) — the shared default for the elevation-free path (synthetic grids / no lane). */
const FLAT_ELEVATION: ElevationField = makeElevationField(undefined, 0, 0);

/** WebGL's default UNPACK_ALIGNMENT, in bytes (1 byte per R8 texel) — the brightness lane's row padding. */
const ROW_ALIGN = 4;

export class TerrainLayer {
  /** Static, built once by {@link set}; the renderer keeps it behind the sprite layer. */
  readonly container = new Container();
  /** The meshed terrain blocks + their world-space AABBs, culled to the viewport each frame. */
  private chunks: TerrainChunk[] = [];
  /** The map's `embr` lane as an R8 texture (per-fragment shading); undefined on an unshaded map. */
  private brightnessTex: BufferImageSource | undefined;
  /** The lane texture's padded width in texels (the `u` denominator; see {@link set}'s padding note). */
  private laneTexWidth = 0;

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it batches every cell's two triangles into one {@link import('pixi.js').Mesh} per texture
   * page per draw layer (draw-call count ~one per page per layer, independent of map size); without them
   * it draws the flat placeholder triangles. Either way the geometry + page textures are built here and
   * RETAINED, so no terrain work happens per frame. The map's baked `embr` shading (`terrain.brightness`,
   * absent → unshaded) rides as an R8 lane texture the shaded meshes sample per FRAGMENT, at each vertex's
   * own cell-centre coordinate — the engine model (one value per node, blended across the triangle).
   */
  set(terrain: SceneTerrain, textures?: TerrainTextureSet, elevation: ElevationField = FLAT_ELEVATION): void {
    this.destroy();
    // ONE source for the shading: both the CPU field (fallback/flat tints) and the R8 lane texture
    // are built HERE from `terrain.brightness`, so no caller can hand the mesh and the fallbacks
    // disagreeing inputs (the elevation field stays injected — the renderer retains it per frame).
    const brightness = makeBrightnessField(terrain.brightness, terrain.width, terrain.height);
    // The lane texture the shaded ground shader samples per fragment: the raw `embr` bytes as an R8
    // grid, linear-filtered + edge-clamped (the GPU twin of `makeCellSampler`'s bilinear + clamp).
    // ~W×H bytes once per map; undefined on an unshaded map (the stock-shader path) and on the flat
    // placeholder path (which shades CPU-side). Rows are alignment-padded — see `padLaneRows`.
    if (brightness.shaded && terrain.brightness !== undefined && textures !== undefined) {
      const lane = padLaneRows(terrain.brightness, terrain.width, terrain.height, ROW_ALIGN);
      this.laneTexWidth = lane.paddedWidth;
      this.brightnessTex = new BufferImageSource({
        resource: lane.data,
        width: lane.paddedWidth,
        height: terrain.height,
        format: 'r8unorm',
        // The GPU twin of `makeCellSampler` (bilinear + edge clamp) is a CONTRACT, not an inherited
        // default — pin it (this codebase flips other sources to 'nearest' for pixel art).
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      });
    }
    const lane: LaneShading = { brightnessTex: this.brightnessTex, laneTexWidth: this.laneTexWidth };
    this.chunks =
      textures !== undefined
        ? buildTextured(this.container, terrain, textures, elevation, brightness, lane)
        : buildFlat(this.container, terrain, elevation, brightness);
  }

  /**
   * Draw ONLY the blocks whose box meets the viewport (RTS rule — cost tracks the screen, not the map).
   * Off-screen blocks stay in the graph but skip rasterization; a bounded MIN_ZOOM keeps the
   * visible-block count small even fully zoomed out.
   */
  cull(vp: Viewport): void {
    for (const chunk of this.chunks) {
      chunk.container.visible = aabbIntersects(vp, chunk);
    }
  }

  /**
   * Free the current terrain: each chunk is a {@link Container} of {@link import('pixi.js').Mesh}es whose
   * GPU buffers + custom shader `Mesh.destroy` does not release, so {@link destroyMeshChildren} frees those
   * first, then the container + its children go. The tile textures/`Texture.WHITE` are SHARED sources and
   * are deliberately left alone (as is the shaded ground's process-wide GL program). Used by {@link set}
   * (a rebuild) and the renderer's dispose.
   */
  destroy(): void {
    for (const chunk of this.chunks) {
      destroyMeshChildren(chunk.container);
      chunk.container.destroy({ children: true });
    }
    this.chunks = [];
    this.brightnessTex?.destroy();
    this.brightnessTex = undefined;
    this.laneTexWidth = 0;
  }
}
