import type { Container } from 'pixi.js';
import type { WindSway } from '../../data/weather/climate.js';
import { type PalettedQuad, PalettedSprite } from '../paletted-sprite/index.js';
import type { DamagedShip } from '../sprite-pool/picking/pick.js';
import type { DamageEffectTextures } from './effect-textures.js';
import { DamageEffects, type DamageOrigin, PLAIN_DAMAGE_STYLE, SHIP_DAMAGE_STYLE } from './effects.js';
import { damageLevel, MAX_DAMAGE_LEVEL } from './surface.js';

/** A drawn ship: its pooled container at the feet anchor and its layers, the hull meshes among them. */
export interface ShipBody {
  readonly container: Container;
  readonly sprites: readonly (PalettedQuad | PalettedSprite)[];
}

/** A hull's drawn rect in feet-local world px. */
export interface HullBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

type MutableOrigin = { -readonly [K in keyof DamageOrigin]: DamageOrigin[K] };

/** Where the two fires stand along the deck, as shares of the hull rect. Tuned by eye: the upper part
 *  of a ship's frame is mast and sail. */
const DECK_FIRES = [0.38, 0.62] as const;
const DECK_HEIGHT = 0.6;
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
  }
  return area > 0;
}

/** The deck fires of a hull at `box`, moved `sink` px down and never below its waterline. */
export function placeDeckFires(origins: DamageOrigin[], box: HullBox, sink = 0): void {
  const waterline = box.top + box.height;
  for (let i = 0; i < DECK_FIRES.length; i++) {
    let origin = origins[i] as MutableOrigin | undefined;
    if (origin === undefined) {
      origin = { x: 0, y: 0, size: FIRE_SIZE, seed: i + 1, colour: HULL_WOOD };
      origins[i] = origin;
    }
    origin.x = box.left + box.width * (DECK_FIRES[i] ?? 0.5);
    origin.y = Math.min(box.top + box.height * DECK_HEIGHT + sink, waterline);
  }
  origins.length = DECK_FIRES.length;
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
  private readonly box: HullBox = { left: 0, top: 0, width: 0, height: 0 };

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
