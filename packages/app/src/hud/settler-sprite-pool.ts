import { PalettedSprite, type ResolvedLayer, type SpriteSheet } from '@open-northland/render';
import { type Application, type Container, Rectangle, Sprite, Texture } from 'pixi.js';

/**
 * Feet-anchored settler layers drawn into a HUD container as on the map, pooled by a caller-chosen key
 * so a redraw reuses meshes instead of minting them. The LUT sheet draws through `PalettedSprite`; a
 * baked-palette sheet falls back to plain sprites over cached frame textures.
 */
export class SettlerSpritePool {
  private readonly sprites = new Map<string, PalettedSprite | Sprite>();
  private readonly plainTextures = new Map<object, Texture>();
  private readonly drawn = new Set<string>();

  constructor(
    private readonly app: Application,
    private readonly sheet: SpriteSheet | undefined,
    private readonly container: Container,
  ) {}

  /** Start a redraw: every key not drawn before {@link hideRest} is hidden. */
  begin(): void {
    this.drawn.clear();
  }

  drawLayer(
    key: string,
    layer: ResolvedLayer,
    feetX: number,
    feetY: number,
    zoom: number,
    playerRow: number,
  ): void {
    const lut = this.sheet?.palette;
    if (lut !== undefined) {
      let spr = this.sprites.get(key);
      if (!(spr instanceof PalettedSprite)) {
        spr?.destroy();
        spr = new PalettedSprite(lut.source, lut.colours);
        this.sprites.set(key, spr);
        this.container.addChild(spr);
      }
      spr.setFrame(
        layer.source,
        layer.frame,
        layer.atlasW ?? layer.frame.width,
        layer.atlasH ?? layer.frame.height,
      );
      spr.place(feetX, feetY, zoom * layer.scale, this.app.screen.width, this.app.screen.height);
      spr.player = playerRow;
      spr.visible = true;
    } else {
      let spr = this.sprites.get(key);
      if (spr instanceof PalettedSprite || spr === undefined) {
        spr?.destroy();
        spr = new Sprite();
        this.sprites.set(key, spr);
        this.container.addChild(spr);
      }
      spr.texture = this.plainTexture(layer.source, layer.frame);
      const s = zoom * layer.scale;
      spr.width = layer.frame.width * s;
      spr.height = layer.frame.height * s;
      spr.position.set(feetX + layer.frame.offsetX * s, feetY + layer.frame.offsetY * s);
      spr.visible = true;
    }
    this.drawn.add(key);
  }

  hideRest(): void {
    for (const [key, spr] of this.sprites) {
      if (!this.drawn.has(key)) spr.visible = false;
    }
  }

  /** Release the pooled meshes and cached textures; the container itself belongs to the caller. */
  dispose(): void {
    for (const spr of this.sprites.values()) spr.destroy();
    this.sprites.clear();
    for (const texture of this.plainTextures.values()) texture.destroy(false);
    this.plainTextures.clear();
  }

  private plainTexture(source: ResolvedLayer['source'], frame: ResolvedLayer['frame']): Texture {
    const cached = this.plainTextures.get(frame);
    if (cached !== undefined) return cached;
    const tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    this.plainTextures.set(frame, tex);
    return tex;
  }
}
