import { GlProgram, Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { BRIGHTNESS_NEUTRAL } from '../data/terrain/index.js';

/**
 * The custom mesh shaders for the brightness-shaded ground and decor - the stock textured-mesh draw times
 * the baked `embr` multiplier (`data/terrain/brightness.ts`), which Pixi's built-in mesh shader cannot do
 * because a per-mesh `tint` cannot vary across a chunk. They swap the shader of the existing
 * one-mesh-per-page-per-chunk draws, so mesh and draw-call counts are unchanged.
 *
 * The explicit `#version 300 es` matters: `GlProgram` only runs its ES-300 preprocessing when the source
 * already carries the directive.
 */

/** GLSL for `mvp` + UV pass-through shared by both variants. Pixi's `GlMeshAdaptor` binds the renderer's
 *  global uniforms and the mesh-pipe locals onto a custom mesh shader, so declaring them loose is enough. */
const matrixBlock = `
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
`;

// Water-surface animation constants, an approximation tuned by eye. Time is measured in sim ticks, so a
// `?shot` frame at a fixed tick is byte-reproducible.
/** Peak vertical bob (world px) at full wave amplitude. */
const WAVE_AMPLITUDE_PX = 1.75;
/** Swell angular speed: one bob cycle every 30 ticks (~2.5 s at the 12 Hz sim). */
const WAVE_RADIANS_PER_TICK = (2 * Math.PI) / 30;
/** Spatial phase gradient (radians per world px along x+y) - the swell travels diagonally. */
const WAVE_PHASE_PER_PX = (2 * Math.PI) / 150;
/** Peak brightness modulation of the water shimmer (fraction of the lane multiplier). */
const WAVE_SHIMMER = 0.08;
/** The shimmer's own angular speed - off the swell's so glints don't pulse in lockstep. */
const WAVE_SHIMMER_RADIANS_PER_TICK = (2 * Math.PI) / 21;
/** The two waves' common period (lcm of 30 and 21 ticks): the clock wraps modulo this, so the f32
 *  `uWave.x` never grows into `sin` precision loss over a long session. */
export const WAVE_TIME_PERIOD_TICKS = 210;

const FIELD_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in vec2 aBrightnessUV;
  in float aWave;

  out vec2 vUV;
  out vec2 vBrightnessUV;
  out float vWave;
  out float vWavePhase;
  uniform vec2 uWave; // x = animation time (sim ticks), y = master amplitude scale (0 = still)
  ${matrixBlock}
  void main(void) {
    float phase = (aPosition.x + aPosition.y) * ${WAVE_PHASE_PER_PX.toFixed(8)};
    vec2 pos = aPosition;
    // Water swell: bob the vertex by its wave amplitude (0 on land and along the coast, data/terrain/water.ts).
    pos.y -= aWave * uWave.y * ${WAVE_AMPLITUDE_PX.toFixed(4)}
      * sin(uWave.x * ${WAVE_RADIANS_PER_TICK.toFixed(8)} + phase);
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(pos, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightnessUV = aBrightnessUV;
    vWave = aWave;
    vWavePhase = phase;
  }
`;

// texel.r is the raw lane byte / 255 while the measured curve is byte / BRIGHTNESS_NEUTRAL, hence the
// constant rescale. uColor is the mesh-pipe group colour (premultiplied tint·alpha).
const FIELD_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vUV;
  in vec2 vBrightnessUV;
  in float vWave;
  in float vWavePhase;

  uniform sampler2D uTexture;
  uniform sampler2D uBrightnessTex;
  uniform vec4 uColor;
  uniform vec2 uWave;

  out vec4 finalColor;

  void main(void) {
    vec4 texel = texture(uTexture, vUV);
    float lane = texture(uBrightnessTex, vBrightnessUV).r * ${(255 / BRIGHTNESS_NEUTRAL).toFixed(8)};
    // Water shimmer: a second travelling wave glints the shaded water surface (0 on land).
    lane *= 1.0 + vWave * uWave.y * ${WAVE_SHIMMER.toFixed(4)}
      * sin(uWave.x * ${WAVE_SHIMMER_RADIANS_PER_TICK.toFixed(8)} + vWavePhase * 1.7);
    // Unclamped multiply: > 1 brightens (the lane's 128..255 half); the FB write clamps per channel.
    finalColor = vec4(texel.rgb * lane, texel.a) * uColor;
  }
`;

const VERTEX_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in float aBrightness;

  out vec2 vUV;
  out float vBrightness;
  ${matrixBlock}
  void main(void) {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightness = aBrightness;
  }
`;

const VERTEX_FRAGMENT = `#version 300 es
  in vec2 vUV;
  in float vBrightness;

  uniform sampler2D uTexture;
  uniform vec4 uColor;

  out vec4 finalColor;

  void main(void) {
    vec4 texel = texture(uTexture, vUV);
    finalColor = vec4(texel.rgb * vBrightness, texel.a) * uColor;
  }
`;

/** The compiled GL programs, shared process-wide (a Shader per mesh only binds resources). */
let fieldProgram: GlProgram | undefined;
let vertexProgram: GlProgram | undefined;

/** The map's water-animation uniform group: `uWave = [timeTicks, amplitudeScale]`, mutated in place per
 *  frame (a `Float32Array`, because a shared program re-uploads only changed contents). One group per
 *  map, shared by every shaded mesh, so the per-frame animation is one write instead of one per chunk. */
export type WaveUniforms = UniformGroup & { readonly uniforms: { readonly uWave: Float32Array } };

/** Make the map's shared water-animation uniform group (time 0, full amplitude). */
export function makeWaveUniforms(): WaveUniforms {
  return new UniformGroup({
    uWave: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
  }) as WaveUniforms;
}

/**
 * A {@link Shader} for the shaded ground mesh: the lane multiplier is sampled per fragment from
 * `brightnessTex` (the map's `embr` bytes as an R8 texture, linear-filtered + edge-clamped), so the
 * texture's own bilinear reproduces the original's smooth per-pixel banding instead of a per-vertex
 * zigzag along triangle edges. WebGL-only.
 */
export function makeShadedTerrainShader(
  source: TextureSource,
  brightnessTex: TextureSource,
  wave: WaveUniforms,
): Shader {
  fieldProgram ??= new GlProgram({ vertex: FIELD_VERTEX, fragment: FIELD_FRAGMENT });
  return new Shader({
    glProgram: fieldProgram,
    resources: {
      uTexture: source,
      uSampler: source.style,
      uBrightnessTex: brightnessTex,
      waveVars: wave,
    },
  });
}

/**
 * A {@link Shader} for a shaded decor quad batch: one constant `aBrightness` multiplier per quad, its
 * anchor cell's value. A flat decal has no cell-space UV lattice to interpolate, so the anchor constant
 * is the recorded approximation.
 */
export function makeShadedDecorShader(source: TextureSource): Shader {
  vertexProgram ??= new GlProgram({ vertex: VERTEX_VERTEX, fragment: VERTEX_FRAGMENT });
  return new Shader({
    glProgram: vertexProgram,
    resources: { uTexture: source, uSampler: source.style },
  });
}
