import { GlProgram, Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { BRIGHTNESS_NEUTRAL } from '../data/terrain/index.js';

/**
 * The custom mesh shaders for the brightness-shaded ground and decor, which Pixi's built-in mesh shader
 * cannot serve because a per-mesh `tint` cannot vary across a chunk.
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

// Original terrain gets bicubic magnification and four-tap minification, not a full mipmap substitute.
// Existing mipmapped materials retain their hardware filtering.
const TERRAIN_SAMPLE = `
  in vec4 vSampleBounds;
  uniform float uEnhancedSampling;
  uniform float uManualSampling;
  vec4 sampleTerrain() {
    vec2 size = vec2(textureSize(uTexture, 0));
    vec2 dx = dFdx(vUV);
    vec2 dy = dFdy(vUV);
    float footprint = max(length(dx * size), length(dy * size));
    if (uEnhancedSampling < 0.5 || uManualSampling < 0.5)
      return texture(uTexture, vUV);
    vec2 centre = (vSampleBounds.xy + vSampleBounds.zw) * 0.5;
    vec2 low = min(vSampleBounds.xy + 0.5 / size, centre);
    vec2 high = max(vSampleBounds.zw - 0.5 / size, centre);
    if (footprint < 1.0) {
      // Catmull-Rom bicubic magnification (a published reconstruction filter): sharper than the
      // sampler's bilinear, with its ringing at hard edges clamped to the premultiplied range rather
      // than removed. Bounded to the tile so a neighbour never bleeds in; fades into bilinear as
      // texels reach pixel size.
      vec2 p = vUV * size - 0.5;
      vec2 f = fract(p);
      vec2 base = (floor(p) + 0.5) / size;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec4 sum = vec4(0.0);
      for (int j = -1; j <= 2; j++) {
        float wy = j == -1 ? w0.y : j == 0 ? w1.y : j == 1 ? w2.y : w3.y;
        vec4 row = vec4(0.0);
        for (int i = -1; i <= 2; i++) {
          float wx = i == -1 ? w0.x : i == 0 ? w1.x : i == 1 ? w2.x : w3.x;
          vec2 uv = clamp(base + vec2(float(i), float(j)) / size, low, high);
          row += wx * textureLod(uTexture, uv, 0.0);
        }
        sum += wy * row;
      }
      vec4 bicubic = clamp(sum, vec4(0.0), vec4(1.0));
      bicubic.rgb = min(bicubic.rgb, vec3(bicubic.a));
      return mix(bicubic, texture(uTexture, vUV), smoothstep(0.5, 1.0, footprint));
    }
    // Bound the footprint at strong minification: the four taps cannot represent arbitrarily many texels.
    float radius = 0.25 * min(1.0, 4.0 / footprint);
    vec2 a = (dx + dy) * radius;
    vec2 b = (dx - dy) * radius;
    vec4 filtered = 0.25 * (
      textureLod(uTexture, clamp(vUV + a, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV - a, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV + b, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV - b, low, high), 0.0));
    if (footprint >= 1.5) return filtered;
    return mix(texture(uTexture, vUV), filtered, smoothstep(1.0, 1.5, footprint));
  }
`;

// Water-surface animation constants, an approximation tuned by eye. Time is measured in sim ticks, so
// the phase follows the interpolated sim clock and never wall-clock time.
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
/** The waves' common period (lcm of 30, 21, 42 and 35 ticks): the clock wraps modulo this, so the f32
 *  `uWave.x` never grows into `sin` precision loss over a long session. */
export const WAVE_TIME_PERIOD_TICKS = 210;

const FIELD_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec4 aSampleBounds;
  out vec4 vSampleBounds;
  in vec2 aUV;
  in vec2 aBrightnessUV;
  in vec3 aVertexColor;
  in float aWave;

  out vec2 vUV;
  out vec2 vBrightnessUV;
  out vec3 vVertexColor;
  out float vWave;
  out float vWavePhase;
  out float vCrossWavePhase;
  uniform vec2 uWave; // x = animation time (sim ticks), y = master amplitude scale (0 = still)
  uniform float uEnvironmentMotion;
  ${matrixBlock}
  void main(void) {
    vSampleBounds = aSampleBounds;
    float phase = (aPosition.x + aPosition.y) * ${WAVE_PHASE_PER_PX.toFixed(8)};
    vec2 pos = aPosition;
    // Water swell: bob the vertex by its wave amplitude (0 on land and along the coast, data/terrain/water.ts).
    float crossPhase = (aPosition.x - aPosition.y * 1.3) * 0.025;
    float swell = sin(uWave.x * ${WAVE_RADIANS_PER_TICK.toFixed(8)} + phase);
    // Artistic approximation: crossing swells retain the same maximum displacement and coast mask.
    float crossedSwell = 0.68 * swell + 0.32 * sin(uWave.x * ${((2 * Math.PI) / 42).toFixed(8)} + crossPhase);
    pos.y -= aWave * uWave.y * ${WAVE_AMPLITUDE_PX.toFixed(4)}
      * mix(swell, crossedSwell, uEnvironmentMotion);
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(pos, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightnessUV = aBrightnessUV;
    vVertexColor = aVertexColor;
    vWave = aWave;
    vWavePhase = phase;
    vCrossWavePhase = crossPhase;
  }
`;

// texel.r is the raw lane byte / 255 while the measured curve is byte / BRIGHTNESS_NEUTRAL, hence the
// constant rescale. uColor is the mesh-pipe group colour (premultiplied tint·alpha).
const FIELD_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vUV;
  in vec2 vBrightnessUV;
  in vec3 vVertexColor;
  in float vWave;
  in float vWavePhase;
  in float vCrossWavePhase;

  uniform sampler2D uTexture;
  uniform sampler2D uBrightnessTex;
  uniform vec4 uColor;
  uniform vec2 uWave;
  uniform float uEnvironmentMotion;

  out vec4 finalColor;

  ${TERRAIN_SAMPLE}

  void main(void) {
    vec4 texel = sampleTerrain();
    float lane = texture(uBrightnessTex, vBrightnessUV).r * ${(255 / BRIGHTNESS_NEUTRAL).toFixed(8)};
    // Water shimmer: a second travelling wave glints the shaded water surface (0 on land).
    float shimmer = sin(uWave.x * ${WAVE_SHIMMER_RADIANS_PER_TICK.toFixed(8)} + vWavePhase * 1.7);
    float crossGlint = sin(uWave.x * ${((2 * Math.PI) / 35).toFixed(8)} - vCrossWavePhase * 2.1);
    // Softer intersecting glints avoid a uniform whole-surface pulse. UVs stay inside their atlas tile.
    float polishedShimmer = 0.55 * shimmer + 0.3 * crossGlint + 0.15 * shimmer * crossGlint;
    lane *= 1.0 + vWave * uWave.y * ${WAVE_SHIMMER.toFixed(4)}
      * mix(shimmer, polishedShimmer, uEnvironmentMotion);
    // Unclamped multiply: > 1 brightens (the lane's 128..255 half); the FB write clamps per channel.
    finalColor = vec4(texel.rgb * lane * vVertexColor, texel.a) * uColor;
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
export type WaveUniforms = UniformGroup & {
  readonly uniforms: { readonly uWave: Float32Array; uEnvironmentMotion: number; uEnhancedSampling: number };
};

/** Make the map's shared water-animation uniform group (time 0, full amplitude). */
export function makeWaveUniforms(): WaveUniforms {
  return new UniformGroup({
    uWave: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
    uEnvironmentMotion: { value: 0, type: 'f32' },
    uEnhancedSampling: { value: 0, type: 'f32' },
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
      sampling: terrainSamplingUniforms(source),
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

const COLOR_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec4 aSampleBounds;
  out vec4 vSampleBounds;
  in vec2 aUV;
  in vec3 aVertexColor;
  out vec2 vUV;
  out vec3 vVertexColor;
  ${matrixBlock}
  void main(void) {
    vSampleBounds = aSampleBounds;
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vVertexColor = aVertexColor;
  }
`;
const COLOR_FRAGMENT = `#version 300 es
  precision highp float;
  in vec2 vUV;
  in vec3 vVertexColor;
  uniform sampler2D uTexture;
  uniform vec4 uColor;
  out vec4 finalColor;
  ${TERRAIN_SAMPLE}
  void main(void) {
    vec4 texel = sampleTerrain();
    finalColor = vec4(texel.rgb * vVertexColor, texel.a) * uColor;
  }
`;
let colorProgram: GlProgram | undefined;

function terrainSamplingUniforms(source: TextureSource): UniformGroup {
  return new UniformGroup({
    uManualSampling: {
      value: source.autoGenerateMipmaps || source.mipLevelCount > 1 ? 0 : 1,
      type: 'f32',
    },
  });
}

export function makeTintedTerrainShader(source: TextureSource, wave = makeWaveUniforms()): Shader {
  colorProgram ??= new GlProgram({ vertex: COLOR_VERTEX, fragment: COLOR_FRAGMENT });
  return new Shader({
    glProgram: colorProgram,
    resources: {
      uTexture: source,
      uSampler: source.style,
      waveVars: wave,
      sampling: terrainSamplingUniforms(source),
    },
  });
}
