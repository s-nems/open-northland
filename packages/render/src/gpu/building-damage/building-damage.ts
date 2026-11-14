import type { Container, Sprite, Texture } from 'pixi.js';
import type { WindSway } from '../../data/weather/climate.js';
import type { ResolvedLayer } from '../sprite-pool/layers/resolved-layer.js';
import type { DamagedBuilding } from '../sprite-pool/picking/pick.js';
import { readable2dContext } from '../textures/drawable-resource.js';
import { drawableFrame, drawableTexture } from '../textures/recoloured-pages.js';
import { DamageAtlas, type DamageTile } from './atlas.js';
import { DamageEffectTextures } from './effect-textures.js';
import {
  BUILDING_DAMAGE_STYLE,
  type DamageEffectStyle,
  DamageEffects,
  type DamageOrigin,
  LAND_VEHICLE_DAMAGE_STYLE,
  PLAIN_DAMAGE_STYLE,
} from './effects.js';
import { DamagePaintCache } from './paint-cache.js';
import { type GroundContact, groundContacts } from './rubble.js';
import { analyseSurface, damageLevel, type Fracture } from './surface.js';

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
  readonly layer?: ResolvedLayer;
  readonly damageLevel?: number;
  release(): void;
}

const NO_GROUND: readonly GroundContact[] = [];
const MAX_DAMAGE_NODES = 128;
const MAX_PIXEL_BYTES = 32 * 1024 * 1024;
/** Scarred frames one turning, working vehicle keeps beside the one it shows. */
const MAX_PARKED_SURFACES = 24;
/** Scarred frames every vehicle together may keep parked, so a column of them cannot crowd the
 *  buildings out of the shared atlas. A vehicle past it bakes its frames again as it turns. */
const MAX_PARKED_TOTAL = 96;
/** The plume and chip source of a body whose pixels are not read for a roof: its size and wood colour. */
const PLAIN_ORIGIN_SIZE = 13;
const PLAIN_ORIGIN_COLOUR = 0x947953;
/** A vehicle's one plume, sized so its few puffs still read. Tuned by eye. */
const VEHICLE_ORIGIN_SIZE = 20;

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
  level: number;
}

interface DamageNode {
  readonly subject: DamageSubject;
  readonly surfaces: Map<Sprite, Surface>;
  /** A vehicle's scarred frames it is not showing, by their source texture, oldest first: it returns
   *  to each as it turns and works, so they are kept instead of baked again. */
  readonly parked: Map<Texture, Surface>;
  readonly vehicle: boolean;
  effects: DamageEffects;
  detailed: boolean;
  readonly origins: DamageOrigin[];
  bodyOffset: number;
}

/** Visible-only damage ownership. The normal binder still owns the original texture; this pass swaps
 * its body for a scarred copy and restores it before releasing the slot. Rebinding, culling, repair,
 * upgrading and a live settings flip all go through the same lifetime. */
export class BuildingDamage {
  private readonly atlas = new DamageAtlas();
  private readonly painter = new DamagePaintCache();
  private art: DamageEffectTextures | undefined;
  private baselineArt: DamageEffectTextures | undefined;
  private readonly nodes = new Map<number, DamageNode>();
  private readonly seen = new Set<number>();
  private scratch: ReturnType<typeof readable2dContext> = null;
  private scratchTried = false;
  private pixelBytes = 0;
  private parkedTotal = 0;
  private scanOffset = 0;
  private readonly unreadable = new WeakSet<Texture>();

  constructor(private readonly scaffoldOf?: (ref: number) => readonly ResolvedLayer[]) {}

  /** Freeze the complete visible body stack before the live pool releases it. Revealing/fading layers
   * need their own pixels: the normal texture cache may evict their source during the collapse. */
  capture(
    ref: number,
    sprites?: readonly Sprite[],
    layerOf?: (sprite: Sprite) => ResolvedLayer | undefined,
  ): readonly FallenBody[] | undefined {
    const node = this.nodes.get(ref);
    if (node === undefined && sprites === undefined) return undefined;
    const prepared: { sprite: Sprite; tile: DamageTile; borrowed: boolean }[] = [];
    for (const sprite of sprites ?? node?.subject.damageBodies ?? []) {
      if (sprite.destroyed || !sprite.visible || sprite.alpha <= 0 || sprite.texture.width < 2) continue;
      const surface = node?.surfaces.get(sprite);
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
      const layer = layerOf?.(sprite);
      const surface = node?.surfaces.get(sprite);
      bodies.push({
        texture: tile.texture,
        x: sprite.x,
        y: sprite.y,
        scale: sprite.scale.x,
        alpha: sprite.alpha,
        ...(layer !== undefined ? { layer } : {}),
        damageLevel: surface?.level ?? 0,
        release: () => this.atlas.release(tile),
      });
      if (borrowed && surface !== undefined) {
        if (sprite.texture === tile.texture) sprite.texture = surface.original;
        surface.tile = null;
      }
    }
    if (node !== undefined) this.retire(node);
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
    // Separate preparation from painting so a changing construction source can bake in the same frame.
    // A blended body uses both paint slots; steady-state bodies do no pixel work.
    let preparations = 1;
    let paints = 2;
    const start = this.scanOffset % Math.max(1, damaged.length);
    this.scanOffset = start + 1;
    for (let i = 0; i < damaged.length; i++) {
      const item = damaged[(start + i) % damaged.length];
      if (item === undefined) continue;
      const { ref, hpFrac, ghost } = item;
      const vehicle = item.vehicle === true;
      const level = damageLevel(hpFrac);
      // Retain a baked blend until the next small health increment.
      const bakedLevel = Math.round(level * 16) / 16;
      const bakeCost = Number.isInteger(bakedLevel) ? 1 : 2;
      if (bakedLevel === 0) continue;
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
        node = {
          subject,
          surfaces: new Map(),
          parked: new Map(),
          vehicle,
          effects: this.createEffects(ref, detailed, vehicle),
          detailed,
          origins: [],
          bodyOffset: 0,
        };
        this.nodes.set(ref, node);
        subject.container.addChild(node.effects.container);
      } else if (node.detailed !== detailed) {
        node.effects.destroy();
        node.effects = this.createEffects(ref, detailed, vehicle);
        node.detailed = detailed;
        subject.container.addChild(node.effects.container);
      }
      this.seen.add(ref);
      // A construction rebind can append another body after the effects.
      if (subject.container.children.at(-1) !== node.effects.container)
        subject.container.addChild(node.effects.container);
      for (const [sprite, surface] of node.surfaces) {
        const rebound = sprite.texture !== surface.original && sprite.texture !== surface.tile?.texture;
        if (rebound && detailed && vehicle && !sprite.destroyed && subject.damageBodies.includes(sprite)) {
          this.park(node, surface);
          node.surfaces.delete(sprite);
        } else if (sprite.destroyed || !subject.damageBodies.includes(sprite) || rebound) {
          this.release(surface);
          this.pixelBytes -= surface.bytes;
          node.surfaces.delete(sprite);
        } else if (!detailed) {
          this.release(surface);
          surface.level = 0;
        }
      }
      if (!detailed) this.clearParked(node);
      const bodyStart = node.bodyOffset % subject.damageBodies.length;
      let firstWorkedBody: number | undefined;
      for (let body = 0; body < subject.damageBodies.length; body++) {
        const sprite = subject.damageBodies[(bodyStart + body) % subject.damageBodies.length];
        if (sprite === undefined) continue;
        if (!sprite.visible || sprite.alpha <= 0 || sprite.destroyed) continue;
        let surface = node.surfaces.get(sprite);
        if (surface === undefined) {
          const parked = node.parked.get(sprite.texture);
          if (parked !== undefined && parked.sprite === sprite) {
            node.parked.delete(sprite.texture);
            this.parkedTotal--;
            node.surfaces.set(sprite, parked);
            surface = parked;
          }
        }
        if (surface === undefined) {
          if (!detailed || this.unreadable.has(sprite.texture)) continue;
          if (preparations <= 0) continue;
          preparations--;
          firstWorkedBody ??= body;
          surface = this.read(sprite, ref, true) ?? undefined;
          if (surface === undefined) continue;
          this.pixelBytes += surface.bytes;
          node.surfaces.set(sprite, surface);
        }
        if (detailed && surface.level !== bakedLevel && paints >= bakeCost) {
          paints -= bakeCost;
          firstWorkedBody ??= body;
          surface.tile ??= this.atlas.allocate(surface.width, surface.height, surface.original);
          if (surface.tile !== null) {
            this.atlas.write(
              surface.tile,
              this.painter.paint(surface, bakedLevel),
              surface.width,
              surface.height,
            );
            surface.level = bakedLevel;
          }
        }
        if (surface.tile !== null) sprite.texture = surface.tile.texture;
      }
      // Advance on service, not visits: otherwise layer and building rotations can lock in step.
      if (firstWorkedBody !== undefined)
        node.bodyOffset = (bodyStart + firstWorkedBody + 1) % subject.damageBodies.length;
      const ground = this.placeOrigins(node);
      node.effects.container.visible = ghost !== true;
      if (ghost !== true) node.effects.draw(node.origins, hpFrac, level, tick, wind, zoom, ground);
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
    const { width, height } = original.frame;
    if (width < 8 || height < 8 || width > 1000 || height > 1000) {
      this.unreadable.add(original);
      return null;
    }
    const drawable = drawableTexture(original);
    if (drawable === null) {
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
      ctx.drawImage(drawable.image, drawable.x, drawable.y, width, height, 0, 0, width, height);
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
        level: 0,
      };
    } catch {
      this.unreadable.add(original);
      return null;
    }
  }

  /** The smoke and fire art, shared with the other damage passes. */
  effectArt(): DamageEffectTextures {
    this.art ??= new DamageEffectTextures();
    return this.art;
  }

  private createEffects(ref: number, detailed: boolean, vehicle: boolean): DamageEffects {
    if (detailed) {
      const style: DamageEffectStyle = vehicle ? LAND_VEHICLE_DAMAGE_STYLE : BUILDING_DAMAGE_STYLE;
      return new DamageEffects(this.effectArt(), ref, style);
    }
    this.baselineArt ??= new DamageEffectTextures(false);
    return new DamageEffects(this.baselineArt, ref, PLAIN_DAMAGE_STYLE);
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
      const f = layer.frame;
      const drawable = drawableFrame(layer.source, f);
      if (drawable === null) continue;
      ctx.drawImage(
        drawable.image,
        drawable.x,
        drawable.y,
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
      this.plainOrigin(node, x, y, PLAIN_ORIGIN_SIZE);
      return NO_GROUND;
    }
    const { sprite, fractures } = largest;
    // A vehicle's frame has no roof to break through: one plume leaves the middle of its body.
    if (node.vehicle) {
      this.plainOrigin(
        node,
        sprite.x + largest.width * sprite.scale.x * 0.5,
        sprite.y + largest.height * sprite.scale.y * 0.35,
        VEHICLE_ORIGIN_SIZE,
      );
      return NO_GROUND;
    }
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

  private plainOrigin(node: DamageNode, x: number, y: number, size: number): void {
    const previous = node.origins[0];
    if (previous?.x !== x || previous.y !== y || previous.size !== size)
      node.origins[0] = { x, y, size, seed: 0, colour: PLAIN_ORIGIN_COLOUR };
    node.origins.length = 1;
  }

  /** Keep `surface` for the frame its vehicle left. The binder has already put the next frame on the
   *  sprite, so nothing is restored. */
  private park(node: DamageNode, surface: Surface): void {
    const stale = node.parked.get(surface.original);
    if (stale !== undefined) {
      this.discard(stale);
      node.parked.delete(surface.original);
      this.parkedTotal--;
    }
    node.parked.set(surface.original, surface);
    this.parkedTotal++;
    if (node.parked.size <= MAX_PARKED_SURFACES && this.parkedTotal <= MAX_PARKED_TOTAL) return;
    for (const [texture, oldest] of node.parked) {
      this.discard(oldest);
      node.parked.delete(texture);
      this.parkedTotal--;
      break;
    }
  }

  private clearParked(node: DamageNode): void {
    for (const surface of node.parked.values()) this.discard(surface);
    this.parkedTotal -= node.parked.size;
    node.parked.clear();
  }

  private discard(surface: Surface): void {
    this.release(surface);
    this.pixelBytes -= surface.bytes;
  }

  private release(surface: Surface): void {
    this.painter.forget(surface);
    if (surface.tile === null) return;
    if (!surface.sprite.destroyed && surface.sprite.texture === surface.tile.texture)
      surface.sprite.texture = surface.original;
    this.atlas.release(surface.tile);
    surface.tile = null;
  }

  private retire(node: DamageNode): void {
    for (const surface of node.surfaces.values()) this.discard(surface);
    this.clearParked(node);
    node.effects.destroy();
  }

  destroy(): void {
    for (const node of this.nodes.values()) this.retire(node);
    this.nodes.clear();
    this.atlas.destroy();
    this.art?.destroy();
    this.baselineArt?.destroy();
    this.scratch = null;
  }
}
