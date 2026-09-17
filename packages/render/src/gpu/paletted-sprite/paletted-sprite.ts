import { Mesh, type MeshGeometry, type Shader, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import {
  createPalettedGeometry,
  createPalettedShader,
  PALETTED_SAMPLING_MODES,
  type PalettedSampling,
  type PalettedUniforms,
} from './shader.js';

/**
 * GUI transparent-key mode for a {@link PalettedSprite}. `'off'` draws straight; `'magenta'` keys only the
 * index-0 sentinel; `'full'` also keys the whole near-black background band (panel/window backdrops);
 * `'round'` keys magenta and hard-clips everything outside the inscribed disc regardless of colour, so a
 * round order button drops its square frame and corners with its engraved glyph intact. A `'round'` sprite
 * must be supersampled - the hard clip aliases the disc edge if drawn straight to screen.
 */
export type GuiColorKey = 'off' | 'magenta' | 'full' | 'round';

/**
 * A feet-anchored sprite whose colour is a per-player palette lookup rather than a baked texture: the
 * indexed atlas holds a palette index in red and a mask in alpha, and each index is read through the
 * `256 × N` LUT row chosen by {@link PalettedSprite.player}. Team colour is a palette-band remap, not a
 * whole-sprite tint, and one indexed atlas plus one LUT draw all N player colours.
 *
 * It is a custom-shader {@link Mesh} because Pixi's batched `Sprite` cannot run a custom fragment shader.
 * That bypasses batching (one draw call each), so keep it to characters.
 *
 * Positioning is manual, in screen space via {@link place}: Pixi does not wire its transform uniform
 * blocks into a custom `Shader.from` program, so the mesh cannot ride the scene-graph transform.
 */
export class PalettedSprite extends Mesh<MeshGeometry, Shader> {
  private readonly positions = new Float32Array(8);
  private readonly texUvs = new Float32Array(8);
  private readonly paletteShader: Shader;
  private readonly vars: PalettedUniforms;
  /** The (source, frame, atlas size) the quad buffers were last built for - {@link setFrame} skips the
   *  rebuild and GPU re-upload when they are unchanged. */
  private lastSource?: TextureSource;
  private lastFrame?: AtlasFrame;
  private lastAtlasW = -1;
  private lastAtlasH = -1;
  /** The layer's art scale (native px → design px) last placed with, kept so the mesh can be re-placed for
   *  an alternate camera without re-resolving its layer. Set by the pool right after {@link place}. */
  artScale = 1;

  /**
   * @param lut the `256 × colours` palette LUT (nearest-sampled), shared across every PalettedSprite.
   * @param colours the LUT's row count - its pixel height.
   */
  constructor(lut: TextureSource, colours: number) {
    const shader = createPalettedShader(lut, colours);
    super({ geometry: createPalettedGeometry(), shader });
    this.paletteShader = shader;
    this.vars = shader.resources.vars as PalettedUniforms;
  }

  /** The player-colour row (0-based) this sprite reads from the LUT. Clamped to the LUT's row count,
   *  because the shader has no bounds check of its own. */
  set player(row: number) {
    const rows = this.vars.uniforms.uLutSize[1] ?? 1;
    this.vars.uniforms.uPlacement[3] = row < 0 ? 0 : row > rows - 1 ? rows - 1 : row;
    this.vars.update();
  }
  get player(): number {
    return this.vars.uniforms.uPlacement[3] ?? 0;
  }

  /** Defaults to `'off'`: world and character sprites never touch the keyed colours. */
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
   * flat colour instead of its LUT colour, so an offset copy stamped behind a glyph outlines it exactly.
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
   * Render upright into a bottom-up WebGL render texture (default `false` = straight-to-canvas). Flipping
   * at the source lets a panel that mixes PalettedSprites with Pixi-native content bake without the
   * whole-texture flip that only an all-PalettedSprite source allows.
   */
  set flipY(on: boolean) {
    this.vars.uniforms.uFlip[0] = on ? 1 : 0;
    this.vars.update();
  }
  get flipY(): boolean {
    return (this.vars.uniforms.uFlip[0] ?? 0) > 0.5;
  }

  /** Palette colours are resolved before any blending; the stored indices are never interpolated. */
  set sampling(mode: PalettedSampling) {
    const next = PALETTED_SAMPLING_MODES[mode];
    if (this.vars.uniforms.uSampling[0] === next) return;
    this.vars.uniforms.uSampling[0] = next;
    this.vars.update();
  }
  get sampling(): PalettedSampling {
    const value = this.vars.uniforms.uSampling[0] ?? 0;
    return (
      (Object.keys(PALETTED_SAMPLING_MODES) as PalettedSampling[]).find(
        (mode) => PALETTED_SAMPLING_MODES[mode] === value,
      ) ?? 'nearest'
    );
  }

  /**
   * Point the sprite at one atlas frame: bind the indexed atlas source and rewrite the quad to the frame's
   * native pixel size at its draw offset, with UVs into the `atlasWidth × atlasHeight` sheet. Screen
   * placement is applied separately by {@link place}.
   */
  setFrame(source: TextureSource, frame: AtlasFrame, atlasWidth: number, atlasHeight: number): void {
    this.paletteShader.resources.uTexture = source;
    // Camera zoom is applied in-shader via uPlacement, not baked into this native-pixel geometry, so a
    // re-set of the same frame is a no-op. `frame` is the atlas's stable per-bob object, so the reference
    // check is exact.
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
    // Local-space quad in native bob pixels, pre-offset by the frame's draw origin.
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
    // The frame's UV box (min, max) - the 'round' corner key normalizes a fragment's UV against it.
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
   * `origin` is the feet anchor in screen pixels, `scale` the pixels-per-native-pixel zoom, `resWidth`/
   * `resHeight` the canvas size. The vertex shader maps `origin + scale * localPixel` straight to clip space.
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
   * Stretch the current frame to a screen-space rectangle, ignoring its original bob draw offset. For GUI
   * chrome stretched into arbitrary window edges and bars: an OpenNorthland composition choice, since the
   * original's draw-site behavior has not been established. World sprites use {@link place}.
   */
  stretchToRect(
    x: number,
    y: number,
    width: number,
    height: number,
    resWidth: number,
    resHeight: number,
  ): void {
    // The quad no longer matches the frame's native geometry, so bust the setFrame memo: a later setFrame
    // with the same frame must rebuild the positions instead of keeping the stretched quad.
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
   * Pixi's `Mesh.destroy` only nulls `_geometry`/`_shader`, leaving the uploaded GPU buffers to the
   * renderer's GC sweep, and HUD panels churn PalettedSprites per rebuild - so release the per-sprite
   * geometry buffers and the Shader here. The GL program is `Shader.from`-cached and stays alive.
   */
  override destroy(options?: Parameters<Mesh['destroy']>[0]): void {
    const geometry = this.geometry;
    const shader = this.paletteShader;
    super.destroy(options);
    geometry.destroy(true);
    shader.destroy();
  }
}
