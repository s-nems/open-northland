import { PIXEL_ART_MAGNIFY_GLSL } from './pixel-art-magnify.js';
import { type ShadowStyle, shadowTintChannels } from './shadow-style.js';

/** `aFlags` bits: what the fragment shader must know about the element's texture. They share one float
 *  rather than growing every world vertex by another attribute. */
export const WORLD_FLAG_MAGNIFY = 1;
export const WORLD_FLAG_SHADOW = 2;
/** The element's page is palette-indexed: the batch texture at its LUT slot holds the palette, and the
 *  flags above the slot hold its LUT row. */
export const WORLD_FLAG_PALETTED = 4;
/** A paletted element drawn as its row's {@link GLOW_PALETTE_INDEX} colour over its coverage alone. */
export const WORLD_FLAG_GLOW = 8;
/** A paletted element's LUT slot in the batch's texture list, in `aFlags` bits 4 to 8. */
export const WORLD_LUT_SLOT_SHIFT = 4;
export const WORLD_LUT_SLOT_MASK = 31;
/** A paletted element's LUT row, from `aFlags` bit 9 up; a float32 holds it exactly below 2^15 rows. */
export const WORLD_LUT_ROW_SHIFT = 9;
/**
 * The palette index a hero's glow takes its colour from: step 10 of the team ramp in the body palette's
 * vest band (160-175), which each player's team row of the human LUT carries. Original behavior: the glow
 * colour is that step of the owner's `Player NN` ramp.
 */
export const GLOW_PALETTE_INDEX = 170;
/** The world batch program: one fragment variant per magnification mode and shadow style. */
export const WORLD_BATCH_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec2 aTextureIdAndRound;
in float aFlags;
in vec4 aFrame;
in float aSelection;
out vec4 vColor;
out vec2 vUV;
out float vTextureId;
flat out float vFlags;
flat out vec4 vFrame;
flat out float vSelection;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec2 uResolution;

void main(void) {
  vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uWorldColorAlpha;
  vUV = aUV;
  vTextureId = aTextureIdAndRound.y;
  vFlags = aFlags;
  vFrame = aFrame;
  vSelection = aSelection;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  if (aTextureIdAndRound.x == 1.0) {
    gl_Position.xy = (floor(((gl_Position.xy * 0.5 + 0.5) * uResolution) + 0.5) / uResolution) * 2.0 - 1.0;
  }
}`;

/** GLSL ES 3.0 indexes sampler arrays only by constants, so every lookup is an if-chain over the
 *  float `slot` expression. */
function textureChain(maxTextures: number, slot: string, call: (index: number) => string): string {
  const lines: string[] = [];
  for (let i = 0; i < maxTextures; i++) {
    const guard = i < maxTextures - 1 ? `if (${slot} < ${i}.5) ` : '';
    lines.push(`  ${i > 0 ? 'else ' : ''}${guard}{ ${call(i)} }`);
  }
  return lines.join('\n');
}

/** A GLSL float literal: a whole number still needs its decimal point. */
const glslFloat = (value: number): string => value.toFixed(6);

/** Replaces a silhouette's own pure black with the style's colour, at its gained coverage. */
function shadowShadingGlsl(shadow: ShadowStyle | null): { declarations: string; output: string } {
  if (shadow === null) return { declarations: '', output: 'finalColor = outColor * vColor;' };
  const [red, green, blue] = shadowTintChannels(shadow.tint).map(glslFloat);
  return {
    declarations: /* glsl */ `
const float SHADOW_ALPHA_GAIN = ${glslFloat(shadow.alphaGain)};
const float SHADOW_MAX_ALPHA = ${glslFloat(shadow.maxAlpha)};
const vec3 SHADOW_TINT = vec3(${red}, ${green}, ${blue});`,
    // A silhouette carries coverage only, so the element's own colour contributes nothing but its
    // alpha.
    output: /* glsl */ `if (hasFlag(WORLD_FLAG_SHADOW)) {
    float shadowAlpha = min(outColor.a * SHADOW_ALPHA_GAIN, SHADOW_MAX_ALPHA) * vColor.a;
    finalColor = vec4(SHADOW_TINT * shadowAlpha, shadowAlpha);
  } else {
    finalColor = outColor * vColor;
  }`,
  };
}

export function worldBatchFragment(maxTextures: number, mode: number, shadow: ShadowStyle | null): string {
  const shading = shadowShadingGlsl(shadow);
  return /* glsl */ `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUV;
in float vTextureId;
flat in float vFlags;
flat in vec4 vFrame;
flat in float vSelection;
out vec4 finalColor;
uniform sampler2D uTextures[${maxTextures}];
// 0 off (Pixi's default sampling) / 1 sampler filter + frame-clamped minification / 2 sharp / 3 xbr
const float WORLD_MAGNIFY = ${mode}.0;
const int WORLD_FLAG_MAGNIFY = ${WORLD_FLAG_MAGNIFY};
const int WORLD_FLAG_SHADOW = ${WORLD_FLAG_SHADOW};
const int WORLD_FLAG_PALETTED = ${WORLD_FLAG_PALETTED};
const int WORLD_FLAG_GLOW = ${WORLD_FLAG_GLOW};
const float GLOW_PALETTE_INDEX = ${GLOW_PALETTE_INDEX}.0;
const int WORLD_LUT_SLOT_SHIFT = ${WORLD_LUT_SLOT_SHIFT};
const int WORLD_LUT_SLOT_MASK = ${WORLD_LUT_SLOT_MASK};
const int WORLD_LUT_ROW_SHIFT = ${WORLD_LUT_ROW_SHIFT};
// One texel per 8-bit palette index across a LUT row.
const float PALETTE_INDEX_MAX = 255.0;
// Below this uv footprint a paletted sample is magnified, so the minification taps would coincide.
const float PALETTED_MIN_FOOTPRINT = 0.000001;${shading.declarations}
// Resolved once per fragment: the bound page's size, the element's flags and its palette lookup.
vec2 texSize;
int flags;
bool paletted;
float lutSlot;
int lutRow;

bool hasFlag(int bit) {
  return (flags & bit) != 0;
}

vec4 sampleTexture(vec2 uv) {
${textureChain(maxTextures, 'vTextureId', (i) => `return texture(uTextures[${i}], uv);`)}
}

ivec2 textureSizeOf() {
${textureChain(maxTextures, 'vTextureId', (i) => `return textureSize(uTextures[${i}], 0);`)}
}

vec4 fetchTexel(ivec2 px) {
${textureChain(maxTextures, 'vTextureId', (i) => `return texelFetch(uTextures[${i}], px, 0);`)}
}

vec4 fetchLut(ivec2 px) {
${textureChain(maxTextures, 'lutSlot', (i) => `return texelFetch(uTextures[${i}], px, 0);`)}
}

// A paletted texel's red is its palette index, read exactly (an interpolated index names another colour).
vec3 paletteColour(float red) {
  return fetchLut(ivec2(int(floor(red * PALETTE_INDEX_MAX + 0.5)), lutRow)).rgb;
}

// The frame boundary is transparent, not the packed neighbour a two-texel tap could reach. A paletted
// texel resolves its colour first, so the magnifiers blend colours, never indices.
vec4 frameTexel(ivec2 px) {
  vec2 uv = (vec2(px) + 0.5) / texSize;
  if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) return vec4(0.0);
  vec4 texel = fetchTexel(px);
  return paletted ? vec4(paletteColour(texel.r) * texel.a, texel.a) : texel;
}

#define MAGNIFY_FETCH(px) frameTexel(px)
/** Each of the four minification taps sits a quarter of the footprint out from the sample point, and
 *  they average evenly: four taps cannot cover more, so the spread stops there. */
const float MINIFY_TAP_OFFSET = 0.25;
const float MINIFY_TAP_WEIGHT = 0.25;
${PIXEL_ART_MAGNIFY_GLSL}

// A paletted element samples its nearest texel with magnification off; otherwise every tap resolves
// its colour before the blend, since the page itself cannot be filtered.
vec4 palettedColour(vec2 p, float texelsPerPixel, vec2 uvFootprint) {
  if (WORLD_MAGNIFY < 0.5) {
    vec4 texel = sampleTexture(vUV);
    return vec4(paletteColour(texel.r) * texel.a, texel.a);
  }
  if (texelsPerPixel < 1.0 && WORLD_MAGNIFY > 1.5) {
    return WORLD_MAGNIFY > 2.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
  }
  vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
  if (max(footprint.x, footprint.y) < PALETTED_MIN_FOOTPRINT) return magnifyBilinear(p);
  return MINIFY_TAP_WEIGHT * (magnifyBilinear((vUV - footprint) * texSize)
                   + magnifyBilinear((vUV + vec2(footprint.x, -footprint.y)) * texSize)
                   + magnifyBilinear((vUV + vec2(-footprint.x, footprint.y)) * texSize)
                   + magnifyBilinear((vUV + footprint) * texSize));
}

void main(void) {
  texSize = vec2(textureSizeOf());
  flags = int(vFlags);
  paletted = hasFlag(WORLD_FLAG_PALETTED);
  lutSlot = float((flags >> WORLD_LUT_SLOT_SHIFT) & WORLD_LUT_SLOT_MASK);
  lutRow = flags >> WORLD_LUT_ROW_SHIFT;
  // Derivatives before any branch: they are only defined in uniform control flow.
  vec2 p = vUV * texSize;
  float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
  vec2 uvFootprint = fwidth(vUV);
  vec4 outColor;
  if (paletted) {
    outColor = palettedColour(p, texelsPerPixel, uvFootprint);
    if (hasFlag(WORLD_FLAG_GLOW)) {
      outColor = vec4(paletteColour(GLOW_PALETTE_INDEX / PALETTE_INDEX_MAX), 1.0) * outColor.a;
    }
  } else if (!hasFlag(WORLD_FLAG_MAGNIFY) || WORLD_MAGNIFY < 0.5) {
    outColor = sampleTexture(vUV);
  } else if (texelsPerPixel < 1.0) {
    outColor = WORLD_MAGNIFY > 2.5 ? magnifyXbr(p, texelsPerPixel)
             : WORLD_MAGNIFY > 1.5 ? magnifySharp(p, texelsPerPixel)
             : sampleTexture(vUV);
  } else {
    // Minified: a 2x2 footprint over the sampler's own filter reduces sparkle, clamped to the frame.
    // Not a mipmap substitute at extreme zoom-out: sampling cost is deliberately bounded.
    vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
    vec2 low = vFrame.xy + 0.5 / texSize;
    vec2 high = vFrame.zw - 0.5 / texSize;
    outColor = MINIFY_TAP_WEIGHT * (sampleTexture(clamp(vUV - footprint, low, high))
                     + sampleTexture(clamp(vUV + vec2(footprint.x, -footprint.y), low, high))
                     + sampleTexture(clamp(vUV + vec2(-footprint.x, footprint.y), low, high))
                     + sampleTexture(clamp(vUV + footprint, low, high)));
  }
  if (vSelection < 0.0) {
    finalColor = vec4(vColor.rgb * outColor.a, vColor.a * outColor.a);
    return;
  }
  ${shading.output}
  finalColor.rgb = mix(finalColor.rgb, vec3(finalColor.a), max(0.0, vSelection));
}`;
}
