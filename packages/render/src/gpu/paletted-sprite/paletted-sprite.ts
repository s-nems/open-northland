import { Mesh, type MeshGeometry, type Shader, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import { createPalettedGeometry, createPalettedShader, type PalettedUniforms } from './shader.js';

/**
 * GUI transparent-key mode for a {@link PalettedSprite} (see {@link PalettedSprite.colorKey}). `'off'` draws
 * straight; `'magenta'` keys only the index-0 sentinel; `'full'` also keys the whole near-black background
 * band (panel/window backdrops); `'round'` keys magenta and hard-clips everything outside the inscribed disc
 * regardless of colour, so a round order button drops its square frame + corners and reads as a clean disc
 * with its engraved glyph intact. A `'round'` sprite must be supersampled (baked at an integer oversample,
 * then downscaled) — the hard clip aliases the disc edge if drawn straight to screen.
 */
export type GuiColorKey = 'off' | 'magenta' | 'full' | 'round';

/**
 * A feet-anchored sprite whose colour is a per-player palette lookup rather than a baked texture — the
 * render half of the player (team) colour feature. The character atlas is decoded as indices (palette index
 * in red, mask in alpha; see the pipeline's `expandBobFrameIndexed`), and this sprite reads each index
 * through one row of a `256 × N` palette LUT texture, chosen by {@link PalettedSprite.player}. So a single
 * indexed atlas + one LUT texture draw all N player colours (only the clothing band differs per row) — no
 * per-player texture, and no per-sprite tint, which would recolour the whole figure (face + tools) rather
 * than the team band alone: team colour is a band-limited palette remap, not a flat tint.
 *
 * It is a custom-shader {@link Mesh} (a unit quad), because Pixi's batched `Sprite` can't run a custom
 * fragment shader. A custom-shader mesh bypasses batching (one draw call each) — acceptable at battle scale
 * where the sim, not the renderer, is the wall (see docs + render/AGENTS.md); keep it to characters.
 *
 * Positioning is manual (screen space). Pixi does not wire its transform uniform blocks into a custom
 * `Shader.from` program (the global-uniform UBO is left unbound), so a custom-shader mesh can't ride the
 * scene-graph transform — the caller supplies a feet-anchor screen position + scale via {@link place}, and
 * the vertex shader maps screen pixels straight to clip space with `uScreen`.
 *
 * All per-mesh varying values live in one `vec4` (`uPlacement`) mutated in place. These meshes share a
 * single compiled GL program, and on a shared program Pixi re-uploads a loose uniform only when its backing
 * `Float32Array` contents change — reassigning a scalar `f32` (a new number) is not picked up, so every mesh
 * would draw the last-written value.
 *
 * The GL program itself (vertex/fragment source, quad geometry, uniform wiring) lives in `./shader.ts`.
 */
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
  /** The layer's art scale (native px → design px) last placed with — stored so the mesh can be re-placed
   *  for an alternate camera (the details-panel portrait inset) without re-resolving its layer, by combining
   *  it with the inset camera's zoom. Set by the pool right after {@link place}. */
  artScale = 1;

  /**
   * @param lut the `256 × colours` palette LUT {@link TextureSource} (nearest-sampled). Shared across every
   *   PalettedSprite; only {@link player} selects the row.
   * @param colours the LUT's row count (player-colour palettes) — its pixel height.
   */
  constructor(lut: TextureSource, colours: number) {
    const shader = createPalettedShader(lut, colours);
    super({ geometry: createPalettedGeometry(), shader });
    this.paletteShader = shader;
    this.vars = shader.resources.vars as PalettedUniforms;
  }

  /** The player-colour row (0-based) this sprite reads from the LUT. Clamped to the LUT's row count so an
   *  out-of-range player id reads the last real colour rather than sampling past the texture — the shader
   *  has no bounds check of its own. */
  set player(row: number) {
    const rows = this.vars.uniforms.uLutSize[1] ?? 1;
    this.vars.uniforms.uPlacement[3] = row < 0 ? 0 : row > rows - 1 ? rows - 1 : row;
    this.vars.update();
  }
  get player(): number {
    return this.vars.uniforms.uPlacement[3] ?? 0;
  }

  /**
   * The GUI transparent key mode for this sprite (see {@link GuiColorKey} for the modes and the `'round'`
   * supersampling precondition). Defaults to `'off'`: world/character sprites never touch these colours.
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
   * flat colour instead of its LUT colour. The tool panel stamps offset silhouette copies behind a button
   * glyph to give it a contrast outline against the strip; the keyed shape is identical to the real
   * sprite's, so the rim hugs the glyph exactly.
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
   * Render upright into a bottom-up WebGL render texture (default `false` = straight-to-canvas). A
   * PalettedSprite hand-rolls its screen→clip projection for the on-canvas Y convention, so drawn into a
   * render texture it lands upside-down; the tool panel corrects that by Y-flipping the whole baked sprite,
   * which only works when every element is a PalettedSprite. Setting this instead flips each mesh at the
   * source, so a panel that mixes PalettedSprites with Pixi-native content (Graphics, plain Sprites) can bake
   * without a whole-texture flip. See `hud/details-panel/panel.ts`.
   */
  set flipY(on: boolean) {
    this.vars.uniforms.uFlip[0] = on ? 1 : 0;
    this.vars.update();
  }
  get flipY(): boolean {
    return (this.vars.uniforms.uFlip[0] ?? 0) > 0.5;
  }

  /** The terrain-shading multiplier (1 = neutral) the fragment shader scales the LUT colour by — the
   *  paletted twin of a plain sprite's brightness tint, except it can brighten past 1 (the FB clamps). */
  set brightness(value: number) {
    this.vars.uniforms.uBrightness[0] = value;
    this.vars.update();
  }
  get brightness(): number {
    return this.vars.uniforms.uBrightness[0] ?? 1;
  }

  /**
   * Point the sprite at one atlas frame: bind the (indexed) atlas source and rewrite the quad to the frame's
   * native pixel size at its draw offset, with UVs into the `atlasWidth × atlasHeight` sheet. Screen
   * placement (feet anchor + zoom) is applied separately by {@link place}.
   */
  setFrame(source: TextureSource, frame: AtlasFrame, atlasWidth: number, atlasHeight: number): void {
    this.paletteShader.resources.uTexture = source;
    // On a re-set of the same frame the buffers already hold the right values: camera zoom is applied
    // in-shader via uPlacement, not baked into the native-pixel geometry + UVs here. `frame` is the atlas's
    // stable per-bob object (a Map value), so a reference check is exact.
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
    // Local-space quad in native bob pixels, pre-offset by the frame's draw origin (like a Sprite's position).
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
   * `resolution` the canvas size. The vertex shader maps `origin + scale * localPixel` straight to clip
   * space.
   */
  place(originX: number, originY: number, scale: number, resWidth: number, resHeight: number): void {
    const u = this.vars.uniforms;
    u.uPlacement[0] = originX;
    u.uPlacement[1] = originY;
    u.uPlacement[2] = scale;
    u.uScreen[0] = resWidth;
    u.uScreen[1] = resHeight;
    this.vars.update();
  }

  /**
   * Stretch the current frame to a screen-space rectangle, ignoring its original bob draw offset. Used
   * for GUI chrome pieces we stretch into arbitrary window edges/bars (an OpenNorthland composition
   * choice because the original draw-site behavior has not been established); ordinary world sprites
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
    u.uScreen[0] = resWidth;
    u.uScreen[1] = resHeight;
    this.vars.update();
  }

  /**
   * Pixi's `Mesh.destroy` only nulls `_geometry`/`_shader`; the uploaded GPU buffers then wait for the
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
