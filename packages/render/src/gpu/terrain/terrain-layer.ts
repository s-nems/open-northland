import { BufferImageSource, Container, Mesh } from 'pixi.js';
import { aabbIntersects, type Viewport } from '../../data/projection/index.js';
import type { RoadChanges, SceneTerrain } from '../../data/scene/index.js';
import {
  type BrightnessField,
  composeShadingLane,
  type ElevationField,
  makeBrightnessField,
  makeElevationField,
  makeWaterField,
  NO_WATER,
  type WaterField,
} from '../../data/terrain/index.js';
import { WEATHER_SECTOR_NODES } from '../../data/weather/field.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import { makeWaveUniforms, WAVE_TIME_PERIOD_TICKS, type WaveUniforms } from '../shading.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import {
  type GroundCoverUniforms,
  makeGroundCoverTexture,
  makeGroundCoverUniforms,
} from '../weather/ground-cover-shading.js';
import { buildFlat } from './build-flat.js';
import { buildTextured } from './build-ground.js';
import {
  DEFAULT_TILE_COLOUR,
  dominantGroundColour,
  type LaneShading,
  liftFn,
  type TerrainChunk,
} from './geometry.js';
import { padLaneRows } from './lane-texture.js';
import { RoadLayer } from './road-layer.js';
import { TerrainVertexColors } from './vertex-colors.js';

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
  private readonly vertexColors = new TerrainVertexColors();
  /** The grass default until a map is loaded. */
  private ground = DEFAULT_TILE_COLOUR;
  private brightnessTex: BufferImageSource | undefined;
  private laneTexWidth = 0;
  private field: BrightnessField = makeBrightnessField(undefined, 0, 0);
  /** The map's single shared water-animation uniform group, bound into every shaded mesh, so
   *  {@link animate} is one write per frame rather than one per chunk. */
  private waveGroup: WaveUniforms | undefined;
  private hasWater = false;
  private terrainHeight = 0;
  private water: WaterField = NO_WATER;
  private enhancedWater = false;
  private enhancedSampling = false;
  private roads: RoadLayer | null = null;
  /** Every road node given, kept so a rebuilt map redraws it. */
  private readonly roadNodes = new Set<number>();
  /** The map's weather-cover grid and switch, bound into every shaded mesh; off until
   *  {@link setWeatherCover} hands it a grid. */
  private coverUniforms: GroundCoverUniforms = makeGroundCoverUniforms();
  private coverTex: BufferImageSource = makeGroundCoverTexture(1, 1);

  setEnhancedSampling(enabled: boolean): void {
    this.enhancedSampling = enabled;
    if (this.waveGroup === undefined) return;
    this.waveGroup.uniforms.uEnhancedSampling = enabled ? 1 : 0;
    this.waveGroup.update();
  }

  setEnhancedWater(enabled: boolean): void {
    this.enhancedWater = enabled;
    if (this.waveGroup === undefined) return;
    this.waveGroup.uniforms.uEnhancedWater = enabled ? 1 : 0;
    this.waveGroup.update();
  }

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
    const water = makeWaterField(terrain.ground, terrain.width, terrain.height);
    this.water = water;
    this.hasWater = water !== NO_WATER && this.brightnessTex !== undefined;
    this.waveGroup = makeWaveUniforms();
    this.waveGroup.uniforms.uEnhancedSampling = this.enhancedSampling ? 1 : 0;
    this.waveGroup.uniforms.uEnhancedWater = this.enhancedWater ? 1 : 0;
    this.coverUniforms = makeGroundCoverUniforms();
    this.coverTex = makeGroundCoverTexture(1, 1);
    this.terrainHeight = terrain.height;
    const lane: LaneShading = {
      brightnessTex: this.brightnessTex,
      laneTexWidth: this.laneTexWidth,
      water,
      waveUniforms: this.waveGroup,
      cover: { texture: this.coverTex, uniforms: this.coverUniforms },
    };
    this.chunks =
      textures !== undefined
        ? buildTextured(this.container, terrain, textures, elevation, brightness, lane)
        : buildFlat(this.container, terrain, elevation, brightness);
    this.vertexColors.bind(
      this.chunks.flatMap((chunk) =>
        chunk.container.children.flatMap((child) => (child instanceof Mesh ? [child.geometry] : [])),
      ),
      2 * terrain.width,
      2 * terrain.height,
    );
    if (textures !== undefined) {
      this.roads = RoadLayer.create(
        terrain,
        textures,
        liftFn(terrain, elevation),
        lane,
        this.chunks,
        this.roadNodes,
      );
    }
  }

  /** Take the road nodes (half-cell row-major ids) laid and lifted; the next {@link cull} re-meshes the
   *  changed blocks it shows. */
  updateRoads(changes: RoadChanges): void {
    for (const id of changes.removed) this.roadNodes.delete(id);
    for (const id of changes.added) this.roadNodes.add(id);
    this.roads?.apply(changes);
  }

  /**
   * The weather cover over the shaded ground: `texels` is a `sectorsX` by `sectorsY` RGBA grid of
   * weather sectors (r wet, g snow, b dust, a rain falling), the map's half-cell nodes split like the weather field.
   * `null` switches the cover off, which draws the ground exactly as without it. The unshaded
   * placeholder ground takes no cover.
   */
  setWeatherCover(texels: Uint8Array | null, sectorsX: number, sectorsY: number): void {
    const uniforms = this.coverUniforms.uniforms;
    if (texels === null || this.laneTexWidth === 0 || texels.length !== sectorsX * sectorsY * 4) {
      if (uniforms.uCover !== 0) {
        uniforms.uCover = 0;
        this.coverUniforms.update();
      }
      return;
    }
    if (this.coverTex.width !== sectorsX || this.coverTex.height !== sectorsY)
      this.rebindCover(sectorsX, sectorsY);
    const data = this.coverTex.resource as Uint8Array;
    data.set(texels);
    this.coverTex.update();
    // Brightness-lane UV to cover UV: the lane texel centres on its cell, the cell on node
    // (2c + 1/2 on average over the row stagger, 2r), and a cover texel on its sector's centre node.
    const spanX = sectorsX * WEATHER_SECTOR_NODES;
    const spanY = sectorsY * WEATHER_SECTOR_NODES;
    uniforms.uCoverMap.set([
      (2 * this.laneTexWidth) / spanX,
      (2 * this.terrainHeight) / spanY,
      -0.5 / spanX,
      -1 / spanY,
    ]);
    uniforms.uCover = 1;
    this.coverUniforms.update();
  }

  /** The puddles' rain rings run on this clock; a dry frame after a dry frame writes nothing. */
  setWeatherCoverClock(gameSeconds: number, rainFalling: number): void {
    const clock = this.coverUniforms.uniforms.uCoverClock;
    if (rainFalling === 0 && clock[1] === 0) return;
    clock[0] = gameSeconds;
    clock[1] = rainFalling;
    this.coverUniforms.update();
  }

  private rebindCover(sectorsX: number, sectorsY: number): void {
    const previous = this.coverTex;
    this.coverTex = makeGroundCoverTexture(sectorsX, sectorsY);
    for (const chunk of this.chunks) {
      for (const child of chunk.container.children) {
        if (child instanceof Mesh && child.shader?.resources.uCoverTex !== undefined) {
          child.shader.resources.uCoverTex = this.coverTex;
        }
      }
    }
    previous.destroy();
  }

  /** RGB multipliers per half-cell node id, 3 per node; only the nodes that changed are rewritten. */
  applyVertexColors(colors: Float32Array): void {
    this.vertexColors.apply(colors);
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
    this.roads?.meshVisible();
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
    this.roads?.destroy();
    this.roads = null;
    this.vertexColors.clear();
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
    this.water = NO_WATER;
    this.coverTex.destroy();
    this.terrainHeight = 0;
  }

  /** The current map's water mask; {@link NO_WATER} on a map whose ground paints none. */
  waterField(): WaterField {
    return this.water;
  }
}
