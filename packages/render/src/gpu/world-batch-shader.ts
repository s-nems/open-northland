import { PIXEL_ART_MAGNIFY_GLSL } from './pixel-art-magnify.js';
import { type ShadowStyle, shadowTintChannels } from './shadow-style.js';

/** `aFlags` bits: what the fragment shader must know about the element's texture. They share one float
 *  rather than growing every world vertex by another attribute. */
export const WORLD_FLAG_MAGNIFY = 1;
export const WORLD_FLAG_SHADOW = 2;
/** The element's page is palette-indexed: the batch's LUT slot holds the palette, and the flags above
 *  the bits here hold its LUT row. */
export const WORLD_FLAG_PALETTED = 4;
/** A paletted element drawn as its row's {@link GLOW_PALETTE_INDEX} colour over its coverage alone. */
export const WORLD_FLAG_GLOW = 8;
/** A paletted element's LUT row, from `aFlags` bit 4 up; a float32 holds it exactly below 2^20 rows. */
export const WORLD_LUT_ROW_SHIFT = 4;
/**
 * The palette index a hero's glow takes its colour from: step 10 of the team ramp in the body palette's
 * vest band (160-175), which each player's team row of the human LUT carries. Original behavior: the glow
 * colour is that step of the owner's `Player NN` ramp.
 */
export const GLOW_PALETTE_INDEX = 170;
/** Texture slots each batch keeps free for the palette LUT its paletted elements read. */
export const LUT_SLOTS = 1;
/** Slots the batch program is compiled for at most; Pixi passes the device's limit, which desktop GL
 *  reports above this, and the shader catalogue compiles each limit the game can select. */
export const WORLD_BATCH_MAX_TEXTURES = 32;
/** The batch slot a paletted element's LUT is bound at: the last one, whatever the batch's page count,
 *  so the palette lookup indexes a constant sampler instead of walking the page chain. */
export const lutSlotOf = (maxTextures: number): number => maxTextures - LUT_SLOTS;
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
const int WORLD_LUT_ROW_SHIFT = ${WORLD_LUT_ROW_SHIFT};
const int LUT_SLOT = ${lutSlotOf(maxTextures)};
// One texel per 8-bit palette index across a LUT row.
const float PALETTE_INDEX_MAX = 255.0;
// Below this uv footprint a paletted sample is magnified, so the minification taps would coincide.
const float PALETTED_MIN_FOOTPRINT = 0.000001;
/** Each of the four minification taps sits a quarter of the footprint out from the sample point, and
 *  they average evenly: four taps cannot cover more, so the spread stops there. */
const float MINIFY_TAP_OFFSET = 0.25;
const float MINIFY_TAP_WEIGHT = 0.25;${shading.declarations}
// Resolved once per fragment: the bound page's size, the element's flags and its palette row.
vec2 texSize;
int flags;
bool paletted;
int lutRow;

// The texels one fragment blends, read in one pass over the sampler chain: the magnifiers' 4x4 window
// around the sample point, or the four 2x2 windows of a paletted element's minification taps. A tap
// outside the element's frame is transparent, and a paletted tap resolves its colour before any blend,
// so the magnifiers blend colours, never indices.
const int TAP_COUNT = 16;
const int WINDOW_SIDE = 4;
const int SUB_WINDOW_TAPS = 4;
ivec2 tapAt[TAP_COUNT];
vec4 taps[TAP_COUNT];
ivec2 windowOrigin;
ivec2 windowStep;

bool hasFlag(int bit) {
  return (flags & bit) != 0;
}

vec4 sampleTexture(vec2 uv) {
${textureChain(maxTextures, 'vTextureId', (i) => `return texture(uTextures[${i}], uv);`)}
}

ivec2 textureSizeOf() {
${textureChain(maxTextures, 'vTextureId', (i) => `return textureSize(uTextures[${i}], 0);`)}
}

// Direct3D inlines every function into each branch it is called from, so the page is chosen once per
// fragment and the one chain reads every tap; a tap-by-tap chain compiled for minutes there.
void fetchTaps() {
${textureChain(maxTextures, 'vTextureId', (i) => `for (int k = 0; k < TAP_COUNT; k++) taps[k] = texelFetch(uTextures[${i}], tapAt[k], 0);`)}
}

// A paletted texel's red is its palette index, read exactly (an interpolated index names another colour).
vec3 paletteColour(float red) {
  return texelFetch(uTextures[LUT_SLOT], ivec2(int(floor(red * PALETTE_INDEX_MAX + 0.5)), lutRow), 0).rgb;
}

void gatherTaps() {
  fetchTaps();
  for (int k = 0; k < TAP_COUNT; k++) {
    vec2 uv = (vec2(tapAt[k]) + 0.5) / texSize;
    if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) {
      taps[k] = vec4(0.0);
    } else if (paletted) {
      taps[k] = vec4(paletteColour(taps[k].r) * taps[k].a, taps[k].a);
    }
  }
}

// The window's texel at px, which the magnifiers address relative to the sample point's texel.
vec4 windowTexel(ivec2 px) {
  ivec2 d = (px - windowOrigin) * windowStep;
  return taps[d.y * WINDOW_SIDE + d.x];
}

#define MAGNIFY_FETCH(px) windowTexel(px)
${PIXEL_ART_MAGNIFY_GLSL}

// Lays the 4x4 window out from centre - step along the magnifiers' own step, so windowTexel finds
// every texel xBR, sharp and bilinear read for p.
void layoutWindow(vec2 p) {
  windowStep = magnifyWindowStep(fract(p));
  windowOrigin = ivec2(floor(p)) - windowStep;
  for (int k = 0; k < TAP_COUNT; k++) {
    tapAt[k] = windowOrigin + windowStep * ivec2(k % WINDOW_SIDE, k / WINDOW_SIDE);
  }
}

// A 2x2 window at p's bilinear base, in the order blendTaps reads it.
void layoutBilinearTaps(int first, vec2 p) {
  ivec2 base = ivec2(floor(p - 0.5));
  tapAt[first] = base;
  tapAt[first + 1] = base + ivec2(1, 0);
  tapAt[first + 2] = base + ivec2(0, 1);
  tapAt[first + 3] = base + ivec2(1, 1);
}

// The bilinear blend of a 2x2 window, weighted as magnifyBlend weights its taps.
vec4 blendTaps(int first, vec2 p) {
  vec2 f = fract(p - 0.5);
  return mix(mix(taps[first], taps[first + 1], f.x),
             mix(taps[first + SUB_WINDOW_TAPS / 2], taps[first + SUB_WINDOW_TAPS / 2 + 1], f.x), f.y);
}

void main(void) {
  texSize = vec2(textureSizeOf());
  flags = int(vFlags);
  paletted = hasFlag(WORLD_FLAG_PALETTED);
  lutRow = flags >> WORLD_LUT_ROW_SHIFT;
  // Derivatives before any branch: they are only defined in uniform control flow.
  vec2 p = vUV * texSize;
  float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
  vec2 uvFootprint = fwidth(vUV);
  bool magnified = texelsPerPixel < 1.0;
  // A paletted element always resolves through its LUT; a plain one only when its page is magnified.
  bool filtered = WORLD_MAGNIFY > 0.5 && (paletted || hasFlag(WORLD_FLAG_MAGNIFY));
  vec4 outColor;
  if (!filtered || (!paletted && magnified && WORLD_MAGNIFY < 1.5)) {
    vec4 texel = sampleTexture(vUV);
    outColor = paletted ? vec4(paletteColour(texel.r) * texel.a, texel.a) : texel;
  } else if (!paletted && !magnified) {
    // Minified: a 2x2 footprint over the sampler's own filter reduces sparkle, clamped to the frame.
    // Not a mipmap substitute at extreme zoom-out: sampling cost is deliberately bounded.
    vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
    vec2 low = vFrame.xy + 0.5 / texSize;
    vec2 high = vFrame.zw - 0.5 / texSize;
    outColor = MINIFY_TAP_WEIGHT * (sampleTexture(clamp(vUV - footprint, low, high))
                     + sampleTexture(clamp(vUV + vec2(footprint.x, -footprint.y), low, high))
                     + sampleTexture(clamp(vUV + vec2(-footprint.x, footprint.y), low, high))
                     + sampleTexture(clamp(vUV + footprint, low, high)));
  } else {
    // The magnifiers' window, or a paletted element's bilinear taps: with magnification off for its
    // page size, one 2x2 at the sample point, else four spread over the minified footprint.
    bool window = magnified && WORLD_MAGNIFY > 1.5;
    vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
    bool single = max(footprint.x, footprint.y) < PALETTED_MIN_FOOTPRINT;
    vec2 p0 = (vUV - footprint) * texSize;
    vec2 p1 = (vUV + vec2(footprint.x, -footprint.y)) * texSize;
    vec2 p2 = (vUV + vec2(-footprint.x, footprint.y)) * texSize;
    vec2 p3 = (vUV + footprint) * texSize;
    if (window) {
      layoutWindow(p);
    } else if (single) {
      // The unused taps read the same texels, so the one chain pass stays a fixed 16 fetches.
      for (int first = 0; first < TAP_COUNT; first += SUB_WINDOW_TAPS) layoutBilinearTaps(first, p);
    } else {
      layoutBilinearTaps(0, p0);
      layoutBilinearTaps(SUB_WINDOW_TAPS, p1);
      layoutBilinearTaps(2 * SUB_WINDOW_TAPS, p2);
      layoutBilinearTaps(3 * SUB_WINDOW_TAPS, p3);
    }
    gatherTaps();
    if (window) {
      outColor = WORLD_MAGNIFY > 2.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
    } else if (single) {
      outColor = blendTaps(0, p);
    } else {
      outColor = MINIFY_TAP_WEIGHT * (blendTaps(0, p0)
                       + blendTaps(SUB_WINDOW_TAPS, p1)
                       + blendTaps(2 * SUB_WINDOW_TAPS, p2)
                       + blendTaps(3 * SUB_WINDOW_TAPS, p3));
    }
  }
  if (paletted && hasFlag(WORLD_FLAG_GLOW)) {
    outColor = vec4(paletteColour(GLOW_PALETTE_INDEX / PALETTE_INDEX_MAX), 1.0) * outColor.a;
  }
  if (vSelection < 0.0) {
    finalColor = vec4(vColor.rgb * outColor.a, vColor.a * outColor.a);
    return;
  }
  ${shading.output}
  finalColor.rgb = mix(finalColor.rgb, vec3(finalColor.a), max(0.0, vSelection));
}`;
}
