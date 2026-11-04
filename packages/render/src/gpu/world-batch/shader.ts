import { GLOW_PALETTE_INDEX } from '../../data/palettes/glow-colour.js';
import { BLOOD_COAT_GLSL } from '../blood/coat-shader.js';
import { BLOOD_SURFACE_GLSL } from '../blood/surface-shader.js';
import { PIXEL_ART_MAGNIFY_CORE_GLSL, XBR_NEIGHBOURS } from '../pixel-art/magnify.js';
import { PRESCALE_FACTOR } from '../pixel-art/prescale-pass.js';
import { WORLD_MAGNIFY_MODES, worldMagnifyModeName } from '../pixel-art/registry.js';
import { LIFT_COLOURS_GLSL } from '../selection/style.js';
import type { GlslProgramSource } from '../shaders/program-source.js';
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
/** The element's page is in the indexed layout: palette index in red, coverage in green, opaque. A
 *  paletted element's page always is; an unpaletted one draws its coverage alone, as black. */
export const WORLD_FLAG_INDEXED = 16;
/** The element's page has mipmaps, so a sample needs its level from the uv derivatives. */
export const WORLD_FLAG_MIPMAPPED = 32;
/**
 * A paletted element whose page is a recoloured stem's shared sheet, sampled nearest. It takes the plain
 * page's path (filtered only when marked magnified, minification taps resolved before they blend,
 * magnified through xBR), and on the unmagnified paths premultiplies in bytes, round(c * a / 255), the
 * bytes createImageBitmap's premultiply gives an RGBA page of the stem.
 */
export const WORLD_FLAG_RECOLOURED = 64;
/** A paletted element's LUT row, from `aFlags` bit 7 up; a float32 holds it exactly below 2^17 rows. */
export const WORLD_LUT_ROW_SHIFT = 7;
/** `aSelection` values that draw a selection outline in its colour over the body's coverage alone: an
 *  offset copy of the body, or one quad grown past the body that gathers its coverage at every
 *  {@link OUTLINE_DIRECTIONS} offset. */
export const SELECTION_STAMP = -1;
export const SELECTION_OUTLINE = -2;
/**
 * `aNight`: how lit an element shows in the night's lit mask (see `lighting/night-mask.ts`), 0 unlit up
 * to 1 a light-bearer's full share. From {@link NIGHT_FALL_BAND} up the share fades from full at the
 * frame's foot to {@link NIGHT_FALL_TOP} over its upper part: a building, lit low and dark at the roof.
 * Approximation: the fade runs over each layer's own frame, so a house drawn as several layers fades
 * once per layer.
 */
export const NIGHT_FALL_BAND = 2;
/** Approximation tuned by eye: the share of a building's light left at its frame's top, and the frame
 *  heights (0 top, 1 foot) the fade runs between. */
const NIGHT_FALL_TOP = 0.1;
const NIGHT_FALL_FROM = 0.2;
const NIGHT_FALL_TO = 0.85;
/** A non-negative `aSelection` packs a lift: the tone code times this band plus the lift's amount, 0..1. */
export const SELECTION_TONE_BAND = 2;
const DIAGONAL = Math.SQRT1_2;
/** The unit offsets an outline spreads the body's coverage along, scaled by the outline's reach. */
export const OUTLINE_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [DIAGONAL, DIAGONAL],
  [-DIAGONAL, DIAGONAL],
  [DIAGONAL, -DIAGONAL],
  [-DIAGONAL, -DIAGONAL],
] as const;
/** Texture slots each batch keeps free for the palette LUT its paletted elements read. */
export const LUT_SLOTS = 1;
/** Slots the batch program is compiled for at most; Pixi passes the device's limit, which desktop GL
 *  reports above this, and the shader catalogue compiles each limit the game can select. */
export const WORLD_BATCH_MAX_TEXTURES = 32;
/** The batch slot a paletted element's LUT is bound at: the last one, whatever the batch's page count,
 *  so the palette lookup indexes a constant sampler instead of walking the page chain. */
export const lutSlotOf = (maxTextures: number): number => maxTextures - LUT_SLOTS;
/** The world batch program: one fragment variant per magnification mode, shadow style and sampling. */
export const WORLD_BATCH_VERTEX = /* glsl */ `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aUV;
in vec4 aColor;
in vec2 aTextureIdAndRound;
in float aFlags;
in vec4 aFrame;
in float aSelection;
in float aBlood;
in vec4 aSplashes;
in float aNight;
out vec4 vColor;
out vec2 vUV;
flat out float vTextureId;
flat out float vFlags;
flat out vec4 vFrame;
flat out float vSelection;
flat out float vBlood;
flat out vec4 vSplashes;
flat out float vNight;
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
  vBlood = aBlood;
  vSplashes = aSplashes;
  vNight = aNight;
  gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  if (aTextureIdAndRound.x == 1.0) {
    gl_Position.xy = (floor(((gl_Position.xy * 0.5 + 0.5) * uResolution) + 0.5) / uResolution) * 2.0 - 1.0;
  }
}`;

/**
 * GLSL ES 3.0 indexes sampler arrays only by constants, so every lookup picks its slot from the float
 * `slot` expression through a switch: over the same reads, an if-chain that nests each slot one level
 * deeper took Direct3D's compiler twice as long (11 s against 5 s for the 16-slot xBR program).
 */
function textureChain(maxTextures: number, slot: string, call: (index: number) => string): string {
  const cases = Array.from(
    { length: maxTextures },
    (_, i) => `    ${i < maxTextures - 1 ? `case ${i}:` : 'default:'} { ${call(i)} } break;`,
  );
  return [`  switch (int(${slot} + 0.5)) {`, ...cases, '  }'].join('\n');
}

/** Taps in one 2x2 window. */
const SUB_WINDOW_TAPS = 4;
/** A paletted element's minification reads four 2x2 windows, one at each corner of its footprint. */
const MINIFY_CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

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
    output: /* glsl */ `if (hasFlag(flags, WORLD_FLAG_SHADOW)) {
    float shadowAlpha = min(outColor.a * SHADOW_ALPHA_GAIN, SHADOW_MAX_ALPHA) * vColor.a;
    finalColor = vec4(SHADOW_TINT * shadowAlpha, shadowAlpha);
  } else {
    finalColor = outColor * vColor;
  }`,
  };
}

/**
 * Whether a program magnifies: `unmagnified` leaves out xBR and the sharp path, for draws in which
 * every page holds at least `MAGNIFIED_BELOW` texels per screen pixel. It draws those exactly as the
 * full program does, and its smaller register footprint lets every fragment run faster (Intel UHD 770
 * on Direct3D 11 measured it).
 */
export type WorldBatchSampling = 'magnifying' | 'unmagnified';

/** The batch program for a texture limit, magnification mode, shadow style and sampling. */
export function worldBatchProgramSource(
  maxTextures: number,
  mode: number,
  shadow: ShadowStyle | null,
  sampling: WorldBatchSampling,
): GlslProgramSource {
  const variant = sampling === 'unmagnified' ? '/unmagnified' : '';
  return {
    name: `world-batch/textures${maxTextures}/${worldMagnifyModeName(mode) ?? mode}/${shadow === null ? 'no-shadow' : 'shadow'}${variant}`,
    vertex: WORLD_BATCH_VERTEX,
    fragment: worldBatchFragment(maxTextures, mode, shadow, sampling),
  };
}

/** The prescaled program reads which slots hold a twin, so a frame keeps its page's texel scale. */
const TWIN_SLOTS_GLSL = /* glsl */ `
// One bit per slot that holds a prescaled twin, set per draw; highp holds all 32 slots.
uniform highp int uTwinSlots;
const float PRESCALE_FACTOR = ${glslFloat(PRESCALE_FACTOR)};
// Twin texels per page texel in this fragment's slot.
float pageTexelScale() {
  return ((uTwinSlots >> int(vTextureId + 0.5)) & 1) == 1 ? PRESCALE_FACTOR : 1.0;
}`;

/**
 * A filtered body's 2x2 windows, read one at a time so only one window's taps are live: one at the sample
 * point (bilinear at a texel per pixel, or sharp magnification when `sharp`), else one at each corner of
 * the minified footprint, summed in a fixed order and averaged.
 */
function windowGather(maxTextures: number, sampling: WorldBatchSampling): string {
  const one = sampling === 'magnifying' ? 'sharp || single' : 'single';
  const weights =
    sampling === 'magnifying'
      ? 'sharp ? magnifySharpWeights(p, texelsPerPixel) : fract(at - 0.5)'
      : 'fract(at - 0.5)';
  return /* glsl */ `    bool one = ${one};
    int windows = one ? 1 : MINIFY_WINDOWS;
    vec4 sum = vec4(0.0);
    for (int w = 0; w < MINIFY_WINDOWS; w++) {
      if (w >= windows) break;
      vec2 at = one ? p : (vUV + footprint * MINIFY_CORNERS[w]) * texSize;
      ivec2 base = ivec2(floor(at - 0.5));
      vec4 taps[SUB_WINDOW_TAPS];
      // Direct3D inlines every function into each branch it is called from, so the page is chosen once
      // per window and this one chain reads its taps; a tap-by-tap chain compiled for minutes there.
${textureChain(maxTextures, 'vTextureId', (i) => `for (int k = 0; k < SUB_WINDOW_TAPS; k++) taps[k] = texelFetch(uTextures[${i}], base + WINDOW_OFFSETS[k], 0);`)}
      // Resolved at literal indices, which measured faster than a loop.
${Array.from({ length: SUB_WINDOW_TAPS }, (_, k) => `      taps[${k}] = resolvedTap(taps[${k}], base + WINDOW_OFFSETS[${k}], texSize, indexed, paletted, lutRow);`).join('\n')}
      vec2 f = ${weights};
      sum += mix(mix(taps[0], taps[1], f.x), mix(taps[2], taps[3], f.x), f.y);
    }
    outColor = one ? sum : MINIFY_TAP_WEIGHT * sum;`;
}

/** xBR's window around the corner of p nearest the fragment, read in one pass over the chain; only an
 *  edge corner resolves its outer eight taps. */
function xbrGather(maxTextures: number): string {
  return /* glsl */ `    ivec2 centre = ivec2(floor(p));
    ivec2 windowStep = magnifyWindowStep(fract(p));
    vec4 taps[XBR_TAPS];
${textureChain(maxTextures, 'vTextureId', (i) => `for (int k = 0; k < XBR_TAPS; k++) taps[k] = texelFetch(uTextures[${i}], centre + windowStep * XBR_OFFSETS[k], 0);`)}
${Array.from({ length: SUB_WINDOW_TAPS }, (_, k) => `    taps[${k}] = resolvedTap(taps[${k}], centre + windowStep * XBR_OFFSETS[${k}], texSize, indexed, paletted, lutRow);`).join('\n')}
    outColor = windowSharp(taps[0], taps[1], taps[2], taps[3], p, texelsPerPixel, windowStep);
    if (!magnifyXbrKeepsBase(taps[0], taps[1], taps[2])) {
      for (int k = SUB_WINDOW_TAPS; k < XBR_TAPS; k++) {
        taps[k] = resolvedTap(taps[k], centre + windowStep * XBR_OFFSETS[k], texSize, indexed, paletted, lutRow);
      }
      XbrNeighbours n = XbrNeighbours(${XBR_NEIGHBOURS.map((_, k) => `taps[${k}]`).join(', ')});
      outColor = magnifyXbrCorner(n, outColor, p, texelsPerPixel);
    }`;
}

/** The filtered body's gather: xBR's window, or the 2x2 windows. The unmagnified program has no xBR,
 *  so its largest live set is one window's four taps. */
function filteredGather(maxTextures: number, sampling: WorldBatchSampling): string {
  if (sampling === 'unmagnified') return windowGather(maxTextures, sampling);
  return /* glsl */ `    bool xbr = magnified && (WORLD_MAGNIFY == MAGNIFY_XBR || paletted);
    bool sharp = magnified && !xbr;
    if (xbr) {
${xbrGather(maxTextures).replace(/^/gm, '  ')}
    } else {
${windowGather(maxTextures, sampling).replace(/^/gm, '  ')}
    }`;
}

export function worldBatchFragment(
  maxTextures: number,
  mode: number,
  shadow: ShadowStyle | null,
  sampling: WorldBatchSampling,
): string {
  const shading = shadowShadingGlsl(shadow);
  const prescaled = mode === WORLD_MAGNIFY_MODES.prescaled;
  const magnifies = sampling === 'magnifying';
  const gather = filteredGather(maxTextures, sampling);
  return /* glsl */ `#version 300 es
precision highp float;
// A fragment int defaults to mediump, which Mesa radeonsi runs in 16 bits: the LUT row and the byte
// premultiply (up to 255 * 255) overflow there and paletted decor draws black.
precision highp int;
in vec4 vColor;
in vec2 vUV;
flat in float vTextureId;
flat in float vFlags;
flat in vec4 vFrame;
flat in float vSelection;
flat in float vBlood;
flat in vec4 vSplashes;
flat in float vNight;
layout(location = 0) out vec4 finalColor;
// The night's lit mask in red, blended as the colour is; a target without it drops the write.
layout(location = 1) out vec4 nightLit;
uniform sampler2D uTextures[${maxTextures}];
// Each listed page's size in texels, set per draw.
uniform vec2 uPageSizes[${maxTextures}];
// 0 off (Pixi's default sampling) / 3 xbr / 4 prescaled: plain pages arrive at twice their texels and
// magnify sharp, paletted ones take xbr
const float WORLD_MAGNIFY = ${mode}.0;
const float MAGNIFY_XBR = ${WORLD_MAGNIFY_MODES.xbr}.0;
${prescaled ? TWIN_SLOTS_GLSL : ''}
const int WORLD_FLAG_MAGNIFY = ${WORLD_FLAG_MAGNIFY};
const int WORLD_FLAG_SHADOW = ${WORLD_FLAG_SHADOW};
const int WORLD_FLAG_PALETTED = ${WORLD_FLAG_PALETTED};
const int WORLD_FLAG_GLOW = ${WORLD_FLAG_GLOW};
const int WORLD_FLAG_INDEXED = ${WORLD_FLAG_INDEXED};
const int WORLD_FLAG_MIPMAPPED = ${WORLD_FLAG_MIPMAPPED};
const int WORLD_FLAG_RECOLOURED = ${WORLD_FLAG_RECOLOURED};
const float GLOW_PALETTE_INDEX = ${GLOW_PALETTE_INDEX}.0;
const int WORLD_LUT_ROW_SHIFT = ${WORLD_LUT_ROW_SHIFT};
const int LUT_SLOT = ${lutSlotOf(maxTextures)};
// One texel per 8-bit palette index across a LUT row.
const float PALETTE_INDEX_MAX = 255.0;
// Added before the integer divide by 255, so the divide rounds to nearest.
const int BYTE_ROUNDING_BIAS = 127;
const int BYTE_MAX = 255;
// Below this uv footprint the four minification taps nearly coincide, under 0.01 texel apart, so one
// tap stands for them: at worst about 1/255 off at a hard edge within a hair of one texel per pixel.
const float SINGLE_TAP_FOOTPRINT = 0.000001;
/** Each of the four minification taps sits a quarter of the footprint out from the sample point, and
 *  they average evenly: four taps cannot cover more, so the spread stops there. */
const float MINIFY_TAP_OFFSET = 0.25;
const float MINIFY_TAP_WEIGHT = 0.25;
const float SELECTION_OUTLINE = ${SELECTION_OUTLINE}.0;
const float NIGHT_FALL_BAND = ${glslFloat(NIGHT_FALL_BAND)};
const float NIGHT_FALL_TOP = ${glslFloat(NIGHT_FALL_TOP)};
const float NIGHT_FALL_FROM = ${glslFloat(NIGHT_FALL_FROM)};
const float NIGHT_FALL_TO = ${glslFloat(NIGHT_FALL_TO)};
const float SELECTION_TONE_BAND = ${SELECTION_TONE_BAND}.0;
${LIFT_COLOURS_GLSL}
// An outline quad reads the body's coverage where each offset copy would draw this fragment;
// vSplashes carries the uv step per unit offset in x and y.
const int OUTLINE_TAPS = ${OUTLINE_DIRECTIONS.length};
const vec2 OUTLINE_DIRECTIONS[OUTLINE_TAPS] = vec2[OUTLINE_TAPS](${OUTLINE_DIRECTIONS.map(([x, y]) => `vec2(${glslFloat(x)}, ${glslFloat(y)})`).join(', ')});${shading.declarations}
${BLOOD_COAT_GLSL}
${BLOOD_SURFACE_GLSL}
// The texels one fragment blends: xBR's neighbourhood of the sample point's corner, or 2x2 windows read
// one at a time. A tap outside the element's frame is transparent, and an indexed tap resolves its
// colour before any blend, so the magnifiers blend colours, never indices. The taps and the rest of the
// per-fragment state are locals of main: as globals, which ANGLE gathers into one struct passed by
// reference to every function, the program measured slower on Metal for every fragment it draws,
// gathering or not. Live taps cost registers in every fragment too: one 16-tap array shared by every path
// measured slower on Intel UHD 770 and Apple M2 than xBR's 12 and one 2x2 window at a time.
// The fetches stay loops: spelled out in full they multiplied the compile time.
const int SUB_WINDOW_TAPS = ${SUB_WINDOW_TAPS};
const ivec2 WINDOW_OFFSETS[SUB_WINDOW_TAPS] = ivec2[SUB_WINDOW_TAPS](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));
const int MINIFY_WINDOWS = ${MINIFY_CORNERS.length};
const vec2 MINIFY_CORNERS[MINIFY_WINDOWS] = vec2[MINIFY_WINDOWS](${MINIFY_CORNERS.map(([x, y]) => `vec2(${x}.0, ${y}.0)`).join(', ')});
const int XBR_TAPS = ${XBR_NEIGHBOURS.length};
// xBR's window in XbrNeighbours order, along the magnifiers' own mirroring step.
const ivec2 XBR_OFFSETS[XBR_TAPS] = ivec2[XBR_TAPS](${XBR_NEIGHBOURS.map(([, dx, dy]) => `ivec2(${dx}, ${dy})`).join(', ')});

bool hasFlag(int flags, int bit) {
  return (flags & bit) != 0;
}

// Every read through this chain passes the fragment's own uv derivatives, taken in main before any
// branch, so mipmapped world art still picks its level (mode off reads other pages at level 0). A sample with implicit derivatives inside this chain may make
// Direct3D's compiler hoist it out of the branches and fetch from every slot.
vec4 sampleTexture(vec2 uv, vec2 uvDx, vec2 uvDy) {
${textureChain(maxTextures, 'vTextureId', (i) => `return textureGrad(uTextures[${i}], uv, uvDx, uvDy);`)}
}

// A page without mipmaps has one level, and its min and mag filters match, so level 0 reads what
// textureGrad would without the gradient sample's cost (Intel UHD 770 on Direct3D 11 measured it).
vec4 sampleLevelZero(vec2 uv) {
${textureChain(maxTextures, 'vTextureId', (i) => `return textureLod(uTextures[${i}], uv, 0.0);`)}
}

// The fragment's page size in texels, from the per-draw list: a size query through the sampler chain
// cost every fragment more (Intel UHD 770 on Direct3D 11 measured it).
vec2 pageSize() {
  return uPageSizes[int(vTextureId + 0.5)];
}

vec2 outlineUV(int k) {
  return vUV - OUTLINE_DIRECTIONS[k].x * vSplashes.xy - OUTLINE_DIRECTIONS[k].y * vSplashes.zw;
}

// A paletted texel's red is its palette index, read exactly (an interpolated index names another colour).
vec3 paletteColour(float red, int lutRow) {
  return texelFetch(uTextures[LUT_SLOT], ivec2(int(floor(red * PALETTE_INDEX_MAX + 0.5)), lutRow), 0).rgb;
}

// A texel as drawn, premultiplied: an indexed one takes its coverage from green, and its colour from the
// LUT when paletted, else black.
vec4 drawnTexel(vec4 tap, bool indexed, bool paletted, int lutRow) {
  if (!indexed) return tap;
  return vec4(paletted ? paletteColour(tap.r, lutRow) * tap.g : vec3(0.0), tap.g);
}

// A recoloured texel premultiplied in bytes, round(c * a / 255) per channel. Only the unmagnified paths
// take it: Direct3D inlines the gather's resolve at every tap, where it cost about a quarter more compile
// time per program. Magnified xBR reads the unrounded c * a, and its edge test branches on those taps,
// so at zoom 2 a partially covered texel can differ from an RGBA page by up to about 40/255.
vec4 recolouredTexel(vec4 tap, int lutRow) {
  int coverage = int(tap.g * PALETTE_INDEX_MAX + 0.5);
  ivec3 bytes = ivec3(paletteColour(tap.r, lutRow) * PALETTE_INDEX_MAX + 0.5);
  return vec4(vec3((bytes * coverage + BYTE_ROUNDING_BIAS) / BYTE_MAX) / PALETTE_INDEX_MAX, tap.g);
}

// A tap outside the element's frame is transparent; an indexed tap resolves its colour here.
vec4 resolvedTap(vec4 tap, ivec2 at, vec2 texSize, bool indexed, bool paletted, int lutRow) {
  vec2 uv = (vec2(at) + 0.5) / texSize;
  if (any(lessThan(uv, vFrame.xy)) || any(greaterThanEqual(uv, vFrame.zw))) return vec4(0.0);
  return drawnTexel(tap, indexed, paletted, lutRow);
}

${PIXEL_ART_MAGNIFY_CORE_GLSL}

// magnifySharp over the window's 2x2 e, f, h and i, which run against the texel axes along a negative
// step, so the blend takes them in reverse there.
vec4 windowSharp(vec4 e, vec4 f, vec4 h, vec4 i, vec2 p, float texelsPerPixel, ivec2 windowStep) {
  vec2 w = magnifySharpWeights(p, texelsPerPixel);
  bvec2 forward = greaterThan(windowStep, ivec2(0));
  vec4 top = forward.x ? mix(e, f, w.x) : mix(f, e, w.x);
  vec4 bottom = forward.x ? mix(h, i, w.x) : mix(i, h, w.x);
  return forward.y ? mix(top, bottom, w.y) : mix(bottom, top, w.y);
}

void main(void) {
  vec2 texSize = vec2(0.0);
  vec2 p = vec2(0.0);
  float texelsPerPixel = 0.0;
  vec2 uvFootprint = vec2(0.0);
  // Derivatives before any branch, where they are defined; mode off needs the page size only for a
  // splash below. The condition is a compile-time constant.
  vec2 uvDx = dFdx(vUV);
  vec2 uvDy = dFdy(vUV);
  if (WORLD_MAGNIFY > 0.5) {
    texSize = pageSize();
    p = vUV * texSize;
    texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
    uvFootprint = fwidth(vUV);
  }
  int flags = int(vFlags);
  bool indexed = hasFlag(flags, WORLD_FLAG_INDEXED);
  // A selection effect leaves the lit mask as its body left it.
  nightLit = vec4(0.0);
  if (vSelection < 0.0) {
    // A selection outline draws its colour over the body's coverage alone, which plain taps give: no
    // palette, magnifier or minification taps. On a magnified (linearly filtered) page a tap stays half
    // a texel inside the frame, as the body's gather does, so no neighbour bleeds in.
    vec2 stampLow = WORLD_MAGNIFY > 0.5 ? vFrame.xy + 0.5 / texSize : vFrame.xy;
    vec2 stampHigh = WORLD_MAGNIFY > 0.5 ? vFrame.zw - 0.5 / texSize : vFrame.zw;
    if (vSelection < SELECTION_OUTLINE + 0.5) {
      // The union of the offset copies blended over one another: a copy covers this fragment only
      // where its quad, the body's frame moved by its offset, does.
      vec2 tapUV[OUTLINE_TAPS];
      for (int k = 0; k < OUTLINE_TAPS; k++) {
        vec2 uv = outlineUV(k);
        tapUV[k] = WORLD_MAGNIFY > 0.5 ? clamp(uv, stampLow, stampHigh) : uv;
      }
      // The page is chosen once for all the taps, as the body's gather does.
      float coverage[OUTLINE_TAPS];
${textureChain(maxTextures, 'vTextureId', (i) => `for (int k = 0; k < OUTLINE_TAPS; k++) { vec4 texel = textureGrad(uTextures[${i}], tapUV[k], uvDx, uvDy); coverage[k] = indexed ? texel.g : texel.a; }`)}
      float uncovered = 1.0;
      for (int k = 0; k < OUTLINE_TAPS; k++) {
        vec2 uv = outlineUV(k);
        bool inside = all(greaterThanEqual(uv, vFrame.xy)) && all(lessThan(uv, vFrame.zw));
        uncovered *= 1.0 - (inside ? vColor.a * coverage[k] : 0.0);
      }
      float alpha = 1.0 - uncovered;
      finalColor = vColor.a > 0.0 ? vec4(vColor.rgb * (alpha / vColor.a), alpha) : vec4(0.0);
      return;
    }
    vec2 stampUV = WORLD_MAGNIFY > 0.5 ? clamp(vUV, stampLow, stampHigh) : vUV;
    vec4 stamp = sampleTexture(stampUV, uvDx, uvDy);
    float coverage = indexed ? stamp.g : stamp.a;
    finalColor = vec4(vColor.rgb * coverage, vColor.a * coverage);
    return;
  }
  bool paletted = hasFlag(flags, WORLD_FLAG_PALETTED);
  bool recoloured = hasFlag(flags, WORLD_FLAG_RECOLOURED);
  // A character's paletted page always filters; a recoloured one takes the plain page's path.
  bool palettedFilter = paletted && !recoloured;
  int lutRow = flags >> WORLD_LUT_ROW_SHIFT;
  ${magnifies ? 'bool magnified = texelsPerPixel < MAGNIFIED_BELOW;' : '// The batcher draws this program only where no page is magnified.\n  bool magnified = false;'}
  // A paletted element always resolves through its LUT; a plain one only when its page is magnified.
  bool filtered = WORLD_MAGNIFY > 0.5 && (palettedFilter || hasFlag(flags, WORLD_FLAG_MAGNIFY));
  // A minified plain page spreads four sampler taps over its footprint against sparkle, clamped to the
  // frame; where they nearly coincide, at one texel per pixel as most of the world is at zoom 1, one tap
  // stands in.
  vec2 footprint = max(uvFootprint - 1.0 / texSize, vec2(0.0)) * MINIFY_TAP_OFFSET;
  bool single = max(footprint.x, footprint.y) < SINGLE_TAP_FOOTPRINT;
  bool minified = filtered && !palettedFilter && !magnified;
  vec2 low = vFrame.xy + 0.5 / texSize;
  vec2 high = vFrame.zw - 0.5 / texSize;
  vec4 outColor;
  if (!filtered || (minified && single)) {
    // Mode off draws unfiltered pages, which have mipmaps only as art a presentation pack loaded so.
    vec4 texel = WORLD_MAGNIFY < 0.5 && !hasFlag(flags, WORLD_FLAG_MIPMAPPED)
      ? sampleLevelZero(vUV)
      : sampleTexture(minified ? clamp(vUV, low, high) : vUV, uvDx, uvDy);
    outColor = recoloured ? recolouredTexel(texel, lutRow) : drawnTexel(texel, indexed, paletted, lutRow);
  } else if (minified) {
    // Not a mipmap substitute at extreme zoom-out: sampling cost is deliberately bounded.
    vec4 t0 = sampleTexture(clamp(vUV - footprint, low, high), uvDx, uvDy);
    vec4 t1 = sampleTexture(clamp(vUV + vec2(footprint.x, -footprint.y), low, high), uvDx, uvDy);
    vec4 t2 = sampleTexture(clamp(vUV + vec2(-footprint.x, footprint.y), low, high), uvDx, uvDy);
    vec4 t3 = sampleTexture(clamp(vUV + footprint, low, high), uvDx, uvDy);
    // A recoloured page's taps resolve before they blend, since an averaged index names another colour;
    // any other indexed page is never paletted here, so its averaged coverage stays its coverage.
    outColor = recoloured
      ? MINIFY_TAP_WEIGHT * (recolouredTexel(t0, lutRow) + recolouredTexel(t1, lutRow)
                           + recolouredTexel(t2, lutRow) + recolouredTexel(t3, lutRow))
      : drawnTexel(MINIFY_TAP_WEIGHT * (t0 + t1 + t2 + t3), indexed, false, lutRow);
  } else {
${gather}
  }
  if (paletted && hasFlag(flags, WORLD_FLAG_GLOW)) {
    outColor = vec4(paletteColour(GLOW_PALETTE_INDEX / PALETTE_INDEX_MAX, lutRow), 1.0) * outColor.a;
  }
  if (vBlood > 0.0 && outColor.a > 0.0) {
    vec2 bodyUV = (vUV - vFrame.xy) / max(vFrame.zw - vFrame.xy, vec2(0.000001));
    outColor.rgb = coatBlood(outColor.rgb / outColor.a, bodyUV, vBlood) * outColor.a;
  }
  if (vSplashes.w != 0.0 && outColor.a > 0.0) {
    if (WORLD_MAGNIFY < 0.5) texSize = pageSize();
    vec2 size = max((vFrame.zw - vFrame.xy) * texSize${prescaled ? ' / pageTexelScale()' : ''}, vec2(1.0));
    vec2 uv = (vUV - vFrame.xy) / max(vFrame.zw - vFrame.xy, vec2(0.000001));
    // Negative coat data is a facade cutoff: crop the imprint, never shrink the entire splash.
    if (uv.y >= max(0.0, -vBlood)) {
      float edge = vBlood < 0.0 ? smoothstep(-vBlood, -vBlood + 2.0 / size.y, uv.y) : 1.0;
      outColor.rgb = mix(outColor.rgb, splashBlood(outColor.rgb / outColor.a, uv, size, vSplashes) * outColor.a, edge);
    }
  }
  ${shading.output}
  float packedLift = max(0.0, vSelection);
  float tone = min(floor(packedLift / SELECTION_TONE_BAND), float(LIFT_TONES - 1));
  vec3 lift = LIFT_COLOURS[int(tone)] * finalColor.a;
  finalColor.rgb = mix(finalColor.rgb, lift, packedLift - tone * SELECTION_TONE_BAND);
  float lit = vNight;
  if (lit >= NIGHT_FALL_BAND) {
    float height = (vUV.y - vFrame.y) / max(vFrame.w - vFrame.y, 0.000001);
    lit = (lit - NIGHT_FALL_BAND) * mix(NIGHT_FALL_TOP, 1.0, smoothstep(NIGHT_FALL_FROM, NIGHT_FALL_TO, height));
  }
  nightLit = vec4(lit * finalColor.a, 0.0, 0.0, finalColor.a);
}`;
}
