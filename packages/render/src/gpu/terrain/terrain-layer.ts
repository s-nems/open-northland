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
import { makeWaveUniforms, WAVE_TIME_PERIOD_TICKS, type WaveUniforms } from '../shading.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { buildFlat } from './build-flat.js';
import { buildTextured } from './build-ground.js';
import {
  DEFAULT_TILE_COLOUR,
  dominantGroundColour,
  type LaneShading,
  type TerrainChunk,
} from './geometry.js';
import { padLaneRows } from './lane-texture.js';

/**
 * The retained terrain layer: the static ground, meshed once per map into world-space AABB blocks and
 * drawn per visible block, so render cost tracks the screen rather than the map.
 */

/** The shared default for the elevation-free path (synthetic grids / no lane). */
const FLAT_ELEVATION: ElevationField = makeElevationField(undefined, 0, 0);

/** WebGL's default UNPACK_ALIGNMENT, in R8 texels (1 byte each). */
const ROW_ALIGN = 4;

export class TerrainLayer {
  readonly container = new Container();
  private chunks: TerrainChunk[] = [];
  /** The grass default until a map is loaded. */
  private ground = DEFAULT_TILE_COLOUR;
  private brightnessTex: BufferImageSource | undefined;
  private laneTexWidth = 0;
  private field: BrightnessField = makeBrightnessField(undefined, 0, 0);
  /** The map's single shared water-animation uniform group, bound into every shaded mesh, so
   *  {@link animate} is one write per frame rather than one per chunk. */
  private waveGroup: WaveUniforms | undefined;
  private hasWater = false;

  /**
   * (Re)build the cached terrain from a grid - call once per map, since a terrain edit re-invalidates
   * it. With `textures` the draw-call count is about one per texture page per draw layer per visible
   * block; without them it draws the flat placeholder triangles.
   */
  set(terrain: SceneTerrain, textures?: TerrainTextureSet, elevation: ElevationField = FLAT_ELEVATION): void {
    this.destroy();
    this.ground = dominantGroundColour(terrain.typeIds);
    // One source for the shading: the CPU field and the R8 lane texture are both built from the
    // composed lane here, so no caller can hand the mesh and the fallbacks disagreeing inputs.
    const shadingLane = composeShadingLane(
      terrain.brightness,
      terrain.elevation,
      terrain.width,
      terrain.height,
    );
    const brightness = makeBrightnessField(shadingLane, terrain.width, terrain.height);
    this.field = brightness;
    if (brightness.shaded && shadingLane !== undefined && textures !== undefined) {
      const lane = padLaneRows(shadingLane, terrain.width, terrain.height, ROW_ALIGN);
      this.laneTexWidth = lane.paddedWidth;
      this.brightnessTex = new BufferImageSource({
        resource: lane.data,
        width: lane.paddedWidth,
        height: terrain.height,
        format: 'r8unorm',
        // Bilinear + edge clamp mirrors the CPU sampler and is a contract, not an inherited default:
        // other sources in this codebase are flipped to 'nearest' for pixel art.
        scaleMode: 'linear',
        addressMode: 'clamp-to-edge',
      });
    }
    // Water-wave amplitudes ride the shaded mesh path only, so a water map without a shading lane
    // draws stock meshes and stays still. The animate() gate needs both, not just the wave field.
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

  /** The flat tint of the map's most-common ground typeId (grass until a map is {@link set}) - the
   *  opaque backdrop the details-panel portrait inset clears to. */
  groundColour(): number {
    return this.ground;
  }

  /** Neutral until a shaded map is set. */
  brightnessField(): BrightnessField {
    return this.field;
  }

  /** A bounded minimum zoom keeps the visible-block count small even fully zoomed out. */
  cull(vp: Viewport): void {
    for (const chunk of this.chunks) {
      chunk.container.visible = aabbIntersects(vp, chunk);
    }
  }

  /**
   * Advance the water-surface animation to `timeTicks`, the interpolated sim clock `tick + alpha`.
   * Every shaded mesh binds the same uniform group, so the per-frame cost is one write regardless of
   * chunk count; a map with no water-patterned cell is a no-op.
   */
  animate(timeTicks: number): void {
    if (!this.hasWater || this.waveGroup === undefined) return;
    this.waveGroup.uniforms.uWave[0] = timeTicks % WAVE_TIME_PERIOD_TICKS;
    this.waveGroup.update();
  }

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
