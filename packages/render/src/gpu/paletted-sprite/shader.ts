import { MeshGeometry, Shader, type TextureSource } from 'pixi.js';
import { PIXEL_ART_MAGNIFY_GLSL } from '../pixel-art-magnify.js';

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

void main(void) {
  vec2 screen = uPlacement.xy + uPlacement.z * aPosition;
  // Screen pixels → clip space (Y points down in screen space, up in clip space).
  float clipY = 1.0 - screen.y / uScreen.y * 2.0;
  // A WebGL render texture is stored bottom-up, so a straight draw lands upside-down; uFlip negates clip Y
  // to render upright into a texture without the whole-sprite Y-flip that mixed (Pixi-native) content can't
  // share. See gpu/supersample.ts.
  gl_Position = vec4(screen.x / uScreen.x * 2.0 - 1.0, uFlip.x > 0.5 ? -clipY : clipY, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAGMENT = `#version 300 es
// highp: uPlacement is shared with the (highp-by-default) vertex stage - a precision mismatch fails to link -
// and the index maths (texel.r * 255) needs the extra mantissa to land on the exact palette index.
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uTexture; // indexed atlas: red = palette index / 255, alpha = mask
uniform sampler2D uLut;     // 256 x N palette LUT: row = player colour, column = palette index
uniform vec2 uLutSize;      // (256, N)
uniform vec4 uPlacement;    // .w = player-colour row to read (0 .. N-1)
uniform vec2 uColorKey;     // .x > 0.5: key magenta; .y: near-black mode (0 off / 1 full band / 2 round corners)
uniform vec4 uFrameUV;      // the current frame's atlas-UV box (min.xy, max.zw) - for the 'round' corner key
uniform vec4 uSilhouette;   // .rgb: flat override colour, .w > 0.5: silhouette mode on (see the setter)
uniform vec2 uSampling;     // .x: world magnification mode (0 nearest / 1 bilinear / 2 sharp / 3 xbr)

// GUI transparent key, a floating-HUD deviation with no original mechanism behind it (the engine blitter
// has no colour key; source basis "Left tool panel"). The in-game GUI palettes reserve palette index 0 as a
// magenta sentinel (255,0,255) and a band of near-black entries (max channel ≲ 28/255) as element background.
// The two classes key independently because they are not both background for every element: panel elements
// treat the near-black band as a removable backdrop, while the round order buttons paint their bevel rim and
// glyph in that same near-black. Character LUTs produce neither class and leave both flags 0.
const float KEY_MAGENTA_HI = 0.9;  // r AND b above this …
const float KEY_MAGENTA_LO = 0.1;  // … with g below this → the magenta sentinel (index 0)
const float KEY_NEAR_BLACK = 0.11; // max channel below this (≈28/255) → the near-black background band
const float KEY_ROUND_CLIP = 1.0;  // 'round' mode: fade out past this normalized radius (the disc fills the
                                   // frame, touching its edges at rad 1.0; corners run to ~1.41) → clean disc

vec4 resolvedTexel(ivec2 pixel) {
  ivec2 size = textureSize(uTexture, 0);
  vec2 uv = (vec2(pixel) + 0.5) / vec2(size);
  // The frame boundary is transparent, not the next packed bob or the atlas's edge colour.
  if (any(lessThan(uv, uFrameUV.xy)) || any(greaterThanEqual(uv, uFrameUV.zw))) return vec4(0.0);
  vec4 t = texelFetch(uTexture, pixel, 0);
  float index = floor(t.r * 255.0 + 0.5);
  vec2 lutUV = vec2((index + 0.5) / uLutSize.x, (uPlacement.w + 0.5) / uLutSize.y);
  return vec4(textureLod(uLut, lutUV, 0.0).rgb * t.a, t.a);
}

#define MAGNIFY_FETCH(px) resolvedTexel(px)
${PIXEL_ART_MAGNIFY_GLSL}

vec4 resolvedBilinear(vec2 uv) {
  return magnifyBilinear(uv * vec2(textureSize(uTexture, 0)));
}

void main(void) {
  // GUI keying/silhouettes retain their exact existing path. Magnification modes resolve colours
  // before blending; a 2x2 footprint reduces minification sparkle without filtering indices or
  // allocating per-player RGBA atlases. Not a mipmap substitute at extreme zoom-out: sampling cost
  // is deliberately bounded.
  if (uSampling.x > 0.5 && uColorKey.x < 0.5 && uSilhouette.w < 0.5) {
    vec2 size = vec2(textureSize(uTexture, 0));
    vec2 p = vUV * size;
    float texelsPerPixel = max(fwidth(p.x), fwidth(p.y));
    if (texelsPerPixel < 1.0 && uSampling.x > 1.5) {
      // Magnified: the mode's own edge treatment. Both converge on bilinear as texels reach pixel size.
      finalColor = uSampling.x > 2.5 ? magnifyXbr(p, texelsPerPixel) : magnifySharp(p, texelsPerPixel);
      return;
    }
    vec2 footprint = max(fwidth(vUV) - 1.0 / size, vec2(0.0)) * 0.25;
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
  if (texel.a == 0.0) discard; // unwritten bob pixel
  // Recover the exact palette index (0..255) from the red channel, then read the player's LUT row.
  float index = floor(texel.r * 255.0 + 0.5);
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
  // Silhouette mode: every pixel that survived the colour key draws one flat colour - the discards above
  // already carved the glyph's shape, so this is exactly its keyed silhouette (used for outline stamps).
  if (uSilhouette.w > 0.5) {
    rgb = uSilhouette.rgb;
  }
  // Modulate by the texel's authored coverage (premultiplied - Pixi's normal blend expects it), so the
  // graded indexed bake's feathered edges draw translucent instead of binary.
  finalColor = vec4(rgb, 1.0) * texel.a;
}`;

/**
 * How a world sprite samples its indexed atlas: `nearest` is the exact original; the others resolve
 * palette colours before blending. `bilinear` softens everything; `sharp` keeps whole texels and
 * anti-aliases only their boundaries; `xbr` additionally redraws diagonal edges as straight cuts.
 */
export type PalettedSampling = 'nearest' | 'bilinear' | 'sharp' | 'xbr';
export const PALETTED_SAMPLING_MODES: Readonly<Record<PalettedSampling, number>> = {
  nearest: 0,
  bilinear: 1,
  sharp: 2,
  xbr: 3,
};

/** A unit quad's index buffer; positions and UVs are rewritten per frame by the sprite's `setFrame`. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** Width of the palette LUT (one texel per 8-bit palette index). */
const LUT_WIDTH = 256;

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
  };
  /** Bump the group's dirty id so Pixi re-uploads the changed contents. */
  update(): void;
}

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
  };
  return Shader.from({
    gl: { vertex: VERTEX, fragment: FRAGMENT },
    resources: {
      // The indexed atlas source is bound per frame (setFrame); start at the LUT so the program links.
      uTexture: lut,
      uLut: lut,
      vars,
    },
  });
}
