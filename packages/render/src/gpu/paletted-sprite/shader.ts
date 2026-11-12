import { MeshGeometry, Shader, type TextureSource } from 'pixi.js';
import { PIXEL_ART_MAGNIFY_GLSL } from '../pixel-art/magnify.js';
import { LIFT_COLOURS_GLSL } from '../selection/style.js';
import type { GlslProgramSource } from '../shaders/program-source.js';

const VERTEX = `#version 300 es
in vec2 aPosition; // native bob pixels (already offset by the frame's draw origin)
in vec2 aUV;
out vec2 vUV;

uniform vec4 uPlacement;  // xy = feet-anchor screen px, z = pixels-per-native-pixel (zoom), w = player row
// Logical canvas size in px, the same CSS-px space uPlacement lives in. Not named "uResolution":
// Pixi's GlobalUniformSystem publishes a global uniform of that name (the render target's
// device-pixel size) and syncs it onto any mesh shader declaring it, overwriting this one.
uniform vec2 uScreen;
uniform vec2 uFlip;       // .x > 0.5: negate clip Y (render upright into a bottom-up render texture)
uniform vec2 uShear;      // .x = native px of x shift per native px of y, about the feet anchor

void main(void) {
  vec2 screen = uPlacement.xy + uPlacement.z * (aPosition + vec2(uShear.x * aPosition.y, 0.0));
  // Screen pixels → clip space (Y points down in screen space, up in clip space).
  float clipY = 1.0 - screen.y / uScreen.y * 2.0;
  // A WebGL render texture is stored bottom-up, so a straight draw lands upside-down; uFlip negates clip Y
  // to render upright into a texture without the whole-sprite Y-flip that mixed (Pixi-native) content can't
  // share. See gpu/pixi-app/supersample.ts.
  gl_Position = vec4(screen.x / uScreen.x * 2.0 - 1.0, uFlip.x > 0.5 ? -clipY : clipY, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAGMENT = `#version 300 es
// highp: uPlacement is shared with the (highp-by-default) vertex stage - a precision mismatch fails to link -
// and the index maths (texel.r * 255) needs the extra mantissa to land on the exact palette index.
precision highp float;
in vec2 vUV;
layout(location = 0) out vec4 finalColor;
// The night's lit mask in red, as the world batch writes it (see world-batch/shader.ts).
layout(location = 1) out vec4 nightLit;

uniform sampler2D uTexture; // indexed atlas: red = palette index / 255, green = coverage, opaque
uniform sampler2D uLut;     // 256 x N palette LUT: row = player colour, column = palette index
uniform vec2 uLutSize;      // (256, N)
uniform vec4 uPlacement;    // .w = player-colour row to read (0 .. N-1)
uniform vec2 uColorKey;     // .x > 0.5: key magenta; .y: near-black mode (0 off / 1 full band / 2 round corners)
uniform vec4 uFrameUV;      // the current frame's atlas-UV box (min.xy, max.zw) - for the 'round' corner key
uniform vec4 uSilhouette;   // .rgb: flat override colour, .w > 0.5: silhouette mode on (see the setter)
uniform vec2 uSampling;     // .x: 0 nearest / 1 xbr
uniform vec2 uSelection;   // .x: lift, 0..1; .y: the lift's tone code, an index into LIFT_COLOURS
uniform vec4 uTint;         // .rgb multiplies the LUT colour; white draws it straight
uniform vec2 uAtlasSize;    // the indexed atlas's size in px
uniform vec4 uClothRanges;  // two inclusive palette-index ranges (loA, hiA, loB, hiB) that are cloth
uniform vec4 uClothWave;    // .x phase (rad), .y displacement in native px (0 = still), .z shade depth
uniform vec2 uClothFreq;    // the wave's radians per native px along x and y
uniform vec2 uNight;        // .x: the lit mask's share, 0 unlit
uniform vec4 uDamage;       // .x wear 0..1, .y pattern seed, .z lowest drawn row (native px from the feet)
uniform vec2 uFrameOrigin;  // the frame's draw offset from the feet anchor, native px

// GUI transparent key, a floating-HUD deviation with no original mechanism behind it (the original's GUI
// drawing has no colour key; source basis "Left tool panel"). The in-game GUI palettes reserve palette index 0 as a
// magenta sentinel (255,0,255) and a band of near-black entries (max channel ≲ 28/255) as element background.
// The two classes key independently because they are not both background for every element: panel elements
// treat the near-black band as a removable backdrop, while the round order buttons paint their bevel rim and
// glyph in that same near-black. Character LUTs produce neither class and leave both flags 0.
const float KEY_MAGENTA_HI = 0.9;  // r AND b above this …
const float KEY_MAGENTA_LO = 0.1;  // … with g below this → the magenta sentinel (index 0)
const float KEY_NEAR_BLACK = 0.11; // max channel below this (≈28/255) → the near-black background band
const float KEY_ROUND_CLIP = 1.0;  // 'round' mode: fade out past this normalized radius (the disc fills the
                                   // frame, touching its edges at rad 1.0; corners run to ~1.41) → clean disc

bool isCloth(float index) {
  return (index >= uClothRanges.x && index <= uClothRanges.y) ||
         (index >= uClothRanges.z && index <= uClothRanges.w);
}

${LIFT_COLOURS_GLSL}

// A row no frame reaches: uDamage.z at or above it clips nothing.
const float NO_CLIP_ROW = 100000.0;

// How dark the timber inside a breach draws, and how far past a breach's rim the pattern must rise
// before the hole goes right through. Tuned by eye.
const float BREACH_SHADE = 0.2;
const float THROUGH_BREACH = 0.15;

float damageHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7)) + uDamage.y) * 43758.5453);
}

float damageNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(damageHash(cell), damageHash(cell + vec2(1.0, 0.0)), f.x),
             mix(damageHash(cell + vec2(0.0, 1.0)), damageHash(cell + vec2(1.0, 1.0)), f.x), f.y);
}

// A vehicle's structural damage at a texel, in native px from the feet so the marks stay on the hull
// through a clip: x shades the colour, y is 0 under the clip row and in the few breaches that go right
// through. Most breaches show charred timber, so a wrecked hull stays a solid body.
// Artistic approximation, the procedural stand-in for the pixels a building's damage paint rewrites.
vec2 hullDamage(vec2 local) {
  if (local.y > uDamage.z) return vec2(1.0, 0.0);
  float shade = 1.0;
  if (uDamage.x > 0.0) {
    float n = damageNoise(local / 10.0) * 0.72 + damageNoise(local / 4.0 + 19.0) * 0.28;
    float edge = 0.8 - uDamage.x * 0.36;
    float breach = max(edge + 0.16, 0.7);
    if (n > breach + THROUGH_BREACH) return vec2(1.0, 0.0);
    // Soot over the whole hull, charred wood round each breach, and burnt timber inside it.
    shade = (1.0 - 0.22 * uDamage.x) * (1.0 - 0.6 * smoothstep(edge, edge + 0.12, n));
    if (n > breach) shade = BREACH_SHADE * (0.8 + 0.4 * damageHash(floor(local / 2.0)));
  }
  return vec2(shade, 1.0);
}

vec3 selectionLift() {
  return LIFT_COLOURS[clamp(int(uSelection.y + 0.5), 0, LIFT_TONES - 1)];
}

// Wind in the cloth at atlas uv: a travelling wave slides the weave sideways inside the cloth's own
// outline (a displaced read that leaves the cloth keeps index) and lights its crests. Returns the shade.
float blowCloth(vec2 uv, inout float index) {
  if (uClothWave.y <= 0.0 || !isCloth(index)) return 1.0;
  vec2 local = (uv - uFrameUV.xy) * uAtlasSize;
  float wave = dot(local, uClothFreq) - uClothWave.x;
  float u = uv.x + uClothWave.y * sin(wave) / uAtlasSize.x;
  if (u > uFrameUV.x && u < uFrameUV.z) {
    vec4 moved = textureLod(uTexture, vec2(u, uv.y), 0.0);
    float movedIndex = floor(moved.r * 255.0 + 0.5);
    if (moved.g > 0.0 && isCloth(movedIndex)) index = movedIndex;
  }
  return 1.0 + uClothWave.z * cos(wave);
}

// The bound atlas's size in texels, set by main's magnified path before any tap reads it. The query,
// not uAtlasSize: a GUI atlas can be larger than the size its frames name. The shared magnifier calls
// MAGNIFY_FETCH with a texel alone, so the size reaches resolvedTexel as a global. ANGLE hands a mutable
// global to every function by reference, which slowed the world batch on Metal; this mesh draws only
// vehicles and GUI art, few fragments.
vec2 atlasSize;

vec4 resolvedTexel(ivec2 pixel) {
  vec2 uv = (vec2(pixel) + 0.5) / atlasSize;
  // The frame boundary is transparent, not the next packed bob or the atlas's edge colour.
  if (any(lessThan(uv, uFrameUV.xy)) || any(greaterThanEqual(uv, uFrameUV.zw))) return vec4(0.0);
  vec4 t = texelFetch(uTexture, pixel, 0);
  float index = floor(t.r * 255.0 + 0.5);
  float shade = blowCloth(uv, index);
  vec2 lutUV = vec2((index + 0.5) / uLutSize.x, (uPlacement.w + 0.5) / uLutSize.y);
  return vec4(mix(textureLod(uLut, lutUV, 0.0).rgb * shade * uTint.rgb, selectionLift(), uSelection.x) * t.g, t.g);
}

#define MAGNIFY_FETCH(px) resolvedTexel(px)
${PIXEL_ART_MAGNIFY_GLSL}

vec4 resolvedBilinear(vec2 uv) {
  return magnifyBilinear(uv * atlasSize);
}

void drawPaletted() {
  // GUI keying/silhouettes retain their exact existing path. Magnification modes resolve colours
  // before blending; a 2x2 footprint reduces minification sparkle without filtering indices or
  // allocating per-player RGBA atlases. Not a mipmap substitute at extreme zoom-out: sampling cost
  // is deliberately bounded. The tint and the cloth wave ride along.
  if (uSampling.x > 0.5 && uColorKey.x < 0.5 && uSilhouette.w < 0.5) {
    atlasSize = vec2(textureSize(uTexture, 0));
    vec2 p = vUV * atlasSize;
    float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
    if (texelsPerPixel < MAGNIFIED_BELOW) {
      // Magnified: xBR's edge treatment, which converges on bilinear as texels reach pixel size.
      finalColor = magnifyXbr(p, texelsPerPixel);
      return;
    }
    vec2 footprint = max(fwidth(vUV) - 1.0 / atlasSize, vec2(0.0)) * 0.25;
    if (max(footprint.x, footprint.y) < 0.000001) {
      finalColor = resolvedBilinear(vUV);
      return;
    }
    finalColor = (resolvedBilinear(vUV + vec2(-footprint.x, -footprint.y))
                + resolvedBilinear(vUV + vec2(footprint.x, -footprint.y))
                + resolvedBilinear(vUV + vec2(-footprint.x, footprint.y))
                + resolvedBilinear(vUV + footprint)) * 0.25;
    return;
  }
  // textureLod(..., 0.0) samples the base level only: an averaged mip index decodes to the wrong entry.
  vec4 texel = textureLod(uTexture, vUV, 0.0);
  if (texel.g == 0.0) discard; // unwritten bob pixel
  // Recover the exact palette index (0..255) from the red channel, then read the player's LUT row.
  float index = floor(texel.r * 255.0 + 0.5);
  float shade = blowCloth(vUV, index);
  vec2 lutUV = vec2((index + 0.5) / uLutSize.x, (uPlacement.w + 0.5) / uLutSize.y);
  vec3 rgb = textureLod(uLut, lutUV, 0.0).rgb;
  if (uColorKey.x > 0.5) {
    bool magenta = rgb.r > KEY_MAGENTA_HI && rgb.g < KEY_MAGENTA_LO && rgb.b > KEY_MAGENTA_HI;
    if (magenta) discard;
  }
  if (uColorKey.y > 0.5) {
    if (uColorKey.y < 1.5) {
      // 'full': the whole near-black band is removable panel/window backdrop
      if (max(max(rgb.r, rgb.g), rgb.b) < KEY_NEAR_BLACK) discard;
    } else {
      // 'round': hard-clip outside the inscribed disc, dropping the square frame's corners and the bevel
      // pixels a near-black-only key leaves behind. Its callers supersample, so the downscale
      // anti-aliases this hard edge DPR-independently.
      vec2 span = max(uFrameUV.zw - uFrameUV.xy, vec2(1e-6));
      vec2 local = (vUV - uFrameUV.xy) / span; // 0..1 within the frame box
      float rad = length(local - vec2(0.5)) * 2.0; // 0 centre, 1 edge-midpoint, ~1.41 corner
      if (rad > KEY_ROUND_CLIP) discard;
    }
  }
  rgb *= shade * uTint.rgb; // after the keys, which test the palette's own colours
  // Silhouette mode: every pixel that survived the colour key draws one flat colour - the discards above
  // already carved the glyph's shape, so this is exactly its keyed silhouette (used for outline stamps).
  if (uSilhouette.w > 0.5) {
    rgb = uSilhouette.rgb;
  }
  rgb = mix(rgb, selectionLift(), uSelection.x);
  // Modulate by the texel's authored coverage (premultiplied - Pixi's normal blend expects it), so the
  // graded indexed bake's feathered edges draw translucent instead of binary.
  finalColor = vec4(rgb, 1.0) * texel.g;
}

void main(void) {
  drawPaletted();
  // Once per fragment on the texel grid, not per magnifier tap: the marks keep the art's pixel size.
  if (uDamage.x > 0.0 || uDamage.z < NO_CLIP_ROW) {
    vec2 damage = hullDamage(floor((vUV - uFrameUV.xy) * uAtlasSize) + 0.5 + uFrameOrigin);
    finalColor = vec4(finalColor.rgb * damage.x, finalColor.a) * damage.y;
  }
  nightLit = vec4(uNight.x * finalColor.a, 0.0, 0.0, finalColor.a);
}`;

/**
 * How a world sprite samples its indexed atlas: `nearest` is the exact original; `xbr` resolves palette
 * colours before blending and redraws diagonal edges as straight cuts. Every art filter choice draws an
 * indexed atlas with `xbr`, since a prescaled scaler cannot redraw palette indices.
 */
export type PalettedSampling = 'nearest' | 'xbr';
export const PALETTED_SAMPLING_MODES: Readonly<Record<PalettedSampling, number>> = {
  nearest: 0,
  xbr: 1,
};

/** A unit quad's index buffer; positions and UVs are rewritten per frame by the sprite's `setFrame`. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** Width of the palette LUT (one texel per 8-bit palette index). */
const LUT_WIDTH = 256;
/** A cloth-range bound no 8-bit palette index reaches: the empty range. */
const NO_INDEX = -1;
/** The clip row that clips nothing; the shader's `NO_CLIP_ROW` is the bound it tests against. */
export const UNCLIPPED_ROW = 1_000_000;

/** The mesh's mutable uniforms. Every field is a `Float32Array` mutated in place, not a scalar `f32`,
 *  because the shared GL program re-uploads a loose uniform only when its array contents change. */
export interface PalettedUniforms {
  uniforms: {
    /** [feetX, feetY, scale, playerRow]. */
    uPlacement: Float32Array;
    /** [width, height] - the logical canvas size (see the vertex-shader note on why not `uResolution`). */
    uScreen: Float32Array;
    uLutSize: Float32Array;
    /** [keyMagenta, nearBlackMode]. */
    uColorKey: Float32Array;
    /** [flipY, _] - `.x > 0.5` renders upright into a bottom-up render texture. */
    uFlip: Float32Array;
    /** [uMin, vMin, uMax, vMax] - the current frame's atlas-UV box, for the 'round' corner key. */
    uFrameUV: Float32Array;
    /** [r, g, b, on] - the flat silhouette override colour (normalized), on > 0.5 enables it. */
    uSilhouette: Float32Array;
    /** [mode, _] - the world magnification mode; see {@link PALETTED_SAMPLING_MODES}. */
    uSampling: Float32Array;
    /** [shear, _] - x shift per unit of y about the feet anchor. */
    uShear: Float32Array;
    /** [r, g, b, _] - the colour multiply (normalized). */
    uTint: Float32Array;
    uSelection: Float32Array;
    /** [width, height] of the bound indexed atlas in px. */
    uAtlasSize: Float32Array;
    /** [loA, hiA, loB, hiB] - the inclusive palette-index ranges drawn as cloth. */
    uClothRanges: Float32Array;
    /** [phase, displacementPx, shadeDepth, _]. */
    uClothWave: Float32Array;
    /** [radians per px along x, along y]. */
    uClothFreq: Float32Array;
    /** [lit share, _] - the night's lit mask over the mesh. */
    uNight: Float32Array;
    /** [wear, seed, lowest drawn row, _] - a vehicle's structural damage. */
    uDamage: Float32Array;
    /** [offsetX, offsetY] - the frame's draw offset from the feet anchor, native px. */
    uFrameOrigin: Float32Array;
  };
  /** Bump the group's dirty id so Pixi re-uploads the changed contents. */
  update(): void;
}

export const PALETTED_SPRITE_SOURCE: GlslProgramSource = {
  name: 'paletted-sprite',
  vertex: VERTEX,
  fragment: FRAGMENT,
};

export function createPalettedGeometry(): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array(8),
    uvs: new Float32Array(8),
    indices: QUAD_INDICES,
  });
}

/**
 * Compile the paletted-sprite GL program through `Shader.from`'s program cache and wire its per-mesh
 * uniform group. `colours` sets `uLutSize`'s row count.
 */
export function createPalettedShader(lut: TextureSource, colours: number): Shader {
  const vars = {
    uPlacement: { value: new Float32Array([0, 0, 1, 0]), type: 'vec4<f32>' as const },
    uScreen: { value: new Float32Array([1, 1]), type: 'vec2<f32>' as const },
    uLutSize: { value: new Float32Array([LUT_WIDTH, colours]), type: 'vec2<f32>' as const },
    uColorKey: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uFlip: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uFrameUV: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' as const },
    uSilhouette: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' as const },
    uSampling: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uShear: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uSelection: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uTint: { value: new Float32Array([1, 1, 1, 1]), type: 'vec4<f32>' as const },
    uAtlasSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' as const },
    uClothRanges: {
      value: new Float32Array([NO_INDEX, NO_INDEX, NO_INDEX, NO_INDEX]),
      type: 'vec4<f32>' as const,
    },
    uClothWave: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' as const },
    uClothFreq: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uNight: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
    uDamage: { value: new Float32Array([0, 0, UNCLIPPED_ROW, 0]), type: 'vec4<f32>' as const },
    uFrameOrigin: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
  };
  return Shader.from({
    gl: PALETTED_SPRITE_SOURCE,
    resources: {
      // The indexed atlas source is bound per frame (setFrame); start at the LUT so the program links.
      uTexture: lut,
      uLut: lut,
      vars,
    },
  });
}
