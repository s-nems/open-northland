import { MeshGeometry, Shader, type TextureSource } from 'pixi.js';

/**
 * The GL program behind {@link import('./paletted-sprite.js').PalettedSprite}: the vertex/fragment
 * source, the shared quad geometry, and the factories that build them. The class in
 * `./paletted-sprite.ts` owns per-frame placement and uniform mutation.
 */

const VERTEX = `#version 300 es
in vec2 aPosition; // native bob pixels (already offset by the frame's draw origin)
in vec2 aUV;
out vec2 vUV;

uniform vec4 uPlacement;  // xy = feet-anchor screen px, z = pixels-per-native-pixel (zoom), w = player row
// Logical canvas size in px (the same CSS-px space uPlacement lives in). Deliberately not named
// "uResolution": Pixi's GlobalUniformSystem publishes a global uniform of that exact name (the render
// target's device-pixel size) and syncs it onto any mesh shader declaring it — on a HiDPI canvas
// (resolution > 1) that overwrote this with 2× values after our group's value-cache said "unchanged,
// skip", so the first paletted mesh drawn each frame landed at half position/size (the "body stands
// beside the head" bug). A non-reserved name keeps this uniform ours alone.
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
// highp: uPlacement is shared with the (highp-by-default) vertex stage — a precision mismatch fails to link —
// and the index maths (texel.r * 255) needs the extra mantissa to land on the exact palette index.
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uTexture; // indexed atlas: red = palette index / 255, alpha = mask
uniform sampler2D uLut;     // 256 x N palette LUT: row = player colour, column = palette index
uniform vec2 uLutSize;      // (256, N)
uniform vec4 uPlacement;    // .w = player-colour row to read (0 .. N-1)
uniform vec2 uColorKey;     // .x > 0.5: key magenta; .y: near-black mode (0 off / 1 full band / 2 round corners)
uniform vec4 uFrameUV;      // the current frame's atlas-UV box (min.xy, max.zw) — for the 'round' corner key
uniform vec4 uSilhouette;   // .rgb: flat override colour, .w > 0.5: silhouette mode on (see the setter)

// GUI transparent key — our floating-HUD deviation, not an original mechanism (the engine blitter has no
// colour key; see source basis "Left tool panel"). The in-game GUI palettes (iconsleft/context/…) reserve
// palette index 0 as a magenta sentinel (255,0,255) and a band of near-black entries (max channel ≲ 28/255)
// as each element's background. The indexed atlases bake every written pixel at its authored coverage
// (graded alpha — see packIndexedBobAtlas), but a GUI element's background pixels are fully covered, so an
// element drawn straight would carry an opaque dark rectangle over the world — which the original hid by
// rendering gameplay in a dedicated area, but we render full-screen.
//
// The two classes are keyed independently (uColorKey.x = magenta, uColorKey.y = near-black band or round-disc
// clip), because they are not both "background" for every element. Large panel/window elements (iconsleft) use
// the near-black band as a removable backdrop → 'full' keys both. But the round wooden order buttons (context
// palette) paint their own bevel rim and their engraved glyph in that same near-black — keying it there punches
// holes through the art (the "chipped/holey" look). So 'round' instead keeps the near-black inside the disc and
// geometrically clips everything outside the inscribed disc, dropping the square frame + corners for a clean
// round button. Character LUTs produce neither class and leave both flags 0, so this is inert for world sprites.
const float KEY_MAGENTA_HI = 0.9;  // r AND b above this …
const float KEY_MAGENTA_LO = 0.1;  // … with g below this → the magenta sentinel (index 0)
const float KEY_NEAR_BLACK = 0.11; // max channel below this (≈28/255) → the near-black background band
const float KEY_ROUND_CLIP = 1.0;  // 'round' mode: fade out past this normalized radius (the disc fills the
                                   // frame, touching its edges at rad 1.0; corners run to ~1.41) → clean disc

void main(void) {
  // textureLod(..., 0.0): sample the base level only. An index/LUT read must never hit a blended mip — an
  // averaged index would decode to the wrong palette entry. (Pixi v8 defaults to no mipmaps, but be explicit.)
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
      // 'round': hard-clip everything outside the inscribed disc so the square frame's corners — including
      // the light bevel pixels a near-black-only key leaves behind — drop away and the button is a clean
      // round disc, glyph intact. Only the settler action-ring order buttons use 'round', and they are
      // supersampled (baked at an integer oversample, then linear-downscaled — hud/icon-texture.ts), so the
      // downscale anti-aliases this hard edge uniformly and DPR-independently. (An in-shader fwidth feather
      // instead varied with the device pixel ratio and left partial-alpha specks in the disc's corners.)
      vec2 span = max(uFrameUV.zw - uFrameUV.xy, vec2(1e-6));
      vec2 local = (vUV - uFrameUV.xy) / span; // 0..1 within the frame box
      float rad = length(local - vec2(0.5)) * 2.0; // 0 centre, 1 edge-midpoint, ~1.41 corner
      if (rad > KEY_ROUND_CLIP) discard;
    }
  }
  // Silhouette mode: every pixel that survived the colour key draws one flat colour — the discards above
  // already carved the glyph's shape, so this is exactly its keyed silhouette (used for outline stamps).
  if (uSilhouette.w > 0.5) {
    rgb = uSilhouette.rgb;
  }
  // Modulate by the texel's authored coverage (premultiplied — Pixi's normal blend expects it), so the
  // graded indexed bake's feathered edges draw translucent instead of binary.
  finalColor = vec4(rgb, 1.0) * texel.a;
}`;

/** A unit quad's index buffer (two triangles) — positions/UVs are rewritten per frame by the sprite's `setFrame`. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** Width of the palette LUT (one texel per 8-bit palette index). */
const LUT_WIDTH = 256;

/** The mesh's mutable uniforms (Pixi wraps the plain object in a UniformGroup; this is the typed handle). */
export interface PalettedUniforms {
  uniforms: {
    /** [feetX, feetY, scale, playerRow] — mutated in place so a shared program re-uploads it. */
    uPlacement: Float32Array;
    /** [width, height] — the logical canvas size (see the vertex-shader note on why not `uResolution`). */
    uScreen: Float32Array;
    uLutSize: Float32Array;
    /** [keyMagenta, nearBlackMode] — a `Float32Array`, not a scalar `f32`, which a shared program would
     *  not re-upload per-mesh. */
    uColorKey: Float32Array;
    /** [flipY, _] — `.x > 0.5` renders upright into a bottom-up render texture (a `Float32Array` for the
     *  same per-mesh re-upload reason as `uColorKey`). */
    uFlip: Float32Array;
    /** [uMin, vMin, uMax, vMax] — the current frame's atlas-UV box, for the 'round' corner key. */
    uFrameUV: Float32Array;
    /** [r, g, b, on] — the flat silhouette override colour (normalized), on > 0.5 enables it. */
    uSilhouette: Float32Array;
  };
  /** Bump the group's dirty id so Pixi re-uploads the changed contents. */
  update(): void;
}

/** The per-mesh quad geometry: eight zeroed position/uv floats + the shared two-triangle index buffer.
 *  The sprite's `setFrame` rewrites the positions/UVs each frame. */
export function createPalettedGeometry(): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array(8),
    uvs: new Float32Array(8),
    indices: QUAD_INDICES,
  });
}

/**
 * Compile (through `Shader.from`'s program cache) the paletted-sprite GL program and wire its per-mesh
 * uniform group. `lut` is the `256 × colours` palette LUT bound to both `uLut` and `uTexture`; `colours`
 * sets `uLutSize`'s row count.
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
