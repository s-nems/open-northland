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
import { type SectorSpan, sectorSpanOf, WEATHER_SECTOR_NODES } from '../../data/weather/field.js';
import { destroyMeshChildren } from '../mesh-teardown.js';
import {
  type GroundCoverUniforms,
  makeGroundCoverTexture,
  makeGroundCoverUniforms,
} from '../weather/ground-cover-shading.js';
import { buildFlat } from './build-flat.js';
import { buildTextured } from './build-ground.js';
import { rebindCoverTexture } from './chunk-batcher.js';
import {
  DEFAULT_TILE_COLOUR,
  dominantGroundColour,
  type LaneShading,
  liftFn,
  type TerrainChunk,
} from './geometry.js';
import { padLaneRows } from './lane-texture.js';
import { RoadLayer } from './road-layer.js';
import { makeWaveUniforms, type WaveUniforms } from './shading.js';
import type { TerrainTextureSet } from './textures.js';
import { TerrainVertexColors } from './vertex-colors.js';
import { WAVE_LOOP_SECONDS } from './water-shading.js';

/**
 * The retained terrain layer: the static ground, meshed once per map into world-space AABB blocks and
 * drawn per visible block, so render cost tracks the screen rather than the map.
 */

/** The shared default for the elevation-free path (synthetic grids / no lane). */
const FLAT_ELEVATION: ElevationField = makeElevationField(undefined, 0, 0);

/** WebGL's default UNPACK_ALIGNMENT, in R8 texels (1 byte each). */
const ROW_ALIGN = 4;
/** Cover texels are RGBA bytes: wet, snow and dust, then rain falling, which shades nothing alone. */
const COVER_TEXEL_BYTES = 4;
const COVER_SHADING_CHANNELS = 3;

export class TerrainLayer {
  /** Its own Pixi render group: a block shown or hidden by {@link cull}, on a pan or for each portrait
   *  inset's re-cull, rebuilds this short list of block meshes instead of the whole world's. */
  readonly container = new Container({ isRenderGroup: true });
  readonly roadContainer = new Container({ isRenderGroup: true });
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
  /** Half-cell nodes per row, the stride of the road node ids. */
  private nodeWidth = 0;
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
  /** True while a cover grid is set; the switch is on only while one of its covered sectors can reach
   *  the culled view, since bare cover draws the ground exactly as no cover does. */
  private coverSet = false;
  /** Per sector, 1 where the cover shades the ground (wet, snow or dust above zero). */
  private coverShading = new Uint8Array(0);
  private coverSectorsX = 0;
  private coverSectorsY = 0;
  private culled: Viewport | null = null;
  private readonly coverSpan: SectorSpan = { x0: 0, x1: 0, y0: 0, y1: 0 };

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
    this.nodeWidth = 2 * terrain.width;
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
        this.roadContainer,
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
    if (
      texels === null ||
      this.laneTexWidth === 0 ||
      texels.length !== sectorsX * sectorsY * COVER_TEXEL_BYTES
    ) {
      this.coverSet = false;
      this.switchCover();
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
    this.coverUniforms.update();
    this.markShadingSectors(texels, sectorsX, sectorsY);
    this.coverSet = true;
    this.switchCover();
  }

  private markShadingSectors(texels: Uint8Array, sectorsX: number, sectorsY: number): void {
    const count = sectorsX * sectorsY;
    if (this.coverShading.length !== count) this.coverShading = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      let shading = 0;
      for (let c = 0; c < COVER_SHADING_CHANNELS; c++) shading |= texels[i * COVER_TEXEL_BYTES + c] ?? 0;
      this.coverShading[i] = shading > 0 ? 1 : 0;
    }
    this.coverSectorsX = sectorsX;
    this.coverSectorsY = sectorsY;
  }

  /** Whether a shading sector's bilinear reach touches the culled view; before any cull, any sector. */
  private coverReachesView(): boolean {
    const vp = this.culled;
    if (vp === null) return this.coverShading.includes(1);
    const { x0, x1, y0, y1 } = sectorSpanOf(vp, this.coverSectorsX, this.coverSectorsY, this.coverSpan);
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++)
        if (this.coverShading[sy * this.coverSectorsX + sx] === 1) return true;
    }
    return false;
  }

  private switchCover(): void {
    const uniforms = this.coverUniforms.uniforms;
    const on = this.coverSet && this.coverReachesView() ? 1 : 0;
    if (uniforms.uCover === on) return;
    uniforms.uCover = on;
    this.coverUniforms.update();
  }

  /** The puddles' rain rings run on this clock; a dry frame after a dry frame, or a paused frame,
   *  writes nothing. */
  setWeatherCoverClock(gameSeconds: number, rainFalling: number): void {
    const clock = this.coverUniforms.uniforms.uCoverClock;
    if (rainFalling === 0 && clock[1] === 0) return;
    if (clock[0] === Math.fround(gameSeconds) && clock[1] === Math.fround(rainFalling)) return;
    clock[0] = gameSeconds;
    clock[1] = rainFalling;
    this.coverUniforms.update();
  }

  private rebindCover(sectorsX: number, sectorsY: number): void {
    const previous = this.coverTex;
    this.coverTex = makeGroundCoverTexture(sectorsX, sectorsY);
    for (const chunk of this.chunks) rebindCoverTexture(chunk.container, this.coverTex);
    this.roads?.rebindCover({ texture: this.coverTex, uniforms: this.coverUniforms });
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

  /** A bounded minimum zoom keeps the visible-block count small even fully zoomed out. A repeat of
   *  the last cull's box only re-meshes the road blocks laid since, as every block shows as it did. */
  cull(vp: Viewport): void {
    const last = this.culled;
    if (
      last !== null &&
      last.minX === vp.minX &&
      last.minY === vp.minY &&
      last.maxX === vp.maxX &&
      last.maxY === vp.maxY
    ) {
      this.roads?.meshVisible();
      return;
    }
    for (const chunk of this.chunks) {
      chunk.container.visible = aabbIntersects(vp, chunk);
      this.roads?.cullChunk(chunk);
    }
    this.roads?.meshVisible();
    this.culled = vp;
    this.switchCover();
  }

  /**
   * Advance the water-surface animation to `waterSeconds`, the water clock's time. Every shaded mesh
   * binds the same uniform group, so the per-frame cost is one write regardless of chunk count; a map
   * with no water-patterned cell is a no-op.
   */
  animate(waterSeconds: number): void {
    if (!this.hasWater || this.waveGroup === undefined) return;
    this.waveGroup.uniforms.uWave[0] = waterSeconds % WAVE_LOOP_SECONDS;
    this.waveGroup.update();
  }

  destroy(): void {
    this.culled = null;
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
    this.coverSet = false;
    this.terrainHeight = 0;
    this.nodeWidth = 0;
  }

  /** The current map's water mask; {@link NO_WATER} on a map whose ground paints none. */
  waterField(): WaterField {
    return this.water;
  }

  /** Whether a road runs over node `(hx, hy)`. */
  roadAt = (hx: number, hy: number): boolean =>
    hx >= 0 && hx < this.nodeWidth && this.roadNodes.has(hy * this.nodeWidth + hx);
}
