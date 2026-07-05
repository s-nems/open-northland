import { Mesh, MeshGeometry, Shader, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites.js';

/**
 * GUI transparent-key mode for a {@link PalettedSprite} (see {@link PalettedSprite.colorKey}). `'off'` draws
 * straight; `'magenta'` keys only the index-0 sentinel (opaque order buttons); `'full'` also keys the
 * near-black background band (panel/window backdrops).
 */
export type GuiColorKey = 'off' | 'magenta' | 'full';

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
 * the sim, not the renderer, is the wall (see docs + render/CLAUDE.md), and the payoff is the one-atlas,
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

void main(void) {
  vec2 screen = uPlacement.xy + uPlacement.z * aPosition;
  // Screen pixels → clip space (Y points down in screen space, up in clip space).
  gl_Position = vec4(screen.x / uResolution.x * 2.0 - 1.0, 1.0 - screen.y / uResolution.y * 2.0, 0.0, 1.0);
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
uniform vec2 uColorKey;     // .x > 0.5: key the magenta sentinel; .y > 0.5: ALSO key the near-black band

// GUI transparent key — OUR floating-HUD deviation, NOT an original mechanism (the engine blitter has no
// colour key; see docs/FIDELITY.md "Left tool panel"). The in-game GUI palettes (iconsleft/context/…) reserve
// palette index 0 as a MAGENTA sentinel (255,0,255) and a band of near-black entries (max channel ≲ 28/255)
// as each element's background. A bob writes them opaque (transparency is skip-runs), so an element drawn
// straight would carry an opaque dark rectangle over the world — which the original hid by rendering gameplay
// in a dedicated area, but we render full-screen.
//
// The two classes are keyed INDEPENDENTLY (uColorKey.x = magenta, uColorKey.y = near-black), because they are
// NOT both "background" for every element. Large panel/window elements (iconsleft) use the near-black band as a
// removable backdrop → key both. But the round wooden ORDER buttons (context palette) paint their OWN bevel rim
// AND their engraved glyph in that same near-black — keying it there punches holes THROUGH the art (the
// "chipped/holey" look). Those buttons are fully opaque by design, so they key magenta only (near-black off) and
// render as solid buttons. Character LUTs produce neither class and leave both flags 0, so this is inert for
// the world sprites.
const float KEY_MAGENTA_HI = 0.9;  // r AND b above this …
const float KEY_MAGENTA_LO = 0.1;  // … with g below this → the magenta sentinel (index 0)
const float KEY_NEAR_BLACK = 0.11; // max channel below this (≈28/255) → the near-black background band

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
    bool nearBlack = max(max(rgb.r, rgb.g), rgb.b) < KEY_NEAR_BLACK;
    if (nearBlack) discard;
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
    /** [keyMagenta, keyNearBlack] — a `Float32Array` (NOT a scalar `f32`, which a shared program won't
     *  re-upload per-mesh; see the class note) so each sprite carries its own GUI-key flags. */
    uColorKey: Float32Array;
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
   * - `'magenta'`— discard only the magenta sentinel (palette index 0). For the round wooden ORDER buttons,
   *   which are opaque by design and paint their bevel + engraving in the near-black band — keying that band
   *   would punch holes through the glyph.
   * - `'full'`   — discard magenta AND the near-black background band. For large panel/window elements whose
   *   near-black backdrop must not paint a dark rectangle over the world.
   */
  set colorKey(mode: GuiColorKey) {
    const u = this.vars.uniforms.uColorKey;
    u[0] = mode === 'off' ? 0 : 1; // magenta key: on for 'magenta' + 'full'
    u[1] = mode === 'full' ? 1 : 0; // near-black band: on for 'full' only
    this.vars.update();
  }
  get colorKey(): GuiColorKey {
    const u = this.vars.uniforms.uColorKey;
    if ((u[1] ?? 0) > 0.5) return 'full';
    return (u[0] ?? 0) > 0.5 ? 'magenta' : 'off';
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
}
