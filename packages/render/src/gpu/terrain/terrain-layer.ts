import { BufferImageSource, Container } from 'pixi.js';
import { aabbIntersects, type Viewport } from '../../data/projection/index.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type BrightnessField,
  composeShadingLane,
  type ElevationField,
  makeBrightnessField,
  makeElevationField,
  makeWaveField,
  NO_WAVE,
} from '../../data/terrain/index.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { makeWaveUniforms, padLaneRows, WAVE_TIME_PERIOD_TICKS, type WaveUniforms } from '../shading.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { buildFlat } from './build-flat.js';
import { buildTextured } from './build-ground.js';
import type { LaneShading, TerrainChunk } from './geometry.js';

/**
 * The retained terrain layer — the static ground, meshed once per map and drawn per visible block.
 *
 * The mesh is the original's tessellation (`data/terrain.ts`): vertices are cell-centre nodes and each
 * cell contributes two triangles spanning between neighbouring centres (△ A down to the SW/SE-below
 * cells, ▽ B across to the E cell), so per-triangle pattern picks and transition overlays blend across
 * cells instead of along per-cell diamond seams. Per-node elevation lift (`elevation/16` half-row-steps,
 * border clamped to 0) warps the ground continuously; the map's `emt1..emt4` transition lanes draw as
 * translucent RGBA overlay meshes composited base → layer 2 → layer 1 by child order.
 *
 * The grid is meshed in {@link import('./geometry.js').TERRAIN_CHUNK_TILES}-square blocks each with a
 * world-space AABB, and {@link TerrainLayer.cull} toggles each block's `.visible` against the viewport
 * per frame, so render cost tracks the screen, not the map. The geometry + page textures are built once
 * by the {@link import('./build-ground.js')} / {@link import('./build-flat.js')} emitters and retained
 * here, so no terrain work happens per frame beyond the visibility toggle.
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
  /** The composed shading lane as an R8 texture (per-fragment shading); undefined on an unshaded map. */
  private brightnessTex: BufferImageSource | undefined;
  /** The lane texture's padded width in texels (the `u` denominator; see {@link set}'s padding note). */
  private laneTexWidth = 0;
  /** The composed shading field ({@link brightnessField}) — neutral until {@link set} builds a shaded map. */
  private field: BrightnessField = makeBrightnessField(undefined, 0, 0);
  /** The map's ONE shared water-animation uniform group, bound into every shaded mesh — so
   *  {@link animate} is a single write per frame, not one per chunk. Undefined until {@link set}. */
  private waveGroup: WaveUniforms | undefined;
  /** Whether the current map has any water-patterned cell — a land map skips {@link animate} outright. */
  private hasWater = false;

  /**
   * (Re)build the cached terrain from a grid — call once per map (a terrain edit re-invalidates). With
   * `textures` it batches every cell's two triangles into one {@link import('pixi.js').Mesh} per texture
   * page per draw layer (draw-call count ~one per page per layer, independent of map size); without them
   * it draws the flat placeholder triangles. Either way the geometry + page textures are built here and
   * retained, so no terrain work happens per frame. The map's baked `embr` shading (`terrain.brightness`,
   * absent → unshaded) rides as an R8 lane texture the shaded meshes sample per fragment, at each vertex's
   * own cell-centre coordinate — the engine model (one value per node, blended across the triangle).
   */
  set(terrain: SceneTerrain, textures?: TerrainTextureSet, elevation: ElevationField = FLAT_ELEVATION): void {
    this.destroy();
    // One source for the shading: both the CPU field (fallback/flat tints) and the R8 lane texture
    // are built here from the composed lane — the decoded `embr` bake accented (or replaced, on maps
    // without it) by elevation hillshade (`data/hillshade.ts`) — so no caller can hand the mesh and
    // the fallbacks disagreeing inputs (the elevation field stays injected — the renderer retains it
    // per frame).
    const shadingLane = composeShadingLane(
      terrain.brightness,
      terrain.elevation,
      terrain.width,
      terrain.height,
    );
    const brightness = makeBrightnessField(shadingLane, terrain.width, terrain.height);
    this.field = brightness;
    // The lane texture the shaded ground shader samples per fragment: the composed lane bytes as an R8
    // grid, linear-filtered + edge-clamped (the GPU twin of `makeCellSampler`'s bilinear + clamp).
    // ~W×H bytes once per map; undefined on an unshaded map (the stock-shader path) and on the flat
    // placeholder path (which shades CPU-side). Rows are alignment-padded — see `padLaneRows`.
    if (brightness.shaded && shadingLane !== undefined && textures !== undefined) {
      const lane = padLaneRows(shadingLane, terrain.width, terrain.height, ROW_ALIGN);
      this.laneTexWidth = lane.paddedWidth;
      this.brightnessTex = new BufferImageSource({
        resource: lane.data,
        width: lane.paddedWidth,
        height: terrain.height,
        format: 'r8unorm',
        // The GPU twin of `makeCellSampler` (bilinear + edge clamp) is a contract, not an inherited
        // default — pin it (this codebase flips other sources to 'nearest' for pixel art).
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      });
    }
    // Water-wave amplitudes ride the shaded mesh path only (`pushTriangle` uploads `aWave` exactly
    // when the batch carries brightness UVs), so a water map WITHOUT a shading lane draws stock
    // meshes and stays still — gate the per-frame animate() on both, not just the wave field.
    const wave = makeWaveField(terrain.ground, terrain.width, terrain.height);
    this.hasWater = wave !== NO_WAVE && this.brightnessTex !== undefined;
    this.waveGroup = makeWaveUniforms();
    const lane: LaneShading = {
      brightnessTex: this.brightnessTex,
      laneTexWidth: this.laneTexWidth,
      wave,
      waveUniforms: this.waveGroup,
    };
    this.chunks =
      textures !== undefined
        ? buildTextured(this.container, terrain, textures, elevation, brightness, lane)
        : buildFlat(this.container, terrain, elevation, brightness);
  }

  /** The composed shading field the ground drew with — the one source sprite-anchor shading must share
   *  so an entity can't disagree with the ground it stands on. Neutral (`shaded: false`) until a shaded
   *  map is {@link set}. */
  brightnessField(): BrightnessField {
    return this.field;
  }

  /**
   * Draw only the blocks whose box meets the viewport (RTS rule — cost tracks the screen, not the map).
   * Off-screen blocks stay in the graph but skip rasterization; a bounded MIN_ZOOM keeps the
   * visible-block count small even fully zoomed out.
   */
  cull(vp: Viewport): void {
    for (const chunk of this.chunks) {
      chunk.container.visible = aabbIntersects(vp, chunk);
    }
  }

  /**
   * Advance the water-surface animation to `timeTicks` (the interpolated sim clock, `tick + alpha` —
   * deterministic, so a `?shot` frame reproduces). One write + dirty bump on the map's shared uniform
   * group — every shaded mesh binds the same group, so the per-frame cost is O(1); a map with no
   * water-patterned cell is a no-op.
   */
  animate(timeTicks: number): void {
    if (!this.hasWater || this.waveGroup === undefined) return;
    // Wrapped modulo the waves' exact common period: identical phases, but the f32 uniform never
    // grows into `sin` precision loss over a long session.
    this.waveGroup.uniforms.uWave[0] = timeTicks % WAVE_TIME_PERIOD_TICKS;
    this.waveGroup.update();
  }

  /**
   * Free the current terrain: each chunk is a {@link Container} of {@link import('pixi.js').Mesh}es whose
   * GPU buffers + custom shader `Mesh.destroy` does not release, so {@link destroyMeshChildren} frees those
   * first, then the container + its children go. The tile textures/`Texture.WHITE` are shared sources and
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
    this.field = makeBrightnessField(undefined, 0, 0);
    this.waveGroup = undefined;
    this.hasWater = false;
  }
}
