import { Shader, type TextureSource, UniformGroup } from 'pixi.js';
import { BRIGHTNESS_NEUTRAL } from '../../data/terrain/index.js';
import {
  DECOR_CLIP_HIDDEN_POSITION,
  DECOR_CLIP_VERTEX_DECLARATIONS,
  type DecorClipBinding,
} from '../map-objects/decor-clip.js';
import { type GlslProgramSource, glProgramFor } from '../shaders/program-source.js';
import { coverNoiseSource } from '../weather/cover-noise.js';
import {
  COVER_FRAGMENT_DECLARATIONS,
  COVER_VERTEX_BODY,
  COVER_VERTEX_DECLARATIONS,
  DECOR_COVER_FRAGMENT_DECLARATIONS,
  DECOR_COVER_VERTEX_BODY,
  DECOR_COVER_VERTEX_DECLARATIONS,
  type DecorCoverUniforms,
  type GroundCoverUniforms,
} from '../weather/ground-cover-shading.js';
import { pageChain, pageSamplerDeclarations, pageSamplerResources } from './page-samplers.js';
import {
  SWASH_FOAM_COLOUR,
  SWASH_FOAM_STRENGTH,
  SWASH_SHORE_MAX,
  SWASH_SHORE_MIN,
  SWASH_WET_TINT,
  WATER_FRAGMENT_GLSL,
  WATER_SHIMMER_GAIN,
  WATER_VERTEX_GLSL,
} from './water-shading.js';

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

/** Texels per screen pixel below which the bicubic magnification runs unblended; it fades into the
 *  sampler's bilinear by one texel per pixel. Approximation tuned by eye. */
const BICUBIC_FULL_FOOTPRINT = 0.5;
/** Texels per screen pixel from which the four-tap minification runs unblended. Tuned by eye. */
const MINIFY_FULL_FOOTPRINT = 1.5;
/** Tap offset in screen pixels: four taps a quarter pixel out cover one pixel's footprint. */
const MINIFY_TAP_RADIUS_PX = 0.25;
/** Footprint in texels beyond which the taps stop spreading, since four cannot cover more. */
const MINIFY_MAX_FOOTPRINT = 4;

// Original terrain gets bicubic magnification and four-tap minification, not a full mipmap substitute.
// Existing mipmapped materials retain their hardware filtering.
const TERRAIN_SAMPLE = `
  flat in vec4 vSampleBounds;
  uniform float uEnhancedSampling;
  uniform float uManualSampling;
  // dx and dy are vUV's derivatives, which the caller takes before any page branch (see pageChain).
  vec4 sampleTerrain(vec2 dx, vec2 dy) {
    // Both gates are uniforms. Returning first keeps the baseline path to a single sampler fetch.
    if (uEnhancedSampling < 0.5 || uManualSampling < 0.5)
      return textureGrad(uTexture, vUV, dx, dy);
    vec2 size = vec2(textureSize(uTexture, 0));
    float footprint = max(length(dx * size), length(dy * size));
    vec2 centre = (vSampleBounds.xy + vSampleBounds.zw) * 0.5;
    vec2 low = min(vSampleBounds.xy + 0.5 / size, centre);
    vec2 high = max(vSampleBounds.zw - 0.5 / size, centre);
    if (footprint < 1.0) {
      // Catmull-Rom bicubic magnification (a published reconstruction filter): sharper than the
      // sampler's bilinear, with its ringing at hard edges clamped to the premultiplied range rather
      // than removed. Bounded to the tile so a neighbour never bleeds in; fades into bilinear as
      // texels reach pixel size. Along each axis the two inner texels share one linear tap placed
      // between them by their weights, so nine taps carry the sixteen-texel sum; the clamp keeps every
      // tap on or between texel centres inside the tile, which keeps that identity at its edges.
      vec2 p = vUV * size - 0.5;
      vec2 f = fract(p);
      vec2 base = floor(p) + 0.5;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 inner = w1 + w2;
      vec2 t0 = clamp((base - 1.0) / size, low, high);
      vec2 t1 = clamp((base + w2 / inner) / size, low, high);
      vec2 t2 = clamp((base + 2.0) / size, low, high);
      vec4 sum = w0.y * (w0.x * textureLod(uTexture, vec2(t0.x, t0.y), 0.0)
                       + inner.x * textureLod(uTexture, vec2(t1.x, t0.y), 0.0)
                       + w3.x * textureLod(uTexture, vec2(t2.x, t0.y), 0.0))
               + inner.y * (w0.x * textureLod(uTexture, vec2(t0.x, t1.y), 0.0)
                       + inner.x * textureLod(uTexture, vec2(t1.x, t1.y), 0.0)
                       + w3.x * textureLod(uTexture, vec2(t2.x, t1.y), 0.0))
               + w3.y * (w0.x * textureLod(uTexture, vec2(t0.x, t2.y), 0.0)
                       + inner.x * textureLod(uTexture, vec2(t1.x, t2.y), 0.0)
                       + w3.x * textureLod(uTexture, vec2(t2.x, t2.y), 0.0));
      vec4 bicubic = clamp(sum, vec4(0.0), vec4(1.0));
      bicubic.rgb = min(bicubic.rgb, vec3(bicubic.a));
      float blend = smoothstep(${BICUBIC_FULL_FOOTPRINT.toFixed(4)}, 1.0, footprint);
      // The bilinear tap is skipped where it carries no weight; the page has one level, so an explicit
      // level 0 samples what the implicit one did.
      return blend > 0.0 ? mix(bicubic, textureLod(uTexture, vUV, 0.0), blend) : bicubic;
    }
    // Bound the footprint at strong minification: the four taps cannot represent arbitrarily many texels.
    float radius = ${MINIFY_TAP_RADIUS_PX.toFixed(4)} * min(1.0, ${MINIFY_MAX_FOOTPRINT.toFixed(4)} / footprint);
    vec2 a = (dx + dy) * radius;
    vec2 b = (dx - dy) * radius;
    vec4 filtered = 0.25 * (
      textureLod(uTexture, clamp(vUV + a, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV - a, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV + b, low, high), 0.0) +
      textureLod(uTexture, clamp(vUV - b, low, high), 0.0));
    if (footprint >= ${MINIFY_FULL_FOOTPRINT.toFixed(4)}) return filtered;
    return mix(textureLod(uTexture, vUV, 0.0), filtered, smoothstep(1.0, ${MINIFY_FULL_FOOTPRINT.toFixed(4)}, footprint));
  }
`;

// Water depth shading. The maps split water into the painter's shallow and deep pattern families, each
// with its own texture (data/terrain/water.ts); the amounts deepening both, the deep family more,
// are an approximation tuned by eye and multiply the lane brightness only. The tints and the
// saturation grade the water texel itself, also by eye: the painted green moves toward blue.
/** Brightness loss on shallow water. */
const WATER_SHALLOW_DARKEN = 0.12;
/** Brightness loss on deep water. */
const WATER_DEEP_DARKEN = 0.18;
/** RGB multiplier on shallow water: a mild pull from green toward blue. */
const WATER_SHALLOW_TINT = [0.86, 1.0, 1.126] as const;
/** RGB multiplier on deep water: a stronger pull toward blue than the shallows take. */
const WATER_DEEP_TINT = [0.734, 0.944, 1.21] as const;
/** Saturation gain on the water surface (1 = the painted texture's own). */
const WATER_SATURATION = 1.1;
/** Rec. 601 luma weights, the published grey the saturation grade pivots on. */
const LUMA_WEIGHTS = [0.299, 0.587, 0.114] as const;

const glslVec3 = (rgb: readonly [number, number, number]): string =>
  `vec3(${rgb.map((channel) => channel.toFixed(4)).join(', ')})`;

/** A GLSL block whose functions read a global `uTexture`, with that sampler taken as each function's
 *  parameter instead. */
function withPageParameter(glsl: string): string {
  return glsl
    .replace(
      'vec4 sampleTerrain(vec2 dx, vec2 dy) {',
      'vec4 sampleTerrain(sampler2D uTexture, vec2 dx, vec2 dy) {',
    )
    .replace('vec3 groundNeighbourhood() {', 'vec3 groundNeighbourhood(sampler2D uTexture) {')
    .replace(
      'vec2 decorSnowTaps(vec2 uv, vec2 dx, vec2 dy, out vec3 above, out float sides) {',
      'vec2 decorSnowTaps(sampler2D uTexture, vec2 uv, vec2 dx, vec2 dy, out vec3 above, out float sides) {',
    );
}

const FIELD_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec4 aSampleBounds;
  flat out vec4 vSampleBounds;
  in float aPage;
  flat out float vPage;
  in vec2 aUV;
  in vec2 aBrightnessUV;
  in vec3 aVertexColor;
  in float aWave;
  in vec3 aWater;

  out vec2 vUV;
  out vec2 vBrightnessUV;
  out vec3 vVertexColor;
  out float vWave;
  out vec2 vWorld;
  out vec3 vWater;
  uniform vec2 uWave; // x = water clock (seconds, wrapped), y = master amplitude scale (0 = still)
  uniform float uEnhancedWater;
  ${WATER_VERTEX_GLSL}
  ${COVER_VERTEX_DECLARATIONS}
  ${matrixBlock}
  void main(void) {
    vSampleBounds = aSampleBounds;
    vPage = aPage;
    ${COVER_VERTEX_BODY}
    float wave;
    vec2 pos = aPosition;
    pos.y -= waterLift(aPosition, aWave, wave);
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(pos, 1.0)).xy, 0.0, 1.0);
    vUV = aUV;
    vBrightnessUV = aBrightnessUV;
    vVertexColor = aVertexColor;
    vWave = wave;
    vWorld = aPosition;
    vWater = aWater;
  }
`;

// texel.r is the raw lane byte / 255 while the measured curve is byte / BRIGHTNESS_NEUTRAL, hence the
// constant rescale. uColor is the mesh-pipe group colour (premultiplied tint·alpha).
const FIELD_FRAGMENT = `#version 300 es
  // The page this triangle samples, picked once per fragment below: every function reading uTexture
  // takes it as a parameter of that name.
  precision highp float;
  precision highp int;
  in vec2 vUV;
  in vec2 vBrightnessUV;
  in vec3 vVertexColor;
  in float vWave;
  in vec2 vWorld;
  in vec3 vWater;

${pageSamplerDeclarations()}
  flat in float vPage;
  uniform sampler2D uBrightnessTex;
  uniform vec4 uColor;
  uniform vec2 uWave;
  uniform float uEnhancedWater;

  out vec4 finalColor;

  ${WATER_FRAGMENT_GLSL}
  ${withPageParameter(TERRAIN_SAMPLE)}
  ${withPageParameter(COVER_FRAGMENT_DECLARATIONS)}

  // Everything that reads the fragment's page: its texel and, where snow lies, the neighbourhood the
  // snow classifies the ground by. Only this runs inside the page chain, so the shading compiles once.
  vec4 pageTexel(sampler2D uTexture, bool snowed, vec2 dx, vec2 dy, out vec3 near) {
    near = snowed ? groundNeighbourhood(uTexture) : vec3(0.0);
    return sampleTerrain(uTexture, dx, dy);
  }

  // cover is the weather cover already kept off the water; zero while the cover is off.
  vec4 shadeGround(vec4 texel, vec4 cover, vec3 near) {
    float lane = texture(uBrightnessTex, vBrightnessUV).r * ${(255 / BRIGHTNESS_NEUTRAL).toFixed(8)};
    // Water shimmer: travelling light and shade on the surface; vWave is 0 on land, which skips it.
    if (vWave > 0.0) lane *= 1.0 + vWave * uWave.y * ${WATER_SHIMMER_GAIN.toFixed(4)} * waterShimmer(vWorld);
    // Every enhanced-water term sits under its uniform, so the baseline pays for none of it. No
    // derivative is taken inside a gate. Water depth: shallows read darker, deep water darker still.
    // vWater.xy = (water fraction, deep fraction), zero on land paint and at land nodes, so it fades out
    // across the coast triangle. A fragment with no water takes neither the depth shading nor the colour
    // grade, both of which are identities there.
    if (uEnhancedWater > 0.5 && vWater.x > 0.0) {
      float shallow = vWater.x - vWater.y;
      float deep = vWater.y;
      lane *= 1.0 - ${WATER_SHALLOW_DARKEN.toFixed(4)} * shallow - ${WATER_DEEP_DARKEN.toFixed(4)} * deep;
      // Water colour: saturate the surface and tint each depth family; the painted green moves blue.
      float luma = dot(texel.rgb, ${glslVec3(LUMA_WEIGHTS)});
      float saturation = mix(1.0, ${WATER_SATURATION.toFixed(4)}, vWater.x);
      vec3 tint = mix(vec3(1.0), ${glslVec3(WATER_SHALLOW_TINT)}, shallow)
        * mix(vec3(1.0), ${glslVec3(WATER_DEEP_TINT)}, deep);
      texel.rgb = mix(vec3(luma), texel.rgb, saturation) * tint;
    }
    // The swash on the beach: vWater.z is the shore value, 0 inland and 1 on open water, so only the
    // coast band where it can show pays for it.
    if (uEnhancedWater > 0.5 && vWater.z > ${SWASH_SHORE_MIN.toFixed(4)} && vWater.z < ${SWASH_SHORE_MAX.toFixed(4)}) {
      vec2 swash = waterSwashCover(vWorld, vWater.z, 1.0 - clamp(vWater.x, 0.0, 1.0)) * uWave.y;
      texel.rgb *= mix(vec3(1.0), ${glslVec3(SWASH_WET_TINT)}, swash.x);
      texel.rgb = mix(texel.rgb, ${glslVec3(SWASH_FOAM_COLOUR)} * texel.a, swash.y * ${SWASH_FOAM_STRENGTH.toFixed(4)});
    }
    // Bare cover (dry ground in view of weather, open water) leaves the texel as it is.
    if (uCover > 0.5 && cover.r + cover.g + cover.b > 0.0)
      texel.rgb = weatherCover(texel.rgb, texel.a, lane, cover, near);
    // Unclamped multiply: > 1 brightens (the lane's 128..255 half); the FB write clamps per channel.
    return vec4(texel.rgb * lane * vVertexColor, texel.a) * uColor;
  }

  void main(void) {
    // Weather cover keeps off the water surface; the uniform gate keeps a dry map's arithmetic as it was.
    vec4 cover = vec4(0.0);
    if (uCover > 0.5) {
      cover = texture(uCoverTex, vCoverUV);
      cover.rgb *= 1.0 - clamp(vWater.x, 0.0, 1.0);
    }
    vec2 uvDx = dFdx(vUV);
    vec2 uvDy = dFdy(vUV);
    vec4 texel;
    vec3 near;
${pageChain('texel = pageTexel(uPage$, cover.g > 0.0, uvDx, uvDy, near);')}
    finalColor = shadeGround(texel, cover, near);
  }
`;

/**
 * A recoloured decor quad's page holds palette index in red and coverage in green, and its row of
 * `uRecolourLut` colours it, premultiplied in bytes, round(c * a / 255): the bytes createImageBitmap's
 * premultiply gives a coloured page of the stem.
 */
const RECOLOURED_DECOR_GLSL = `
  const float BYTE_MAX = 255.0;
  // Added before the integer divide by 255, so the divide rounds to nearest.
  const int ROUNDING_BIAS = 127;
  const int BYTE_MAX_INT = 255;
  vec4 recolouredTexel(vec4 tap, int row) {
    vec3 colour = texelFetch(uRecolourLut, ivec2(int(tap.r * BYTE_MAX + 0.5), row), 0).rgb;
    ivec3 c = ivec3(colour * BYTE_MAX + 0.5);
    int a = int(tap.g * BYTE_MAX + 0.5);
    return vec4(vec3((c * a + ROUNDING_BIAS) / BYTE_MAX_INT) / BYTE_MAX, tap.g);
  }
  // A recoloured page is opaque: its coverage is in green. A macro, since a function called from the
  // snow taps would be inlined into every branch of the page chain.
  #define COVERAGE_TAP(page, uv, dx, dy) (vLutRow >= 0.0 ? textureGrad(page, uv, dx, dy).g : textureGrad(page, uv, dx, dy).a)
`;

/** The decor cover block with its snow taps reading a recoloured page's coverage from green. */
function recolouredCoverage(glsl: string): string {
  const taps = /textureGrad\(uTexture, ([^;]*?), dx, dy\)\.a/g;
  const covered = glsl.replace(taps, 'COVERAGE_TAP(uTexture, $1, dx, dy)');
  if (covered.includes('textureGrad(uTexture,')) throw new Error('decor snow tap not read as coverage');
  return covered;
}

const VERTEX_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec2 aUV;
  in float aBrightness;
  in float aPage;
  flat out float vPage;
  in float aLutRow;
  flat out float vLutRow;

  out vec2 vUV;
  out float vBrightness;
  ${matrixBlock}
  ${DECOR_COVER_VERTEX_DECLARATIONS}
  ${DECOR_CLIP_VERTEX_DECLARATIONS}
  void main(void) {
    vec2 decorPosition = aPosition;
    vec2 uv = aUV;
    vec4 bounds;
    if (aClip.y != 0.0 && !decorClipVertex(aClip, aAnchor, decorPosition, uv, bounds)) {
      gl_Position = ${DECOR_CLIP_HIDDEN_POSITION};
      return;
    }
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(decorPosition, 1.0)).xy, 0.0, 1.0);
    vUV = uv;
    vBrightness = aBrightness;
    vPage = aPage;
    vLutRow = aLutRow;
    ${DECOR_COVER_VERTEX_BODY}
  }
`;

// highp: the cover noise hash needs 32-bit uint arithmetic and a 24-bit float result.
const VERTEX_FRAGMENT = `#version 300 es
  precision highp float;
  precision highp int;
  in vec2 vUV;
  in float vBrightness;
  flat in float vPage;
  flat in float vLutRow;

${pageSamplerDeclarations()}
  uniform vec4 uColor;
  uniform sampler2D uRecolourLut;

  out vec4 finalColor;
  ${RECOLOURED_DECOR_GLSL}
  ${recolouredCoverage(withPageParameter(DECOR_COVER_FRAGMENT_DECLARATIONS))}

  // Everything that reads the fragment's page, given vUV's derivatives dx and dy taken before the page
  // chain; only this runs inside the chain, so the snow shading after it compiles once.
  vec4 decorPage(sampler2D uTexture, vec2 dx, vec2 dy, out vec2 pageSize, out vec3 above, out float sides) {
    pageSize = vec2(0.0);
    above = vec3(0.0);
    sides = 0.0;
    // vSnow is 0 unless the cover switch is on, so a dry map keeps its single fetch.
    if (vSnow > 0.0) pageSize = decorSnowTaps(uTexture, vUV, dx, dy, above, sides);
    return textureGrad(uTexture, vUV, dx, dy);
  }

  void main(void) {
    vec2 uvDx = dFdx(vUV);
    vec2 uvDy = dFdy(vUV);
    vec4 texel;
    vec2 pageSize;
    vec3 above;
    float sides;
${pageChain('texel = decorPage(uPage$, uvDx, uvDy, pageSize, above, sides);')}
    // aLutRow is -1 on a quad of a coloured page.
    if (vLutRow >= 0.0) texel = recolouredTexel(texel, int(vLutRow));
    // A quad of a mesh's own (no brightness of its own) draws its texel as a plain mesh would.
    if (vBrightness < 0.0) {
      finalColor = texel * uColor;
      return;
    }
    // Page texels per screen px, taken after the chain; zero on a dry map.
    vec2 footprint = fwidth(vUV * pageSize);
    if (vSnow > 0.0) texel.rgb = decorSnow(texel.rgb, texel.a, footprint, above, sides, vBrightness);
    finalColor = vec4(texel.rgb * vBrightness, texel.a) * uColor;
  }
`;

/** The shaded ground mesh program; the lane multiplier is sampled per fragment. */
export const SHADED_TERRAIN_SOURCE: GlslProgramSource = {
  name: 'shaded-terrain',
  vertex: FIELD_VERTEX,
  fragment: FIELD_FRAGMENT,
};
/** The shaded decor quad program; one brightness per quad. */
export const SHADED_DECOR_SOURCE: GlslProgramSource = {
  name: 'shaded-decor',
  vertex: VERTEX_VERTEX,
  fragment: VERTEX_FRAGMENT,
};

/** The compiled GL programs, shared process-wide (a Shader per mesh only binds resources). */

/** The map's water-animation uniform group: `uWave = [waterSeconds, amplitudeScale]`, mutated in place per
 *  frame (a `Float32Array`, because a shared program re-uploads only changed contents). One group per
 *  map, shared by every shaded mesh, so the per-frame animation is one write instead of one per chunk. */
export type WaveUniforms = UniformGroup & {
  readonly uniforms: { readonly uWave: Float32Array; uEnhancedWater: number; uEnhancedSampling: number };
};

/** Make the map's shared water-animation uniform group (time 0, full amplitude). */
export function makeWaveUniforms(): WaveUniforms {
  return new UniformGroup({
    uWave: { value: new Float32Array([0, 1]), type: 'vec2<f32>' },
    uEnhancedWater: { value: 0, type: 'f32' },
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
  pages: readonly TextureSource[],
  brightnessTex: TextureSource,
  wave: WaveUniforms,
  cover: TerrainCoverBinding,
): Shader {
  const samplers = pageSamplerResources(pages);
  const first = samplers.uPage0 as TextureSource;
  return new Shader({
    glProgram: glProgramFor(SHADED_TERRAIN_SOURCE),
    resources: {
      ...samplers,
      uSampler: first.style,
      uBrightnessTex: brightnessTex,
      waveVars: wave,
      sampling: terrainSamplingUniforms(first),
      coverVars: cover.uniforms,
      uCoverTex: cover.texture,
      uCoverNoise: coverNoiseSource(),
    },
  });
}

/** The map's weather-cover texture and switch, shared by every shaded ground mesh. */
export interface TerrainCoverBinding {
  readonly texture: TextureSource;
  readonly uniforms: GroundCoverUniforms;
}

/**
 * A {@link Shader} for a shaded decor quad batch: one constant `aBrightness` multiplier per quad, its
 * anchor cell's value. A flat decal has no cell-space UV lattice to interpolate, so the anchor constant
 * is the recorded approximation.
 */
export function makeShadedDecorShader(
  pages: readonly TextureSource[],
  cover: DecorCoverBinding,
  clips: DecorClipBinding,
  recolourLut: TextureSource,
): Shader {
  const samplers = pageSamplerResources(pages);
  return new Shader({
    glProgram: glProgramFor(SHADED_DECOR_SOURCE),
    resources: {
      ...samplers,
      uSampler: (samplers.uPage0 as TextureSource).style,
      decorCoverVars: cover.uniforms,
      uCoverTex: cover.texture,
      uCoverNoise: coverNoiseSource(),
      decorClipVars: clips.uniforms,
      uDecorFrames: clips.table.source,
      uRecolourLut: recolourLut,
    },
  });
}

/** The map's weather-cover texture and switch, shared by every shaded decor batch. */
export interface DecorCoverBinding {
  readonly texture: TextureSource;
  readonly uniforms: DecorCoverUniforms;
}

const COLOR_VERTEX = `#version 300 es
  in vec2 aPosition;
  in vec4 aSampleBounds;
  flat out vec4 vSampleBounds;
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
    vec4 texel = sampleTerrain(dFdx(vUV), dFdy(vUV));
    finalColor = vec4(texel.rgb * vVertexColor, texel.a) * uColor;
  }
`;
/** The flat-tinted ground program for a single page. */
export const TINTED_TERRAIN_SOURCE: GlslProgramSource = {
  name: 'tinted-terrain',
  vertex: COLOR_VERTEX,
  fragment: COLOR_FRAGMENT,
};

/** A mipmapped page keeps its hardware filtering, and a single texel (the flat-colour path's white
 *  pixel) has nothing to reconstruct, so neither takes the manual filter. */
function terrainSamplingUniforms(source: TextureSource): UniformGroup {
  return new UniformGroup({ uManualSampling: { value: manualSampling(source) ? 1 : 0, type: 'f32' } });
}

/** Whether `source` takes the manual filter; pages one shaded mesh samples together must agree. */
export function manualSampling(source: TextureSource): boolean {
  return !(
    source.autoGenerateMipmaps ||
    source.mipLevelCount > 1 ||
    (source.width <= 1 && source.height <= 1)
  );
}

/** `wave` is the terrain layer's shared group. A caller passing `undefined` gets a private one that no
 *  enhancement setting can ever reach, which suits the flat-colour placeholder and nothing else. */
export function makeTintedTerrainShader(source: TextureSource, wave: WaveUniforms | undefined): Shader {
  return new Shader({
    glProgram: glProgramFor(TINTED_TERRAIN_SOURCE),
    resources: {
      uTexture: source,
      uSampler: source.style,
      waveVars: wave ?? makeWaveUniforms(),
      sampling: terrainSamplingUniforms(source),
    },
  });
}
