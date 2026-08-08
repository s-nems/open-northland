import { Container, Graphics } from 'pixi.js';
import type { Viewport } from '../../data/projection/index.js';
import { type MarkAnchorFrame, type MarkedEntity, markAnchor } from './entity-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The life-heart layer - a faction-coloured gauge over a unit whose life the player tracks. The app's
 * life-heart projection decides who wears one and carries that rule's source basis; this layer draws the
 * list. Retained per on-screen unit and re-minted on return, like the settler bubbles. The heart art is a
 * placeholder vector shape until the original's glyph is identified.
 */

/** One unit's heart: the owning faction's `0xRRGGBB` colour and remaining life as a `[0, 1]` fraction. */
export interface LifeHeart extends MarkedEntity {
  readonly colour: number;
  readonly life: number;
}

export interface LifeHeartFrame extends MarkAnchorFrame {
  readonly hearts: readonly LifeHeart[];
}

/** World-px the heart floats above the unit's back (the sprite-bounds top, or the feet estimate). */
const HEART_GAP = 4;
/** Feet→back estimate (world px) when the pool has no sprite bounds for the unit. */
const BACK_ABOVE_FEET = 26;
/** Half-width of a heart lobe (world px); the shape, its rim, and its gauge all scale off it. */
const LOBE_RADIUS = 3.5;
/** Lobe centres, in lobe radii: this far to each side of the axis, this far above the tip. */
const LOBE_SPREAD = 0.9;
const LOBE_RAISE = 2.2;
/** Where a lobe hands the outline over to the straight run down to the tip, in lobe radii. */
const SHOULDER_X = 1.82;
const SHOULDER_Y = -1.8;
/** The same handover as an angle on the left lobe's circle (+y points down). */
const SHOULDER_ANGLE = Math.atan2(SHOULDER_Y + LOBE_RAISE, LOBE_SPREAD - SHOULDER_X);
/** The top cleft, where the two lobe circles cross, as an angle on the left lobe's circle. */
const CLEFT_ANGLE = -Math.acos(LOBE_SPREAD);
/** The shape's full height (world px): tip at 0 up to the lobes' top. */
const HEART_HEIGHT = LOBE_RADIUS * (LOBE_RAISE + 1);
/** Half the fill's clip-rect width (world px) - wider than the shape's half-width. */
const MASK_HALF_WIDTH = LOBE_RADIUS * 2;
/** A constant-width stroke on the silhouette, over both fills so the outline reads the same at every life
 *  level; a rimless heart blends into the terrain (observation). */
const RIM_COLOUR = 0x000000;
const RIM_WIDTH = LOBE_RADIUS / 3;
/** The drained top: the faction colour scaled toward black, then lifted so no faction's empty half can
 *  sink into the rim colour. */
const DRAINED_SHADE = 0.42;
const DRAINED_LIFT = 0x16;

interface HeartNode {
  readonly node: Container;
  readonly colour: number;
  readonly fill: Graphics;
  /** A unit rect `setFillLevel` scales into the fill's clip. */
  readonly fillMask: Graphics;
}

export class LifeHeartLayer {
  readonly container = new Container();
  /** One heart per on-screen unit id; rebuilt only on a colour change. */
  private readonly hearts = new Map<number, HeartNode>();
  /** Reused scratch of ids drawn this frame, to avoid a per-frame allocation. */
  private readonly seen = new Set<number>();

  /** Reconcile to `frame.hearts`: build/move one heart per visible unit, retire the rest. */
  draw(frame: LifeHeartFrame, viewport?: Viewport): void {
    this.seen.clear();
    for (const heart of frame.hearts) {
      const top = markAnchor(frame, heart, BACK_ABOVE_FEET, viewport);
      if (top === undefined) continue;

      let entry = this.hearts.get(heart.id);
      if (entry === undefined || entry.colour !== heart.colour) {
        entry?.node.destroy({ children: true });
        entry = makeHeart(heart.colour);
        this.container.addChild(entry.node);
        this.hearts.set(heart.id, entry);
      }
      setFillLevel(entry, heart.life);
      entry.node.position.set(top.x, top.y - HEART_GAP);
      this.seen.add(heart.id);
    }
    retireUndrawn(this.hearts, this.seen, (entry) => entry.node.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.hearts.clear();
  }
}

/** Clip the coloured fill to the bottom `life` of the heart - a transform update, no geometry rebuild. */
function setFillLevel(entry: HeartNode, life: number): void {
  const level = Math.max(0, Math.min(1, life));
  entry.fill.visible = level > 0;
  entry.fillMask.position.set(-MASK_HALF_WIDTH, -HEART_HEIGHT * level);
  entry.fillMask.scale.set(MASK_HALF_WIDTH * 2, HEART_HEIGHT * level);
}

/** One heart node, tip anchored at the container origin. The rim is added last, so it covers the drained
 *  top as much as the filled bottom. */
function makeHeart(colour: number): HeartNode {
  const node = new Container();
  const drained = heartPath().fill(drainedShadeOf(colour));
  const fill = heartPath().fill(colour);
  const fillMask = new Graphics().rect(0, 0, 1, 1).fill(0xffffff);
  fill.mask = fillMask;
  const rim = heartPath().stroke({ color: RIM_COLOUR, width: RIM_WIDTH });
  node.addChild(drained, fill, fillMask, rim);
  return { node, colour, fill, fillMask };
}

function drainedShadeOf(colour: number): number {
  const drain = (c: number): number => Math.min(0xff, Math.round(c * DRAINED_SHADE) + DRAINED_LIFT);
  const r = drain((colour >> 16) & 0xff);
  const g = drain((colour >> 8) & 0xff);
  const b = drain(colour & 0xff);
  return (r << 16) | (g << 8) | b;
}

/** The placeholder heart as one closed path, tip at (0, 0), rather than a union of two circles and a
 *  triangle, so a stroke traces the silhouette alone and never the seams inside it. */
function heartPath(): Graphics {
  const r = LOBE_RADIUS;
  const lobeY = -LOBE_RAISE * r;
  const turn = Math.PI * 2; // sweep each lobe forward, never the short way back through the shape
  return new Graphics()
    .moveTo(0, 0)
    .lineTo(-SHOULDER_X * r, SHOULDER_Y * r)
    .arc(-LOBE_SPREAD * r, lobeY, r, SHOULDER_ANGLE, CLEFT_ANGLE + turn)
    .arc(LOBE_SPREAD * r, lobeY, r, Math.PI - CLEFT_ANGLE, Math.PI - SHOULDER_ANGLE + turn)
    .closePath();
}
