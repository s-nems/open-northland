import { MeshGeometry, Shader, type TextureSource } from 'pixi.js';

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

// Blend of the texel at base with its right/down neighbours by weights f; weight 0 is base's centre.
vec4 resolvedBlend(ivec2 base, vec2 f) {
  return mix(mix(resolvedTexel(base), resolvedTexel(base + ivec2(1, 0)), f.x),
             mix(resolvedTexel(base + ivec2(0, 1)), resolvedTexel(base + ivec2(1, 1)), f.x), f.y);
}

vec4 resolvedBilinear(vec2 uv) {
  vec2 p = uv * vec2(textureSize(uTexture, 0)) - 0.5;
  return resolvedBlend(ivec2(floor(p)), fract(p));
}

// Nearest inside a texel, one screen pixel of blend across each texel boundary: crisp pixels that
// no longer shimmer under subpixel placement. texelsPerPixel is the screen-pixel footprint.
vec4 resolvedSharp(vec2 p, float texelsPerPixel) {
  vec2 q = p - 0.5;
  vec2 f = clamp((fract(q) - 0.5) / max(texelsPerPixel, 0.0001) + 0.5, 0.0, 1.0);
  return resolvedBlend(ivec2(floor(q)), f);
}

// Luma-weighted RGB plus alpha on premultiplied texels, so a silhouette against transparency is a
// strong edge and a shading band a weak one.
float colourDistance(vec4 a, vec4 b) {
  vec4 d = abs(a - b);
  return dot(d.rgb, vec3(0.299, 0.587, 0.114)) + d.a;
}

const float DISTINCT = 1.0 / 255.0; // two texels "differ" once any channel moves a level

// Edge-directed magnification after the published xBR rule set (Hyllian's 2011 algorithm; an
// approximation, not an original-engine mechanism): a diagonal edge through a texel's corner is
// redrawn as a straight cut at 45, ~27 or ~63 degrees, filled with the neighbour that continues
// the edge. Only the corner nearest the fragment is judged; s mirrors that corner onto one
// orientation so the 3x3 core plus its two outer taps read the same way for all four corners.
vec4 resolvedXbr(vec2 p, float texelsPerPixel) {
  ivec2 centre = ivec2(floor(p));
  vec2 fp = fract(p);
  ivec2 s = ivec2(fp.x >= 0.5 ? 1 : -1, fp.y >= 0.5 ? 1 : -1);
  vec2 local = abs(fp - 0.5); // 0 at the texel centre, 0.5 at the judged corner
  #define TAP(dx, dy) resolvedTexel(centre + ivec2(dx, dy) * s)
  vec4 e = TAP(0, 0);
  vec4 f = TAP(1, 0);
  vec4 h = TAP(0, 1);
  vec4 i = TAP(1, 1);
  vec4 b = TAP(0, -1);
  vec4 c = TAP(1, -1);
  vec4 d = TAP(-1, 0);
  vec4 g = TAP(-1, 1);
  vec4 f4 = TAP(2, 0);
  vec4 i4 = TAP(2, 1);
  vec4 h5 = TAP(0, 2);
  vec4 i5 = TAP(1, 2);
  #undef TAP
  vec4 base = resolvedSharp(p, texelsPerPixel);
  float ef = colourDistance(e, f);
  float eh = colourDistance(e, h);
  if (ef < DISTINCT || eh < DISTINCT) return base;
  // The corner is an edge when the diagonal e-i is a stronger contrast than the diagonal f-h.
  float along = colourDistance(e, c) + colourDistance(e, g) + colourDistance(i, h5)
              + colourDistance(i, f4) + 4.0 * colourDistance(h, f);
  float across = colourDistance(h, d) + colourDistance(h, i5) + colourDistance(f, i4)
               + colourDistance(f, b) + 4.0 * colourDistance(e, i);
  if (along >= across) return base;
  float fg = colourDistance(f, g);
  float hc = colourDistance(h, c);
  // Cut lines in corner-local texel units: u + v = 0.5 (45 deg), and the two shallower slopes
  // used when the edge continues past g or c. Each blends over one screen pixel.
  float aa = 0.5 * texelsPerPixel;
  float cut = smoothstep(0.5 - aa * 1.4142, 0.5 + aa * 1.4142, local.x + local.y);
  if (2.0 * fg <= hc && colourDistance(e, g) >= DISTINCT && colourDistance(d, g) >= DISTINCT) {
    cut = max(cut, smoothstep(0.25 - aa * 1.118, 0.25 + aa * 1.118, local.y + 0.5 * local.x));
  }
  if (fg >= 2.0 * hc && colourDistance(e, c) >= DISTINCT && colourDistance(b, c) >= DISTINCT) {
    cut = max(cut, smoothstep(0.25 - aa * 1.118, 0.25 + aa * 1.118, local.x + 0.5 * local.y));
  }
  return mix(base, ef <= eh ? f : h, cut);
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
      finalColor = uSampling.x > 2.5 ? resolvedXbr(p, texelsPerPixel) : resolvedSharp(p, texelsPerPixel);
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
/** The magnification an original character gets under enhanced sampling. */
export type CharacterScaler = Exclude<PalettedSampling, 'nearest'>;
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
