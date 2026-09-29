import { Geometry, Mesh, Shader, UniformGroup } from 'pixi.js';
import { frac } from '../../data/effects/blood.js';
import {
  particleCapacity,
  WEATHER_FULL_AMOUNT,
  WEATHER_INTENSITY_GAMMA,
} from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherKind } from '../../data/weather/types.js';
import type { WeatherFieldTextures } from './field-textures.js';
import {
  PRECIPITATION_TIME_SPLIT_SECONDS,
  PRECIPITATION_WIND_SPLIT_PX,
  precipitationProgram,
} from './precipitation-shader.js';

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
  /** Integrated wind in px, carried by the sky across frames. */
  readonly windTravelX: number;
  readonly windTravelY: number;
  readonly windX: number;
  readonly windY: number;
  readonly storm: number;
  readonly sizeScale: number;
}

type PrecipitationUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    readonly uTime: Float32Array;
    readonly uWindTravel: Float32Array;
    readonly uWind: Float32Array;
    uStorm: number;
    readonly uField: Float32Array;
    readonly uChannel: Float32Array;
    readonly uIntensity: Float32Array;
    readonly uDraw: Float32Array;
  };
};

function seedBuffers(kind: WeatherKind, capacity: number): { a: Float32Array; b: Float32Array } {
  const a = new Float32Array(capacity * SEED_A_WIDTH);
  const b = new Float32Array(capacity * SEED_B_WIDTH);
  const salt = KIND_SALT[kind];
  for (let i = 0; i < capacity; i++) {
    const draw = (k: number): number => frac(salt, i * (SEED_A_WIDTH + SEED_B_WIDTH) + k);
    a[i * SEED_A_WIDTH] = draw(0);
    a[i * SEED_A_WIDTH + 1] = draw(1);
    a[i * SEED_A_WIDTH + 2] = draw(2) ** DEPTH_SKEW;
    a[i * SEED_A_WIDTH + 3] = i;
    for (let k = 0; k < SEED_B_WIDTH; k++) b[i * SEED_B_WIDTH + k] = draw(SEED_A_WIDTH + k);
  }
  return { a, b };
}

/** Split a value into a coarse whole number of `step`s and the fine rest, for float32 precision. */
function splitCoarse(value: number, step: number): number {
  return Math.floor(value / step) * step;
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

  constructor(
    private readonly kind: WeatherKind,
    private readonly field: WeatherFieldTextures,
  ) {
    const channel = new Float32Array(WEATHER_KINDS.length);
    channel[WEATHER_KINDS.indexOf(kind)] = 1;
    this.uniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uTime: { value: new Float32Array(2), type: 'vec2<f32>' },
      uWindTravel: { value: new Float32Array(4), type: 'vec4<f32>' },
      uWind: { value: new Float32Array(2), type: 'vec2<f32>' },
      uStorm: { value: 0, type: 'f32' },
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
      },
    });
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
    u.uScreen.set([frame.screenW, frame.screenH]);
    u.uCamera.set([frame.offsetX, frame.offsetY, frame.zoom]);
    const coarseTime = splitCoarse(frame.gameSeconds, PRECIPITATION_TIME_SPLIT_SECONDS);
    u.uTime.set([coarseTime, frame.gameSeconds - coarseTime]);
    const coarseX = splitCoarse(frame.windTravelX, PRECIPITATION_WIND_SPLIT_PX);
    const coarseY = splitCoarse(frame.windTravelY, PRECIPITATION_WIND_SPLIT_PX);
    u.uWindTravel.set([coarseX, coarseY, frame.windTravelX - coarseX, frame.windTravelY - coarseY]);
    u.uWind.set([frame.windX, frame.windY]);
    u.uStorm = frame.storm;
    u.uField.set([this.field.nodeSpanX, this.field.nodeSpanY, this.field.mix]);
    u.uDraw.set([drawn, intensity, frame.sizeScale]);
    this.uniforms.update();
    this.mesh.geometry.instanceCount = drawn;
    this.mesh.visible = true;
  }

  /** Re-bind the field's sources after it replaced them. */
  bindField(): void {
    this.shader.resources.uFieldPrev = this.field.previousSource;
    this.shader.resources.uFieldCur = this.field.currentSource;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  destroy(): void {
    this.mesh.geometry.destroy();
    this.shader.destroy();
    this.mesh.destroy();
  }

  private ensureCapacity(capacity: number): void {
    if (capacity <= this.capacity) return;
    const old = this.mesh.geometry;
    this.mesh.geometry = this.makeGeometry(capacity);
    old.destroy();
  }

  private makeGeometry(capacity: number): Geometry {
    this.capacity = capacity;
    const seeds = seedBuffers(this.kind, Math.max(1, capacity));
    return new Geometry({
      attributes: {
        aPosition: { buffer: QUAD_CORNERS, format: 'float32x2' },
        aSeedA: { buffer: seeds.a, format: 'float32x4', instance: true },
        aSeedB: { buffer: seeds.b, format: 'float32x4', instance: true },
      },
      indexBuffer: QUAD_INDICES,
      instanceCount: 0,
    });
  }
}
