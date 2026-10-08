import type { Container, Sprite, Texture } from 'pixi.js';
import type { WindSway } from '../../data/weather/climate.js';
import { isDrawableResource, readable2dContext } from '../drawable-resource.js';
import type { DamagedBuilding } from '../sprite-pool/pick.js';
import type { ResolvedLayer } from '../sprite-pool/resolved-layer.js';
import { DamageAtlas, type DamageTile } from './atlas.js';
import { DamageEffectTextures } from './effect-textures.js';
import { DamageEffects, type DamageOrigin } from './effects.js';
import { type GroundContact, groundContacts } from './rubble.js';
import { analyseSurface, damageStage, type Fracture, scarSurface } from './surface.js';

export interface DamageSubject {
  readonly container: Container;
  readonly damageBodies?: readonly Sprite[];
}

/** A collapse borrows the last visible damaged body until its own transient ends. */
export interface FallenBody {
  readonly texture: Texture;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly alpha: number;
  release(): void;
}

const NO_GROUND: readonly GroundContact[] = [];
const MAX_DAMAGE_NODES = 128;
const MAX_PIXEL_BYTES = 32 * 1024 * 1024;

interface Surface {
  readonly sprite: Sprite;
  readonly original: Texture;
  readonly pixels: Uint8ClampedArray;
  readonly backing: Uint8ClampedArray | undefined;
  readonly bytes: number;
  readonly ground: readonly GroundContact[];
  readonly fractures: readonly Fracture[];
  readonly width: number;
  readonly height: number;
  tile: DamageTile | null;
  stage: number;
}

interface DamageNode {
  readonly subject: DamageSubject;
  readonly surfaces: Map<Sprite, Surface>;
  readonly effects: DamageEffects;
  readonly origins: DamageOrigin[];
}

/** Visible-only damage ownership. The normal binder still owns the original texture; this pass swaps
 * its body for a scarred copy and restores it before releasing the slot. Rebinding, culling, repair,
 * upgrading and a live settings flip all go through the same lifetime. */
export class BuildingDamage {
  private readonly atlas = new DamageAtlas();
  private art: DamageEffectTextures | undefined;
  private readonly nodes = new Map<number, DamageNode>();
  private readonly seen = new Set<number>();
  private scratch: ReturnType<typeof readable2dContext> = null;
  private scratchTried = false;
  private pixelBytes = 0;
  private scanOffset = 0;
  private readonly unreadable = new WeakSet<Texture>();

  constructor(private readonly scaffoldOf?: (ref: number) => readonly ResolvedLayer[]) {}

  /** Freeze the complete visible body stack before the live pool releases it. Revealing/fading layers
   * need their own pixels: the normal texture cache may evict their source during the collapse. */
  capture(ref: number, sprites?: readonly Sprite[]): readonly FallenBody[] | undefined {
    const node = this.nodes.get(ref);
    if (node === undefined) return undefined;
    const prepared: { sprite: Sprite; tile: DamageTile; borrowed: boolean }[] = [];
    for (const sprite of sprites ?? node.subject.damageBodies ?? []) {
      if (sprite.destroyed || !sprite.visible || sprite.alpha <= 0 || sprite.texture.width < 2) continue;
      const surface = node.surfaces.get(sprite);
      let tile = surface?.tile ?? null;
      const borrowed = tile !== null;
      if (tile === null) {
        const pixels = this.read(sprite, ref);
        if (pixels !== null) {
          tile = this.atlas.allocate(pixels.width, pixels.height, pixels.original);
          if (tile !== null) this.atlas.write(tile, pixels.pixels, pixels.width, pixels.height);
        }
      }
      if (tile === null) {
        // A partial stack would drop scaffolds or moving parts. Under memory pressure the collapse
        // resolves its complete normal appearance instead, as it does for an unseen destruction.
        for (const part of prepared) if (!part.borrowed) this.atlas.release(part.tile);
        return undefined;
      }
      prepared.push({ sprite, tile, borrowed });
    }
    const bodies: FallenBody[] = [];
    for (const { sprite, tile, borrowed } of prepared) {
      bodies.push({
        texture: tile.texture,
        x: sprite.x,
        y: sprite.y,
        scale: sprite.scale.x,
        alpha: sprite.alpha,
        release: () => this.atlas.release(tile),
      });
      const surface = node.surfaces.get(sprite);
      if (borrowed && surface !== undefined) {
        if (sprite.texture === tile.texture) sprite.texture = surface.original;
        surface.tile = null;
      }
    }
    this.retire(node);
    this.nodes.delete(ref);
    return bodies.length > 0 ? bodies : undefined;
  }

  draw(
    damaged: readonly DamagedBuilding[],
    subjectOf: (ref: number) => DamageSubject | undefined,
    tick: number,
    wind: WindSway | undefined,
    detailed: boolean,
    smooth: boolean,
    zoom: number,
  ): void {
    this.seen.clear();
    // Pixel reads and bakes are rationed even on the opening view; a large damaged town fills in over
    // several frames without one long synchronous canvas pass. Steady-state bodies do no pixel work.
    let budget = 2;
    const start = this.scanOffset % Math.max(1, damaged.length);
    this.scanOffset = start + 1;
    for (let i = 0; i < damaged.length; i++) {
      const item = damaged[(start + i) % damaged.length];
      if (item === undefined) continue;
      const { ref, hpFrac, ghost } = item;
      const stage = damageStage(hpFrac);
      if (stage === 0) continue;
      const subject = subjectOf(ref);
      if (subject?.damageBodies === undefined || subject.damageBodies.length === 0) continue;
      let node = this.nodes.get(ref);
      if (node !== undefined && node.subject !== subject) {
        this.retire(node);
        this.nodes.delete(ref);
        node = undefined;
      }
      if (node === undefined) {
        if (this.nodes.size >= MAX_DAMAGE_NODES) continue;
        this.art ??= new DamageEffectTextures();
        node = { subject, surfaces: new Map(), effects: new DamageEffects(this.art, ref), origins: [] };
        this.nodes.set(ref, node);
        subject.container.addChild(node.effects.container);
      }
      this.seen.add(ref);
      // A construction rebind can append another body after the effects.
      if (subject.container.children.at(-1) !== node.effects.container)
        subject.container.addChild(node.effects.container);
      for (const [sprite, surface] of node.surfaces) {
        if (
          sprite.destroyed ||
          !subject.damageBodies.includes(sprite) ||
          (sprite.texture !== surface.original && sprite.texture !== surface.tile?.texture)
        ) {
          this.release(surface);
          this.pixelBytes -= surface.bytes;
          node.surfaces.delete(sprite);
        }
      }
      for (const sprite of subject.damageBodies) {
        if (!sprite.visible || sprite.alpha <= 0 || sprite.destroyed) continue;
        let surface = node.surfaces.get(sprite);
        if (surface === undefined) {
          if (!detailed || this.unreadable.has(sprite.texture)) continue;
          if (budget <= 0) continue;
          budget--;
          surface = this.read(sprite, ref, true) ?? undefined;
          if (surface === undefined) continue;
          this.pixelBytes += surface.bytes;
          node.surfaces.set(sprite, surface);
        }
        if (!detailed) {
          if (surface.tile !== null) {
            this.release(surface);
            surface.stage = 0;
          }
        } else if (surface.stage !== stage && budget > 0) {
          budget--;
          surface.tile ??= this.atlas.allocate(surface.width, surface.height, surface.original);
          if (surface.tile !== null) {
            this.atlas.write(
              surface.tile,
              scarSurface(
                surface.pixels,
                surface.width,
                surface.height,
                surface.fractures,
                stage,
                surface.backing,
              ),
              surface.width,
              surface.height,
            );
            surface.stage = stage;
          }
        }
        if (surface.tile !== null) sprite.texture = surface.tile.texture;
      }
      const ground = this.placeOrigins(node);
      node.effects.container.visible = ghost !== true;
      if (ghost !== true) node.effects.draw(node.origins, hpFrac, stage, tick, wind, detailed, zoom, ground);
    }
    for (const [ref, node] of this.nodes) {
      if (this.seen.has(ref)) continue;
      this.retire(node);
      this.nodes.delete(ref);
    }
    this.atlas.flush(smooth);
  }

  private read(sprite: Sprite, seed: number, withScaffold = false): Surface | null {
    const original = sprite.texture;
    const { width, height, x, y } = original.frame;
    if (width < 8 || height < 8 || width > 1000 || height > 1000) {
      this.unreadable.add(original);
      return null;
    }
    const resource: unknown = original.source.resource;
    if (!isDrawableResource(resource)) {
      this.unreadable.add(original);
      return null;
    }
    if (this.pixelBytes + width * height * 4 > MAX_PIXEL_BYTES) return null;
    if (!this.scratchTried) {
      this.scratchTried = true;
      this.scratch = readable2dContext(1024, 1024);
    }
    const ctx = this.scratch;
    if (ctx === null) {
      this.unreadable.add(original);
      return null;
    }
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(resource, x, y, width, height, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const backing =
        withScaffold && this.pixelBytes + pixels.byteLength * 2 <= MAX_PIXEL_BYTES
          ? this.readScaffold(sprite, seed, ctx, width, height)
          : undefined;
      return {
        sprite,
        original,
        pixels,
        backing,
        bytes: pixels.byteLength + (backing?.byteLength ?? 0),
        ground: groundContacts(pixels, width, height, sprite.x, sprite.y, sprite.scale.x),
        width,
        height,
        fractures: analyseSurface(pixels, width, height, seed),
        tile: null,
        stage: 0,
      };
    } catch {
      this.unreadable.add(original);
      return null;
    }
  }

  private readScaffold(
    sprite: Sprite,
    ref: number,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ): Uint8ClampedArray | undefined {
    const layers = this.scaffoldOf?.(ref);
    if (layers === undefined || layers.length === 0 || sprite.scale.x <= 0 || sprite.scale.y <= 0)
      return undefined;
    ctx.clearRect(0, 0, width, height);
    let drew = false;
    for (const layer of layers) {
      const resource: unknown = layer.source.resource;
      if (!isDrawableResource(resource)) continue;
      const f = layer.frame;
      ctx.drawImage(
        resource,
        f.x,
        f.y,
        f.width,
        f.height,
        (f.offsetX * layer.scale - sprite.x) / sprite.scale.x,
        (f.offsetY * layer.scale - sprite.y) / sprite.scale.y,
        (f.width * layer.scale) / sprite.scale.x,
        (f.height * layer.scale) / sprite.scale.y,
      );
      drew = true;
    }
    return drew ? ctx.getImageData(0, 0, width, height).data : undefined;
  }

  private placeOrigins(node: DamageNode): readonly GroundContact[] {
    // The largest visible body supplies the roof; tiny accessory bobs must not start their own fires.
    let largest: Surface | undefined;
    for (const surface of node.surfaces.values()) {
      if (!surface.sprite.visible || surface.sprite.alpha <= 0) continue;
      if (largest === undefined || surface.width * surface.height > largest.width * largest.height)
        largest = surface;
    }
    if (largest === undefined) {
      const sprite = node.subject.damageBodies?.find((s) => s.visible && s.alpha > 0);
      if (sprite === undefined) {
        node.origins.length = 0;
        return NO_GROUND;
      }
      const x = sprite.x + sprite.width * 0.5;
      const y = sprite.y + sprite.height * 0.35;
      const previous = node.origins[0];
      if (previous?.x !== x || previous.y !== y)
        node.origins[0] = { x, y, size: 13, seed: 0, colour: 0x947953 };
      node.origins.length = 1;
      return NO_GROUND;
    }
    const { sprite, fractures } = largest;
    let count = 0;
    for (const f of fractures) {
      if (!f.roof || f.open || count >= 4) continue;
      const x = sprite.x + f.x * sprite.scale.x;
      const y = sprite.y + f.y * sprite.scale.y;
      const size = f.radius * Math.abs(sprite.scale.x);
      const colour = (f.colour[0] << 16) | (f.colour[1] << 8) | f.colour[2];
      const previous = node.origins[count];
      if (previous?.x !== x || previous.y !== y || previous.size !== size || previous.seed !== f.seed)
        node.origins[count] = { x, y, size, seed: f.seed, colour };
      count++;
    }
    node.origins.length = count;
    return largest.ground;
  }

  private release(surface: Surface): void {
    if (surface.tile === null) return;
    if (!surface.sprite.destroyed && surface.sprite.texture === surface.tile.texture)
      surface.sprite.texture = surface.original;
    this.atlas.release(surface.tile);
    surface.tile = null;
  }

  private retire(node: DamageNode): void {
    for (const surface of node.surfaces.values()) {
      this.release(surface);
      this.pixelBytes -= surface.bytes;
    }
    node.effects.destroy();
  }

  destroy(): void {
    for (const node of this.nodes.values()) this.retire(node);
    this.nodes.clear();
    this.atlas.destroy();
    this.art?.destroy();
    this.scratch = null;
  }
}
