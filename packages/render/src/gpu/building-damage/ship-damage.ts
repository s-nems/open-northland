import type { Container, TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { WindSway } from '../../data/weather/climate.js';
import { type PalettedQuad, PalettedSprite } from '../paletted-sprite/index.js';
import { isIndexedSource } from '../pixel-art/registry.js';
import type { DamagedShip } from '../sprite-pool/picking/pick.js';
import { RecolouredPageSource, readFrameRgba } from '../textures/recoloured-pages.js';
import type { DamageEffectTextures } from './effect-textures.js';
import { DamageEffects, type DamageOrigin, PLAIN_DAMAGE_STYLE, SHIP_DAMAGE_STYLE } from './effects.js';
import { damageLevel, MAX_DAMAGE_LEVEL } from './surface.js';

/** A drawn ship: its pooled container at the feet anchor and its layers, the hull meshes among them. */
export interface ShipBody {
  readonly container: Container;
  readonly sprites: readonly (PalettedQuad | PalettedSprite)[];
}

/** A hull's drawn rect in feet-local world px, its roll, and where its fires stand on it. */
export interface HullBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Px of x per px of y about the feet anchor. */
  shear: number;
  /** `[x, y]` per fire, as shares of the rect. */
  fires: ArrayLike<number>;
}

export function emptyHullBox(): HullBox {
  return { left: 0, top: 0, width: 0, height: 0, shear: 0, fires: DEFAULT_FIRES };
}

type MutableOrigin = { -readonly [K in keyof DamageOrigin]: DamageOrigin[K] };

/** The columns the two fires stand in, as shares of the frame's width. Tuned by eye. */
const FIRE_COLUMNS = [0.38, 0.62] as const;
/** Where they stand when the frame's pixels cannot be read: the upper part of a ship's frame is mast
 *  and sail. */
const DEFAULT_FIRES: ArrayLike<number> = [FIRE_COLUMNS[0], 0.6, FIRE_COLUMNS[1], 0.6];
/** A fire stands this far up the hull's side from its lowest pixel, as a share of the side's height,
 *  and a side counts as no taller than this share of the frame: above it the column is mast or sail. */
const FIRE_RISE = 0.7;
const MAX_SIDE_SHARE = 0.3;
/** The shortest run of drawn pixels that counts as a hull's side: in px, and as a share of the frame. */
const MIN_SIDE_PX = 6;
const MIN_SIDE_SHARE = 0.06;
const RGBA = 4;
const GREEN_CHANNEL = 1;
const ALPHA_CHANNEL = 3;
const FIRE_SIZE = 24;
const HULL_WOOD = 0x8a6a45;
const NO_GROUND: readonly never[] = [];

/** The largest visible mesh's rect into `out`; false when the ship draws nothing. */
export function hullBoxOf(sprites: ShipBody['sprites'], out: HullBox): boolean {
  let area = 0;
  for (const mesh of sprites) {
    if (!(mesh instanceof PalettedSprite)) continue;
    const frame = mesh.frame;
    if (!mesh.visible || frame === undefined || frame.width * frame.height <= area) continue;
    area = frame.width * frame.height;
    out.left = mesh.artDx + frame.offsetX * mesh.artScale;
    out.top = mesh.artDy + frame.offsetY * mesh.artScale;
    out.width = frame.width * mesh.artScale;
    out.height = frame.height * mesh.artScale;
    out.shear = mesh.shear;
    out.fires = mesh.frameSource === undefined ? DEFAULT_FIRES : deckFires(mesh.frameSource, frame);
  }
  return area > 0;
}

const firesOfFrame = new WeakMap<AtlasFrame, ArrayLike<number>>();

/**
 * Where a hull frame's fires stand, read once from its pixels so a flame rises from the timber and not
 * from the air beside the mast. An unreadable frame takes {@link DEFAULT_FIRES}.
 */
function deckFires(source: TextureSource, frame: AtlasFrame): ArrayLike<number> {
  const known = firesOfFrame.get(frame);
  if (known !== undefined) return known;
  const pixels = readFrameRgba(source, frame);
  // A drawable indexed page holds its coverage in green; a coloured copy holds it in alpha.
  const channel =
    isIndexedSource(source) && !(source instanceof RecolouredPageSource) ? GREEN_CHANNEL : ALPHA_CHANNEL;
  const fires =
    pixels === null
      ? DEFAULT_FIRES
      : (deckFiresOf(pixels, frame.width, frame.height, channel) ?? DEFAULT_FIRES);
  firesOfFrame.set(frame, fires);
  return fires;
}

/**
 * The `[x, y]` of each fire as shares of a `width` x `height` RGBA frame whose coverage is `channel`:
 * in each fire column, part way up the hull's side. The side is the lowest run of drawn pixels tall
 * enough to be timber, since a keel tip or a rope end under it is not; null when a column draws nothing.
 */
export function deckFiresOf(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  channel: number,
): ArrayLike<number> | null {
  const solid = (x: number, y: number): boolean => (pixels[(y * width + x) * RGBA + channel] ?? 0) > 0;
  const minSide = Math.max(MIN_SIDE_PX, height * MIN_SIDE_SHARE);
  const fires = new Float32Array(FIRE_COLUMNS.length * 2);
  for (let i = 0; i < FIRE_COLUMNS.length; i++) {
    const x = Math.min(width - 1, Math.floor(width * (FIRE_COLUMNS[i] ?? 0.5)));
    let sideBottom = -1;
    let sideLength = 0;
    for (let y = height - 1; y >= 0; y--) {
      if (!solid(x, y)) continue;
      const bottom = y;
      while (y > 0 && solid(x, y - 1)) y--;
      const length = bottom - y + 1;
      // Keep the tallest run seen for a column with no run tall enough.
      if (length > sideLength) {
        sideBottom = bottom;
        sideLength = length;
      }
      if (length >= minSide) break;
    }
    if (sideBottom < 0) return null;
    const side = Math.min(sideLength - 1, height * MAX_SIDE_SHARE);
    fires[i * 2] = (x + 0.5) / width;
    fires[i * 2 + 1] = (sideBottom - side * FIRE_RISE) / height;
  }
  return fires;
}

/** The deck fires of a hull at `box`, moved `sink` px down and never below its waterline. */
export function placeDeckFires(origins: DamageOrigin[], box: HullBox, sink = 0): void {
  const waterline = box.top + box.height;
  const count = box.fires.length / 2;
  for (let i = 0; i < count; i++) {
    let origin = origins[i] as MutableOrigin | undefined;
    if (origin === undefined) {
      origin = { x: 0, y: 0, size: FIRE_SIZE, seed: i + 1, colour: HULL_WOOD };
      origins[i] = origin;
    }
    const y = box.top + box.height * (box.fires[i * 2 + 1] ?? 0);
    // The roll shifts a row by its height over the feet.
    origin.x = box.left + box.width * (box.fires[i * 2] ?? 0) + box.shear * y;
    origin.y = Math.min(y + sink, waterline);
  }
  origins.length = count;
}

interface ShipNode {
  readonly body: ShipBody;
  effects: DamageEffects;
  detailed: boolean;
  readonly origins: DamageOrigin[];
}

/** A hurt ship's wear, smoke, fire and splinters. The hull wears in its mesh shader; the marks ride
 *  the ship's depth-sorted container like a building's. */
export class ShipDamage {
  private readonly nodes = new Map<number, ShipNode>();
  private readonly seen = new Set<number>();
  /** The hurt ships of this pass, remembered ones included, and the bodies it gave wear, so it can
   *  take the wear back. */
  private readonly listed = new Set<number>();
  private readonly worn = new Map<number, ShipBody>();
  private readonly box = emptyHullBox();

  constructor(
    private readonly art: () => DamageEffectTextures,
    private readonly seedOf: (ref: number) => number,
  ) {}

  draw(
    damaged: readonly DamagedShip[],
    bodyOf: (ref: number) => ShipBody | undefined,
    tick: number,
    wind: WindSway | undefined,
    detailed: boolean,
    zoom: number,
  ): void {
    this.seen.clear();
    this.listed.clear();
    for (const { ref, hpFrac, ghost } of damaged) {
      const body = bodyOf(ref);
      if (body === undefined) continue;
      const level = damageLevel(hpFrac);
      // Also on a ship holding still, whose meshes a settings flip does not bind again.
      setWear(body, detailed ? level / MAX_DAMAGE_LEVEL : 0, this.seedOf(ref));
      this.worn.set(ref, body);
      this.listed.add(ref);
      // A remembered ship keeps its scars and shows no live smoke or fire.
      if (ghost === true || !hullBoxOf(body.sprites, this.box)) continue;
      let node = this.nodes.get(ref);
      if (node !== undefined && (node.body !== body || node.detailed !== detailed)) {
        node.effects.destroy();
        this.nodes.delete(ref);
        node = undefined;
      }
      if (node === undefined) {
        const style = detailed ? SHIP_DAMAGE_STYLE : PLAIN_DAMAGE_STYLE;
        node = { body, effects: new DamageEffects(this.art(), ref, style), detailed, origins: [] };
        this.nodes.set(ref, node);
      }
      this.seen.add(ref);
      const marks = node.effects.container;
      if (body.container.children.at(-1) !== marks) body.container.addChild(marks);
      placeDeckFires(node.origins, this.box);
      node.effects.draw(node.origins, hpFrac, level, tick, wind, zoom, NO_GROUND);
    }
    for (const [ref, node] of this.nodes) {
      if (this.seen.has(ref)) continue;
      node.effects.destroy();
      this.nodes.delete(ref);
    }
    // A hull that left the list whole, by a scripted heal, may hold still and never bind again.
    for (const [ref, body] of this.worn) {
      if (this.listed.has(ref)) continue;
      if (!body.container.destroyed) setWear(body, 0, this.seedOf(ref));
      this.worn.delete(ref);
    }
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.effects.destroy();
    this.nodes.clear();
    this.worn.clear();
  }
}

function setWear(body: ShipBody, wear: number, seed: number): void {
  for (const mesh of body.sprites) if (mesh instanceof PalettedSprite) mesh.setDamage(wear, seed);
}
