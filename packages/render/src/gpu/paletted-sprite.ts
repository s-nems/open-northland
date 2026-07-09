import { Mesh, MeshGeometry, Shader, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites/index.js';

/**
 * GUI transparent-key mode for a {@link PalettedSprite} (see {@link PalettedSprite.colorKey}). `'off'` draws
 * straight; `'magenta'` keys only the index-0 sentinel; `'full'` also keys the whole near-black background
 * band (panel/window backdrops); `'round'` keys magenta and HARD-clips everything outside the inscribed disc
 * (regardless of colour), so a round order button drops its square frame + corners and reads as a clean disc
 * with its engraved glyph intact. PRECONDITION: a `'round'` sprite must be SUPERSAMPLED (baked at an integer
 * oversample, then downscaled) — the hard clip aliases the disc edge if drawn straight to screen.
 */
export type GuiColorKey = 'off' | 'magenta' | 'full' | 'round';

/**
 * A feet-anchored sprite whose colour is a **per-player palette lookup** rather than a baked texture — the
 * render half of the player (team) colour feature. The character atlas is decoded as INDICES (palette index
 * in red, mask in alpha; see the pipeline's `expandBobFrameIndexed`), and this sprite reads each index
 * through one ROW of a `256 × N` palette LUT texture, chosen by {@link PalettedSprite.player}. So a single
 * indexed atlas + one LUT texture draw all N player colours (only the clothing band differs per row) — no
 * per-player texture, no per-sprite tint (a flat tint can't do a band-limited ramp remap).
 *
 * It is a custom-shader {@link Mesh} (a unit quad), because Pixi's batched `Sprite` can't run a custom
 * fragment shader and a flat `Sprite.tint` would recolour the whole figure (face + tools), not just the
 * team band. A custom-shader mesh bypasses batching (one draw call each) — acceptable at battle scale where
 * the sim, not the renderer, is the wall (see docs + render/AGENTS.md), and the payoff is the one-atlas,
 * N-colour model.
 *
 * **Positioning is manual (screen space).** Pixi does NOT wire its transform uniform blocks into a custom
 * `Shader.from` program (the global-uniform UBO is left unbound), so a custom-shader mesh can't ride the
 * scene-graph transform — the caller supplies a feet-anchor screen position + scale via {@link place}, and
 * the vertex shader maps screen pixels straight to clip space with `uResolution`.
 *
 * **All per-mesh varying values live in ONE `vec4` (`uPlacement`) mutated IN PLACE.** These meshes share a
 * single compiled GL program, and on a shared program Pixi re-uploads a loose uniform only when its backing
 * `Float32Array` contents change — reassigning a scalar `f32` (a new number) is NOT picked up, so every mesh
 * would draw the last-written value. Packing origin/scale/player into a mutated `Float32Array` sidesteps that.
 */

const VERTEX = `#version 300 es
in vec2 aPosition; // native bob pixels (already offset by the frame's draw origin)
in vec2 aUV;
out vec2 vUV;

uniform vec4 uPlacement;  // xy = feet-anchor screen px, z = pixels-per-native-pixel (zoom), w = player row
uniform vec2 uResolution; // canvas size in pixels
uniform vec2 uFlip;       // .x > 0.5: negate clip Y (render upright into a bottom-up render texture)

void main(void) {
  vec2 screen = uPlacement.xy + uPlacement.z * aPosition;
  // Screen pixels → clip space (Y points down in screen space, up in clip space).
  float clipY = 1.0 - screen.y / uResolution.y * 2.0;
  // A WebGL render texture is stored bottom-up, so a straight draw lands upside-down; uFlip negates clip Y
  // to render upright into a texture WITHOUT the whole-sprite Y-flip that mixed (Pixi-native) content can't
  // share. See gpu/supersample.ts.
  gl_Position = vec4(screen.x / uResolution.x * 2.0 - 1.0, uFlip.x > 0.5 ? -clipY : clipY, 0.0, 1.0);
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

// GUI transparent key — OUR floating-HUD deviation, NOT an original mechanism (the engine blitter has no
// colour key; see source basis "Left tool panel"). The in-game GUI palettes (iconsleft/context/…) reserve
// palette index 0 as a MAGENTA sentinel (255,0,255) and a band of near-black entries (max channel ≲ 28/255)
// as each element's background. A bob writes them opaque (transparency is skip-runs), so an element drawn
// straight would carry an opaque dark rectangle over the world — which the original hid by rendering gameplay
// in a dedicated area, but we render full-screen.
//
// The two classes are keyed INDEPENDENTLY (uColorKey.x = magenta, uColorKey.y = near-black band OR round-disc
// clip), because they are NOT both "background" for every element. Large panel/window elements (iconsleft) use
// the near-black band as a removable backdrop → 'full' keys both. But the round wooden ORDER buttons (context
// palette) paint their OWN bevel rim AND their engraved glyph in that same near-black — keying it there punches
// holes THROUGH the art (the "chipped/holey" look). So 'round' instead keeps the near-black inside the disc and
// GEOMETRICALLY clips everything outside the inscribed disc, dropping the square frame + corners for a clean
// round button. Character LUTs produce neither class and leave both flags 0, so this is inert for world sprites.
const float KEY_MAGENTA_HI = 0.9;  // r AND b above this …
const float KEY_MAGENTA_LO = 0.1;  // … with g below this → the magenta sentinel (index 0)
const float KEY_NEAR_BLACK = 0.11; // max channel below this (≈28/255) → the near-black background band
const float KEY_ROUND_CLIP = 1.0;  // 'round' mode: fade out past this normalized radius (the disc fills the
                                   // frame, touching its edges at rad 1.0; corners run to ~1.41) → clean disc

void main(void) {
  // textureLod(..., 0.0): sample the BASE level only. An index/LUT read must never hit a blended mip — an
  // averaged index would decode to the wrong palette entry. (Pixi v8 defaults to no mipmaps, but be explicit.)
  vec4 texel = textureLod(uTexture, vUV, 0.0);
  if (texel.a < 0.5) discard; // transparent bob pixel
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
      // 'round': HARD-clip everything outside the inscribed disc so the square frame's corners — including
      // the light bevel pixels a near-black-only key leaves behind — drop away and the button is a clean
      // round disc, glyph intact. Only the settler action-ring order buttons use 'round', and they are
      // SUPERSAMPLED (baked at an integer oversample, then linear-downscaled — hud/icon-texture.ts), so the
      // downscale anti-aliases this hard edge uniformly and DPR-INDEPENDENTLY. (An in-shader fwidth feather
      // instead varied with the device pixel ratio and left partial-alpha specks in the disc's corners.)
      vec2 span = max(uFrameUV.zw - uFrameUV.xy, vec2(1e-6));
      vec2 local = (vUV - uFrameUV.xy) / span; // 0..1 within the frame box
      float rad = length(local - vec2(0.5)) * 2.0; // 0 centre, 1 edge-midpoint, ~1.41 corner
      if (rad > KEY_ROUND_CLIP) discard;
    }
  }
  // Silhouette mode: every pixel that SURVIVED the colour key draws one flat colour — the discards above
  // already carved the glyph's shape, so this is exactly its keyed silhouette (used for outline stamps).
  if (uSilhouette.w > 0.5) {
    rgb = uSilhouette.rgb;
  }
  finalColor = vec4(rgb, 1.0);
}`;

/** A unit quad's index buffer (two triangles) — positions/UVs are rewritten per frame in {@link PalettedSprite.setFrame}. */
const QUAD_INDICES = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** Width of the palette LUT (one texel per 8-bit palette index). */
const LUT_WIDTH = 256;

/** The mesh's mutable uniforms (Pixi wraps the plain object in a UniformGroup; this is the typed handle). */
interface PalettedUniforms {
  uniforms: {
    /** [feetX, feetY, scale, playerRow] — mutated in place so a shared program re-uploads it. */
    uPlacement: Float32Array;
    uResolution: Float32Array;
    uLutSize: Float32Array;
    /** [keyMagenta, nearBlackMode] — a `Float32Array` (NOT a scalar `f32`, which a shared program won't
     *  re-upload per-mesh; see the class note) so each sprite carries its own GUI-key flags. */
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

export class PalettedSprite extends Mesh<MeshGeometry, Shader> {
  private readonly positions = new Float32Array(8);
  private readonly texUvs = new Float32Array(8);
  private readonly paletteShader: Shader;
  private readonly vars: PalettedUniforms;
  /** The (source, frame, atlas size) the quad buffers were last built for — {@link setFrame} skips the
   *  rebuild + GPU re-upload when they are unchanged (an idle settler / a held animation bob). */
  private lastSource?: TextureSource;
  private lastFrame?: AtlasFrame;
  private lastAtlasW = -1;
  private lastAtlasH = -1;

  /**
   * @param lut the `256 × colours` palette LUT {@link TextureSource} (nearest-sampled). Shared across every
   *   PalettedSprite; only {@link player} selects the row.
   * @param colours the LUT's row count (player-colour palettes) — its pixel height.
   */
  constructor(lut: TextureSource, colours: number) {
    const geometry = new MeshGeometry({
      positions: new Float32Array(8),
      uvs: new Float32Array(8),
      indices: QUAD_INDICES,
    });
    const vars = {
      uPlacement: { value: new Float32Array([0, 0, 1, 0]), type: 'vec4<f32>' as const },
      uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' as const },
      uLutSize: { value: new Float32Array([LUT_WIDTH, colours]), type: 'vec2<f32>' as const },
      uColorKey: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
      uFlip: { value: new Float32Array([0, 0]), type: 'vec2<f32>' as const },
      uFrameUV: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' as const },
      uSilhouette: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' as const },
    };
    const shader = Shader.from({
      gl: { vertex: VERTEX, fragment: FRAGMENT },
      resources: {
        // The indexed atlas source is bound per frame (setFrame); start at the LUT so the program links.
        uTexture: lut,
        uLut: lut,
        vars,
      },
    });
    super({ geometry, shader });
    this.paletteShader = shader;
    this.vars = shader.resources.vars as PalettedUniforms;
  }

  /** The player-colour row (0-based) this sprite reads from the LUT. Clamped to the LUT's row count so an
   *  out-of-range player id (more players than the LUT ships colours for) reads the last real colour rather
   *  than sampling past the texture into garbage — the shader has no bounds check of its own. */
  set player(row: number) {
    const rows = this.vars.uniforms.uLutSize[1] ?? 1;
    this.vars.uniforms.uPlacement[3] = row < 0 ? 0 : row > rows - 1 ? rows - 1 : row;
    this.vars.update();
  }
  get player(): number {
    return this.vars.uniforms.uPlacement[3] ?? 0;
  }

  /**
   * The **GUI transparent key** mode for this sprite (default `'off'`; the world/character sprites never touch
   * these colours, so it stays off for them):
   * - `'off'`    — draw the LUT colours straight (fully opaque).
   * - `'magenta'`— discard only the magenta sentinel (palette index 0).
   * - `'round'`  — discard everything outside the inscribed disc (the square frame's corners), so a round
   *   wooden ORDER button reads as a clean disc with its engraved glyph intact (magenta is keyed too). The
   *   hard clip must be SUPERSAMPLED by the caller (bake + downscale) or the disc edge aliases — see the
   *   {@link GuiColorKey} precondition.
   * - `'full'`   — discard magenta AND the near-black background band. For large panel/window elements whose
   *   near-black backdrop must not paint a dark rectangle over the world.
   */
  set colorKey(mode: GuiColorKey) {
    const u = this.vars.uniforms.uColorKey;
    u[0] = mode === 'off' ? 0 : 1; // magenta key: on for 'magenta' + 'full' + 'round'
    u[1] = mode === 'full' ? 1 : mode === 'round' ? 2 : 0; // near-black mode: 0 off, 1 full band, 2 round disc-clip
    this.vars.update();
  }
  get colorKey(): GuiColorKey {
    const u = this.vars.uniforms.uColorKey;
    const nb = u[1] ?? 0;
    if (nb >= 1.5) return 'round';
    if (nb >= 0.5) return 'full';
    return (u[0] ?? 0) > 0.5 ? 'magenta' : 'off';
  }

  /**
   * Silhouette override (`0xRRGGBB`, or `null` = off): every pixel that survives the colour key draws this
   * flat colour instead of its LUT colour — the sprite becomes its own keyed silhouette. The tool panel
   * stamps offset silhouette copies BEHIND a button glyph to give it a contrast outline against the strip;
   * the colour-keyed shape is identical to the real sprite's, so the rim hugs the glyph exactly.
   */
  set silhouette(color: number | null) {
    const u = this.vars.uniforms.uSilhouette;
    if (color === null) {
      u[3] = 0;
    } else {
      u[0] = ((color >> 16) & 0xff) / 255;
      u[1] = ((color >> 8) & 0xff) / 255;
      u[2] = (color & 0xff) / 255;
      u[3] = 1;
    }
    this.vars.update();
  }

  /**
   * Render UPRIGHT into a bottom-up WebGL render texture (default `false` = straight-to-canvas). A
   * PalettedSprite hand-rolls its screen→clip projection for the on-canvas Y convention, so drawn into a
   * render texture it lands upside-down; the tool panel corrects that by Y-flipping the whole baked sprite,
   * but that only works when EVERY element is a PalettedSprite. Setting this instead flips each mesh at the
   * source, so a panel that mixes PalettedSprites with Pixi-native content (Graphics, plain Sprites) can bake
   * WITHOUT a whole-texture flip. See `hud/details-panel/panel.ts`.
   */
  set flipY(on: boolean) {
    this.vars.uniforms.uFlip[0] = on ? 1 : 0;
    this.vars.update();
  }
  get flipY(): boolean {
    return (this.vars.uniforms.uFlip[0] ?? 0) > 0.5;
  }

  /**
   * Point the sprite at one atlas frame: bind the (indexed) atlas source and rewrite the quad to the frame's
   * native pixel size at its draw offset, with UVs into the `atlasWidth × atlasHeight` sheet. Screen
   * placement (feet anchor + zoom) is applied separately by {@link place}.
   */
  setFrame(source: TextureSource, frame: AtlasFrame, atlasWidth: number, atlasHeight: number): void {
    this.paletteShader.resources.uTexture = source;
    // Skip rebuilding + re-uploading the quad when the SAME frame is set again (an idle settler / a held
    // animation bob): the native-pixel geometry + UVs are unchanged — camera zoom is applied in-shader via
    // uPlacement, not baked here — so the buffers already hold the right values. Only an animation-frame
    // change or a new atlas rebuilds, so an unchanging crowd uploads nothing. `frame` is the atlas's stable
    // per-bob object (a Map value), so a reference check is exact.
    if (
      source === this.lastSource &&
      frame === this.lastFrame &&
      atlasWidth === this.lastAtlasW &&
      atlasHeight === this.lastAtlasH
    ) {
      return;
    }
    this.lastSource = source;
    this.lastFrame = frame;
    this.lastAtlasW = atlasWidth;
    this.lastAtlasH = atlasHeight;
    const { x, y, width, height, offsetX, offsetY } = frame;
    // Local-space quad in native bob pixels, pre-offset by the frame's draw origin (like a Sprite's
    // position). Write the eight floats STRAIGHT into the typed array — no throwaway literal `[...]` per call.
    const p = this.positions;
    p[0] = offsetX;
    p[1] = offsetY;
    p[2] = offsetX + width;
    p[3] = offsetY;
    p[4] = offsetX + width;
    p[5] = offsetY + height;
    p[6] = offsetX;
    p[7] = offsetY + height;
    const t = this.texUvs;
    t[0] = x / atlasWidth;
    t[1] = y / atlasHeight;
    t[2] = (x + width) / atlasWidth;
    t[3] = y / atlasHeight;
    t[4] = (x + width) / atlasWidth;
    t[5] = (y + height) / atlasHeight;
    t[6] = x / atlasWidth;
    t[7] = (y + height) / atlasHeight;
    // The frame's UV box (min, max) — the 'round' corner key normalizes a fragment's UV against it.
    const uv = this.vars.uniforms.uFrameUV;
    uv[0] = t[0];
    uv[1] = t[1];
    uv[2] = t[4];
    uv[3] = t[5];
    this.vars.update();
    const geo = this.geometry;
    geo.positions.set(this.positions);
    geo.uvs.set(this.texUvs);
    geo.getBuffer('aPosition').update();
    geo.getBuffer('aUV').update();
  }

  /**
   * Place the sprite: `origin` is its feet anchor in screen pixels, `scale` the pixels-per-native-pixel zoom,
   * `resolution` the canvas size. The vertex shader maps `origin + scale * localPixel` straight to clip space
   * (a custom-shader mesh can't use the scene-graph transform — see the class note).
   */
  place(originX: number, originY: number, scale: number, resWidth: number, resHeight: number): void {
    const u = this.vars.uniforms;
    u.uPlacement[0] = originX;
    u.uPlacement[1] = originY;
    u.uPlacement[2] = scale;
    u.uResolution[0] = resWidth;
    u.uResolution[1] = resHeight;
    this.vars.update();
  }

  /**
   * Stretch the current frame to a screen-space rectangle, ignoring its original bob draw offset. Used
   * for GUI chrome pieces we stretch into arbitrary window edges/bars (our composition choice — the
   * original's draw sites for these frames aren't decompiled in OpenVikings); ordinary world sprites
   * should keep using {@link place}.
   */
  stretchToRect(
    x: number,
    y: number,
    width: number,
    height: number,
    resWidth: number,
    resHeight: number,
  ): void {
    // The quad no longer matches the frame's native geometry — bust the setFrame memo so a later
    // setFrame with the same frame rebuilds the positions instead of keeping the stretched quad.
    this.lastAtlasW = -1;
    this.lastAtlasH = -1;
    const p = this.positions;
    p[0] = 0;
    p[1] = 0;
    p[2] = width;
    p[3] = 0;
    p[4] = width;
    p[5] = height;
    p[6] = 0;
    p[7] = height;
    const geo = this.geometry;
    geo.positions.set(this.positions);
    geo.getBuffer('aPosition').update();

    const u = this.vars.uniforms;
    u.uPlacement[0] = x;
    u.uPlacement[1] = y;
    u.uPlacement[2] = 1;
    u.uResolution[0] = resWidth;
    u.uResolution[1] = resHeight;
    this.vars.update();
  }

  /**
   * Pixi's `Mesh.destroy` only NULLS `_geometry`/`_shader`; the uploaded GPU buffers then wait for the
   * renderer's GC sweep (60 s unused-time). HUD panels churn PalettedSprites per rebuild (chrome pieces,
   * glyph runs), so release the per-sprite geometry buffers and the Shader (its uniform groups) with the
   * sprite. The GL *program* is Shader.from-cached and shared — `Shader.destroy()` leaves it alive.
   */
  override destroy(options?: Parameters<Mesh['destroy']>[0]): void {
    const geometry = this.geometry;
    const shader = this.paletteShader;
    super.destroy(options);
    geometry.destroy(true);
    shader.destroy();
  }
}
