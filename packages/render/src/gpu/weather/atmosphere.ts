import { type Container, Geometry, GlProgram, Mesh, Shader, UniformGroup } from 'pixi.js';
import type { AtmosphereLook } from './atmosphere-look.js';

/**
 * The air over the world: a multiply quad (grade, drifting cloud shadows, storm vignette) under a
 * premultiplied veil quad (haze with moving mist banks, plus the lightning flash added on top). Screen
 * quads above the world layer, never a `Filter` on it. The noise is world-anchored and drifts with the
 * wind; its alpha is quantized with an ordered dither in 2 px blocks so the veil never bands. Constants are tuned by eye.
 */

const VERTEX = `#version 300 es
  in vec2 aPosition;
  out vec2 vScreen;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  uniform vec2 uScreen;
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vScreen = aPosition * uScreen;
  }
`;

/** The noise tiles every this many lattice cells, so the wrapped drift offset is seamless. */
export const ATMOSPHERE_NOISE_PERIOD = 256;
/** World px per noise lattice cell for the cloud shadows and the mist. */
export const CLOUD_SCALE_PX = 520;
export const MIST_SCALE_PX = 230;
/** Mist banks lie longer than tall, as seen at the isometric slant. */
const MIST_STRETCH_X = 2;
/** Streaks of blowing dust or snow: long thin noise cells, world px. */
const STREAK_CELL_PX = [520, 110] as const;
/** The flash lights the whole screen by this share and the rest around the strike, within this share of
 *  the screen's larger side, so a strike off one edge lights that side. */
const FLASH_FLOOR = 0.35;
const FLASH_REACH_SHARE = 0.8;

const NOISE = `
  const float PERIOD = ${ATMOSPHERE_NOISE_PERIOD}.0;
  float hash(vec2 cell) {
    cell = mod(cell, PERIOD);
    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Octaves double the frequency, which keeps the period whole.
  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.0 + vec2(17.0, 31.0);
      amp *= 0.5;
    }
    return sum / 0.9375;
  }
  // 4x4 ordered dither threshold for a 2 px block.
  float bayer(vec2 screen) {
    ivec2 b = ivec2(mod(floor(screen / 2.0), 4.0));
    int index = b.x + b.y * 4;
    int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    return (float(m[index]) + 0.5) / 16.0;
  }
`;

const GRADE_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vScreen;
  out vec4 finalColor;
  uniform vec2 uScreen;
  uniform vec3 uCamera;
  // Drift in noise lattice cells, wrapped on the period.
  uniform vec2 uCloudDrift;
  uniform vec3 uGrade;
  // Cloud shadow depth, vignette strength.
  uniform vec2 uShade;
  ${NOISE}
  const float CLOUD_SCALE = ${CLOUD_SCALE_PX}.0;
  void main(void) {
    vec2 world = (vScreen - uCamera.xy) / uCamera.z;
    float clouds = fbm(world / CLOUD_SCALE + uCloudDrift);
    float shade = 1.0 - uShade.x * smoothstep(0.42, 0.72, clouds);
    vec2 centred = (vScreen / uScreen - 0.5) * vec2(uScreen.x / uScreen.y, 1.0);
    float vignette = 1.0 - uShade.y * smoothstep(0.35, 1.0, length(centred));
    finalColor = vec4(uGrade * shade * vignette, 1.0);
  }
`;

const VEIL_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vScreen;
  out vec4 finalColor;
  uniform vec2 uScreen;
  uniform vec3 uCamera;
  // Mist and streak drift in their noise lattice cells, wrapped on the period.
  uniform vec4 uDrift;
  uniform vec4 uHaze;
  // Mist unevenness, streak share (blowing dust or snow).
  uniform vec2 uMist;
  uniform vec3 uFlash;
  // Where the flash is brightest (screen px) and its reach (px).
  uniform vec3 uFlashAt;
  ${NOISE}
  const float FLASH_FLOOR = ${FLASH_FLOOR};
  const vec2 MIST_CELL = vec2(${MIST_SCALE_PX * MIST_STRETCH_X}.0, ${MIST_SCALE_PX}.0);
  const vec2 STREAK_CELL = vec2(${STREAK_CELL_PX[0]}.0, ${STREAK_CELL_PX[1]}.0);
  // Veil alpha posterization steps; the dither between them stays below what reads as a pattern.
  const float STEPS = 64.0;
  void main(void) {
    vec2 world = (vScreen - uCamera.xy) / uCamera.z;
    vec2 p = world / MIST_CELL + uDrift.xy;
    float banks = fbm(p);
    float wisps = fbm(p * 2.0 + vec2(banks * 1.5, 0.0));
    float mist = mix(banks, wisps, 0.4);
    // Streaks only show inside the banks, so they break up instead of banding the screen.
    float streaks = fbm(world / STREAK_CELL + uDrift.zw) * smoothstep(0.25, 0.7, banks);
    mist = mix(mist, 0.5 + 1.2 * (streaks - 0.3), uMist.y);
    float a = uHaze.a * clamp(1.0 - uMist.x + 2.0 * uMist.x * mist, 0.0, 1.0);
    a = clamp(floor(a * STEPS + bayer(vScreen)) / STEPS, 0.0, 1.0);
    vec2 fromStrike = (vScreen - uFlashAt.xy) / uFlashAt.z;
    float lit = FLASH_FLOOR + (1.0 - FLASH_FLOOR) * exp(-dot(fromStrike, fromStrike));
    finalColor = vec4(uHaze.rgb * a + uFlash * lit, a);
  }
`;

type GradeUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    readonly uCloudDrift: Float32Array;
    readonly uGrade: Float32Array;
    readonly uShade: Float32Array;
  };
};

type VeilUniforms = UniformGroup & {
  readonly uniforms: {
    readonly uScreen: Float32Array;
    readonly uCamera: Float32Array;
    readonly uDrift: Float32Array;
    readonly uHaze: Float32Array;
    readonly uMist: Float32Array;
    readonly uFlash: Float32Array;
    readonly uFlashAt: Float32Array;
  };
};

let gradeProgram: GlProgram | undefined;
let veilProgram: GlProgram | undefined;

/** A unit quad the mesh scales to the screen. */
function screenQuad(): Geometry {
  return new Geometry({
    attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

/** Share of the wind travel the cloud shadows and the mist drift by: clouds are high and slower. */
const CLOUD_DRIFT_SHARE = 0.45;
const MIST_DRIFT_SHARE = 0.8;
/** Streaks race along at the full wind. */
const STREAK_DRIFT_SHARE = 1.2;

export interface AtmosphereFrame {
  readonly screenW: number;
  readonly screenH: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
  readonly windTravelX: number;
  readonly windTravelY: number;
  readonly windX: number;
  readonly windY: number;
  /** Screen fraction of the lightning strike that lights the flash; off screen for a distant one. */
  readonly flashX: number;
  readonly flashY: number;
}

/** A world-px drift as noise lattice cells, wrapped on the noise period so float32 keeps it precise and
 *  the wrap is seamless. */
const latticeDrift = (travel: number, share: number, cellPx: number): number => {
  const cells = (-travel * share) / cellPx;
  return ((cells % ATMOSPHERE_NOISE_PERIOD) + ATMOSPHERE_NOISE_PERIOD) % ATMOSPHERE_NOISE_PERIOD;
};

export class WeatherAtmosphere {
  readonly grade: Mesh<Geometry, Shader>;
  readonly veil: Mesh<Geometry, Shader>;
  private readonly gradeUniforms: GradeUniforms;
  private readonly veilUniforms: VeilUniforms;

  constructor(parent: Container) {
    this.gradeUniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uCloudDrift: { value: new Float32Array(2), type: 'vec2<f32>' },
      uGrade: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
      uShade: { value: new Float32Array(2), type: 'vec2<f32>' },
    }) as GradeUniforms;
    this.veilUniforms = new UniformGroup({
      uScreen: { value: new Float32Array(2), type: 'vec2<f32>' },
      uCamera: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
      uDrift: { value: new Float32Array(4), type: 'vec4<f32>' },
      uHaze: { value: new Float32Array(4), type: 'vec4<f32>' },
      uMist: { value: new Float32Array(2), type: 'vec2<f32>' },
      uFlash: { value: new Float32Array(3), type: 'vec3<f32>' },
      uFlashAt: { value: new Float32Array([0, 0, 1]), type: 'vec3<f32>' },
    }) as VeilUniforms;
    gradeProgram ??= new GlProgram({ vertex: VERTEX, fragment: GRADE_FRAGMENT, name: 'weather-grade' });
    veilProgram ??= new GlProgram({ vertex: VERTEX, fragment: VEIL_FRAGMENT, name: 'weather-veil' });
    this.grade = new Mesh({
      geometry: screenQuad(),
      shader: new Shader({ glProgram: gradeProgram, resources: { weatherGrade: this.gradeUniforms } }),
    });
    this.grade.blendMode = 'multiply';
    this.veil = new Mesh({
      geometry: screenQuad(),
      shader: new Shader({ glProgram: veilProgram, resources: { weatherVeil: this.veilUniforms } }),
    });
    parent.addChild(this.grade, this.veil);
  }

  update(look: AtmosphereLook, frame: AtmosphereFrame): void {
    if (!look.visible) {
      this.hide();
      return;
    }
    const { screenW, screenH } = frame;
    const camera = [frame.offsetX, frame.offsetY, frame.zoom];
    const g = this.gradeUniforms.uniforms;
    g.uScreen.set([screenW, screenH]);
    g.uCamera.set(camera);
    g.uCloudDrift.set([
      latticeDrift(frame.windTravelX, CLOUD_DRIFT_SHARE, CLOUD_SCALE_PX),
      latticeDrift(frame.windTravelY, CLOUD_DRIFT_SHARE, CLOUD_SCALE_PX),
    ]);
    g.uGrade.set(look.grade);
    g.uShade.set([look.cloudShadow, look.vignette]);
    this.gradeUniforms.update();
    const shaded = look.cloudShadow > 0 || look.vignette > 0 || look.grade.some((channel) => channel !== 1);
    this.grade.visible = shaded;
    this.grade.scale.set(screenW, screenH);

    const v = this.veilUniforms.uniforms;
    v.uScreen.set([screenW, screenH]);
    v.uCamera.set(camera);
    v.uDrift.set([
      latticeDrift(frame.windTravelX, MIST_DRIFT_SHARE, MIST_SCALE_PX * MIST_STRETCH_X),
      latticeDrift(frame.windTravelY, MIST_DRIFT_SHARE, MIST_SCALE_PX),
      latticeDrift(frame.windTravelX, STREAK_DRIFT_SHARE, STREAK_CELL_PX[0]),
      latticeDrift(frame.windTravelY, STREAK_DRIFT_SHARE, STREAK_CELL_PX[1]),
    ]);
    v.uHaze.set([...look.haze, look.hazeAlpha]);
    v.uMist.set([look.mist, look.streaks]);
    v.uFlash.set(look.flash);
    v.uFlashAt.set([
      frame.flashX * screenW,
      frame.flashY * screenH,
      FLASH_REACH_SHARE * Math.max(screenW, screenH),
    ]);
    this.veilUniforms.update();
    this.veil.visible = look.hazeAlpha > 0 || look.flash.some((channel) => channel > 0);
    this.veil.scale.set(screenW, screenH);
  }

  hide(): void {
    this.grade.visible = false;
    this.veil.visible = false;
  }

  destroy(): void {
    for (const mesh of [this.grade, this.veil]) {
      mesh.geometry.destroy();
      mesh.shader?.destroy();
      mesh.destroy();
    }
  }
}
