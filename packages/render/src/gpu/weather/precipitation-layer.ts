import { Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import { frac } from '../../data/effects/random.js';
import {
  PRECIPITATION_TIME_SPLIT_SECONDS,
  PRECIPITATION_WIND_SPLIT_PX,
  type PrecipitationTravel,
  particleCapacity,
  splitCoarse,
  WEATHER_FULL_AMOUNT,
  WEATHER_INTENSITY_GAMMA,
} from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherKind } from '../../data/weather/types.js';
import type { WeatherFieldTextures } from './field-textures.js';
import { precipitationProgram, SAND_WISP_SHARE } from './precipitation-shader.js';
import type { WeatherReach } from './weather-reach.js';

/** Depth draws are skewed towards the far layer: most particles are small and faint, a few big and near. */
const DEPTH_SKEW = 1.6;
/** Instance seed streams per kind, so rain and snow never share a pattern. */
const KIND_SALT: Readonly<Record<WeatherKind, number>> = { rain: 0x1f3a7, snow: 0x5c2d9, sand: 0x7e61b };
const SEED_A_WIDTH = 4;
const SEED_B_WIDTH = 4;
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]);
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** The per-frame inputs every kind shares. */
export interface PrecipitationFrame {
  readonly screenW: number;
  readonly screenH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
  readonly gameSeconds: number;
  /** Carried by the sky across frames. */
  readonly travel: PrecipitationTravel;
  readonly windX: number;
  readonly windY: number;
  readonly storm: number;
  /** 0..1 gust strength on top of the steady wind. */
  readonly gust: number;
  readonly sizeScale: number;
}

type PrecipitationUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    uPhase: number;
    readonly uFallTravel: Float32Array;
    readonly uWindTravel: Float32Array;
    readonly uDriftTravel: Float32Array;
    readonly uWind: Float32Array;
    uStorm: number;
    uGust: number;
    readonly uField: Float32Array;
    readonly uChannel: Float32Array;
    readonly uIntensity: Float32Array;
    readonly uDraw: Float32Array;
  };
};

/** The shader compares the stored float32 draw with its float32 constant. */
const SAND_WISP_BELOW = Math.fround(SAND_WISP_SHARE);
const WISP_DRAW = SEED_B_WIDTH - 1;

/** Which of a kind's seeds a layer draws. Only sand splits: its wisps and dashes go to separate targets. */
export type PrecipitationPart = 'all' | 'wisps' | 'dashes';

export interface PrecipitationSeeds {
  readonly a: Float32Array;
  readonly b: Float32Array;
  /** Seeds held, in rank order. */
  readonly held: number;
  /** The held seeds' ranks, ascending; null when every rank is held. */
  readonly ranks: Uint32Array | null;
}

/** The seeds of `part` among the first `capacity` ranks of `kind`. A seed keeps its rank and its draws
 *  whichever part holds it, so a split kind draws the particles the whole buffer would. */
export function precipitationSeeds(
  kind: WeatherKind,
  capacity: number,
  part: PrecipitationPart,
): PrecipitationSeeds {
  const a = new Float32Array(capacity * SEED_A_WIDTH);
  const b = new Float32Array(capacity * SEED_B_WIDTH);
  const ranks = part === 'all' ? null : new Uint32Array(capacity);
  const salt = KIND_SALT[kind];
  let held = 0;
  for (let i = 0; i < capacity; i++) {
    const draw = (k: number): number => frac(salt, i * (SEED_A_WIDTH + SEED_B_WIDTH) + k);
    for (let k = 0; k < SEED_B_WIDTH; k++) b[held * SEED_B_WIDTH + k] = draw(SEED_A_WIDTH + k);
    if (ranks !== null) {
      const wisp = (b[held * SEED_B_WIDTH + WISP_DRAW] ?? 0) < SAND_WISP_BELOW;
      if (wisp !== (part === 'wisps')) continue;
      ranks[held] = i;
    }
    a[held * SEED_A_WIDTH] = draw(0);
    a[held * SEED_A_WIDTH + 1] = draw(1);
    a[held * SEED_A_WIDTH + 2] = draw(2) ** DEPTH_SKEW;
    a[held * SEED_A_WIDTH + 3] = i;
    held++;
  }
  if (ranks === null) return { a, b, held, ranks };
  return {
    a: a.slice(0, held * SEED_A_WIDTH),
    b: b.slice(0, held * SEED_B_WIDTH),
    held,
    ranks: ranks.slice(0, held),
  };
}

/** How many of `seeds` rank under `drawn`: the instances of a frame that draws the first `drawn` ranks. */
export function instancesUnder(seeds: PrecipitationSeeds, drawn: number): number {
  const ranks = seeds.ranks;
  if (ranks === null) return Math.min(drawn, seeds.held);
  let low = 0;
  let high = seeds.held;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((ranks[mid] ?? 0) < drawn) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Writes `x` and `y` split on `step` into `out` as coarse x, coarse y, fine x, fine y. */
function writeSplitPair(out: Float32Array, x: number, y: number, step: number): void {
  const coarseX = splitCoarse(x, step);
  const coarseY = splitCoarse(y, step);
  out[0] = coarseX;
  out[1] = coarseY;
  out[2] = x - coarseX;
  out[3] = y - coarseY;
}

/**
 * One kind's particles: a static instanced quad buffer with random seeds, drawn as a prefix whose size
 * follows the screen area and the strongest amount on screen. Per frame the CPU writes uniforms and the
 * instance count only.
 */
export class PrecipitationLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly uniforms: PrecipitationUniforms;
  private readonly shader: Shader;
  private capacity = 0;
  private seeds: PrecipitationSeeds;

  constructor(
    private readonly kind: WeatherKind,
    private readonly field: WeatherFieldTextures,
    private readonly reach: WeatherReach,
    private readonly part: PrecipitationPart = 'all',
  ) {
    const channel = new Float32Array(WEATHER_KINDS.length);
    channel[WEATHER_KINDS.indexOf(kind)] = 1;
    this.uniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uPhase: { value: 0, type: 'f32' },
      uFallTravel: { value: new Float32Array(2), type: 'vec2<f32>' },
      uWindTravel: { value: new Float32Array(4), type: 'vec4<f32>' },
      uDriftTravel: { value: new Float32Array(4), type: 'vec4<f32>' },
      uWind: { value: new Float32Array(2), type: 'vec2<f32>' },
      uStorm: { value: 0, type: 'f32' },
      uGust: { value: 0, type: 'f32' },
      uField: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
      uChannel: { value: channel, type: 'vec3<f32>' },
      uIntensity: {
        value: new Float32Array([1 / WEATHER_FULL_AMOUNT[kind], WEATHER_INTENSITY_GAMMA]),
        type: 'vec2<f32>',
      },
      uDraw: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
    }) as PrecipitationUniforms;
    this.shader = new Shader({
      glProgram: precipitationProgram(kind),
      resources: {
        weather: this.uniforms,
        uFieldPrev: field.previousSource,
        uFieldCur: field.currentSource,
        weatherReach: reach.uniforms,
        uReachFog: reach.fogSource,
      },
    });
    this.seeds = precipitationSeeds(kind, 0, part);
    this.mesh = new Mesh({ geometry: this.makeGeometry(0), shader: this.shader });
    this.mesh.visible = false;
  }

  /** Draw `count` particles this frame for the strongest on-screen `intensity`; 0 hides the layer. */
  update(frame: PrecipitationFrame, count: number, intensity: number): void {
    if (count <= 0 || intensity <= 0) {
      this.mesh.visible = false;
      return;
    }
    this.ensureCapacity(particleCapacity(this.kind, frame.screenW, frame.screenH));
    const drawn = Math.min(count, this.capacity);
    const u = this.uniforms.uniforms;
    u.uScreen[0] = frame.screenW;
    u.uScreen[1] = frame.screenH;
    u.uCamera[0] = frame.offsetX;
    u.uCamera[1] = frame.offsetY;
    u.uCamera[2] = frame.zoom;
    const seconds = frame.gameSeconds;
    u.uPhase =
      (seconds - splitCoarse(seconds, PRECIPITATION_TIME_SPLIT_SECONDS)) / PRECIPITATION_TIME_SPLIT_SECONDS;
    const travel = frame.travel;
    const coarseFall = splitCoarse(travel.fall, PRECIPITATION_TIME_SPLIT_SECONDS);
    u.uFallTravel[0] = coarseFall;
    u.uFallTravel[1] = travel.fall - coarseFall;
    writeSplitPair(u.uWindTravel, travel.windX, travel.windY, PRECIPITATION_WIND_SPLIT_PX);
    writeSplitPair(u.uDriftTravel, travel.scaledWindX, travel.scaledWindY, PRECIPITATION_WIND_SPLIT_PX);
    u.uWind[0] = frame.windX;
    u.uWind[1] = frame.windY;
    u.uStorm = frame.storm;
    u.uGust = frame.gust;
    u.uField[0] = this.field.nodeSpanX;
    u.uField[1] = this.field.nodeSpanY;
    u.uField[2] = this.field.mix;
    u.uDraw[0] = drawn;
    u.uDraw[1] = intensity;
    u.uDraw[2] = frame.sizeScale;
    this.uniforms.update();
    const instances = instancesUnder(this.seeds, drawn);
    this.mesh.geometry.instanceCount = instances;
    this.mesh.visible = instances > 0;
  }

  /** Re-bind the field's sources after it replaced them. */
  bindField(): void {
    this.shader.resources.uFieldPrev = this.field.previousSource;
    this.shader.resources.uFieldCur = this.field.currentSource;
  }

  /** Re-bind the fog texture after the reach replaced it. */
  bindReach(): void {
    this.shader.resources.uReachFog = this.reach.fogSource;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  destroy(): void {
    this.mesh.geometry.destroy(true);
    this.shader.destroy();
    this.mesh.destroy();
  }

  private ensureCapacity(capacity: number): void {
    if (capacity <= this.capacity) return;
    const old = this.mesh.geometry;
    this.mesh.geometry = this.makeGeometry(capacity);
    old.destroy(true);
  }

  private makeGeometry(capacity: number): Geometry {
    this.capacity = capacity;
    const seeds = precipitationSeeds(this.kind, capacity, this.part);
    this.seeds = seeds;
    // A buffer of no seeds still needs one instance's bytes.
    const padded = (data: Float32Array, width: number): Float32Array =>
      data.length > 0 ? data : new Float32Array(width);
    return new Geometry({
      attributes: {
        aPosition: { buffer: QUAD_CORNERS, format: 'float32x2' },
        aSeedA: { buffer: padded(seeds.a, SEED_A_WIDTH), format: 'float32x4', instance: true },
        aSeedB: { buffer: padded(seeds.b, SEED_B_WIDTH), format: 'float32x4', instance: true },
      },
      indexBuffer: QUAD_INDICES,
      instanceCount: 0,
    });
  }
}
