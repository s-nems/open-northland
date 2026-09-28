import { BufferImageSource, Container, Sprite, Texture } from 'pixi.js';
import {
  CRESTS_PER_ARM,
  crestMark,
  facingHeading,
  fitHull,
  type Hull,
  LAP_MARKS,
  lapMark,
  stepSailBlend,
  WASH_PUFFS,
  WATER_PLANE_SQUASH,
  type WakeMark,
  washMark,
} from '../../data/effects/index.js';
import { NO_WATER, type WaterField, waterSurfaceAt } from '../../data/terrain/index.js';
import type { DrawnGeometry, ShipAfloat } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/** The white water, and the shaded water on a crest's inner flank. */
const FOAM_RGB = [246, 252, 255] as const;
const TROUGH_RGB = [6, 26, 38] as const;
const FOAM_PEAK_ALPHA = 0.9;
/** The trough stays a shade, which gives the pushed-up ridge its depth without darkening the sea. */
const TROUGH_PEAK_ALPHA = 0.35;
/** How far inboard of a crest its trough lies, in ridge half-widths. */
const TROUGH_OFFSET = 1.3;
/** Texels per unit of a mark's radius: marks scale up to ~40 px, and the soft falloff hides the
 *  magnification. */
const TEXELS_PER_UNIT = 16;

/** A soft ellipse's opacity at squared unit radius `r2`: full at the centre, easing to clear at the rim. */
function softAlpha(r2: number, peak: number): number {
  return r2 >= 1 ? 0 : peak * (1 - r2) * (1 - r2);
}

/** A mark's baked texture and the anchor that centres its ridge. */
interface BakedMark {
  readonly texture: Texture;
  readonly anchorY: number;
}

/**
 * Unit soft ellipses baked into a premultiplied RGBA buffer, so a mark is one quad: tessellated soft
 * ellipses cost tens of thousands of vertices per ship.
 */
function bakeMark(withTrough: boolean): BakedMark {
  const above = withTrough ? 1 + TROUGH_OFFSET : 1;
  const width = 2 * TEXELS_PER_UNIT;
  const height = Math.ceil((above + 1) * TEXELS_PER_UNIT);
  const data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const u = (px + 0.5) / TEXELS_PER_UNIT - 1;
      const v = (py + 0.5) / TEXELS_PER_UNIT - above;
      const ridge = softAlpha(u * u + v * v, FOAM_PEAK_ALPHA);
      const tv = v + TROUGH_OFFSET;
      const trough = withTrough ? softAlpha(u * u + tv * tv, TROUGH_PEAK_ALPHA) * (1 - ridge) : 0;
      const i = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.round((FOAM_RGB[c] ?? 0) * ridge + (TROUGH_RGB[c] ?? 0) * trough);
      }
      data[i + 3] = Math.round(255 * (ridge + trough));
    }
  }
  const source = new BufferImageSource({
    resource: data,
    width,
    height,
    alphaMode: 'premultiplied-alpha',
    scaleMode: 'linear',
  });
  return { texture: new Texture({ source }), anchorY: above / (above + 1) };
}

let foamTexture: BakedMark | undefined;
let crestTexture: BakedMark | undefined;

interface WakeNode {
  /** At the anchor, squashed onto the water plane. */
  readonly root: Container;
  /** Turned to the heading inside {@link root}, so its children lay out in the hull's ground frame. */
  readonly frame: Container;
  readonly laps: readonly Sprite[];
  readonly starboard: readonly Sprite[];
  readonly port: readonly Sprite[];
  readonly wash: readonly Sprite[];
  /** 1 under way, 0 at rest, eased between so the wake rises and settles. */
  sail: number;
  lastTime: number;
}

const hull: Hull = { bow: 0, stern: 0, beam: 0, centreline: 0 };
const mark: WakeMark = { x: 0, y: 0, rx: 0, ry: 0, rotation: 0, alpha: 0 };
/** The ship being placed, for fading its marks off the water: its anchor and heading. */
const shore = { field: NO_WATER, x: 0, y: 0, cos: 1, sin: 0 };

/**
 * The water pushed aside by the drawn ships: foam lapping at the waterline, a bow wave peeling off into
 * a V, and wash behind the stern (`data/effects/wake.ts`). Painted on the water under the fog and every
 * sprite, so fog hides a wake like the sea under it and a hull covers the foam behind it; marks fade off
 * the map's water mask, so a wake never foams up a beach. Driven per frame from the pool's culled ship
 * list, so the cost tracks the screen; a ship not drawn retires its node.
 */
export class ShipWakeLayer {
  readonly container = new Container();
  private readonly nodes = new Map<number, WakeNode>();
  private readonly seen = new Set<number>();

  /** `time` is interpolated render time in ticks; `water` is the map's water mask. */
  draw(ships: readonly ShipAfloat[], drawn: DrawnGeometry, water: WaterField, time: number): void {
    shore.field = water;
    this.seen.clear();
    for (const ship of ships) {
      const anchor = drawn.anchorOf(ship.ref);
      if (anchor === undefined) continue;
      let node = this.nodes.get(ship.ref);
      if (node === undefined) {
        node = makeWakeNode(ship.sailing, time);
        this.container.addChild(node.root);
        this.nodes.set(ship.ref, node);
      }
      node.sail = stepSailBlend(node.sail, ship.sailing, time - node.lastTime);
      node.lastTime = time;
      const heading = facingHeading(ship.facing);
      fitHull(drawn.keelOf?.(ship.ref), heading, hull);
      node.root.position.set(anchor.x, anchor.y);
      node.frame.rotation = heading;
      shore.x = anchor.x;
      shore.y = anchor.y;
      shore.cos = Math.cos(heading);
      shore.sin = Math.sin(heading);
      placeWake(node, ship.ref, time);
      this.seen.add(ship.ref);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.root.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.nodes.clear();
    shore.field = NO_WATER;
  }
}

function makeWakeNode(sailing: boolean, time: number): WakeNode {
  const root = new Container();
  root.scale.set(1, WATER_PLANE_SQUASH);
  const frame = new Container();
  root.addChild(frame);
  foamTexture ??= bakeMark(false);
  crestTexture ??= bakeMark(true);
  const marks = (count: number, baked: BakedMark): Sprite[] =>
    Array.from({ length: count }, () => {
      const sprite = new Sprite(baked.texture);
      sprite.anchor.set(0.5, baked.anchorY);
      return frame.addChild(sprite);
    });
  // Paint order: the V and the wash under the lapping foam that hugs the hull.
  const starboard = marks(CRESTS_PER_ARM, crestTexture);
  const port = marks(CRESTS_PER_ARM, crestTexture);
  const wash = marks(WASH_PUFFS, foamTexture);
  const laps = marks(LAP_MARKS, foamTexture);
  return { root, frame, laps, starboard, port, wash, sail: sailing ? 1 : 0, lastTime: time };
}

function placeWake(node: WakeNode, seed: number, time: number): void {
  const sail = node.sail;
  for (let i = 0; i < node.laps.length; i++) place(node.laps[i], lapMark(i, time, hull, sail, mark));
  for (let i = 0; i < node.starboard.length; i++) {
    place(node.starboard[i], crestMark(i, 1, time, hull, sail, seed, mark));
    place(node.port[i], crestMark(i, -1, time, hull, sail, seed, mark));
  }
  for (let i = 0; i < node.wash.length; i++) place(node.wash[i], washMark(i, time, hull, sail, seed, mark));
}

/** A mark's opacity scaled by how much water lies under it; a map without a water mask clips nothing. */
function onWater(pose: WakeMark): number {
  if (shore.field === NO_WATER) return pose.alpha;
  const wx = shore.x + pose.x * shore.cos - pose.y * shore.sin;
  const wy = shore.y + (pose.x * shore.sin + pose.y * shore.cos) * WATER_PLANE_SQUASH;
  return pose.alpha * waterSurfaceAt(shore.field, wx, wy);
}

function place(sprite: Sprite | undefined, pose: WakeMark): void {
  if (sprite === undefined) return;
  const alpha = pose.alpha > 0 ? onWater(pose) : 0;
  sprite.visible = alpha > 0;
  if (!sprite.visible) return;
  sprite.position.set(pose.x, pose.y);
  sprite.scale.set(pose.rx / TEXELS_PER_UNIT, pose.ry / TEXELS_PER_UNIT);
  sprite.rotation = pose.rotation;
  sprite.alpha = alpha;
}
