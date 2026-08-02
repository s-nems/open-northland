import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { feetAnchor } from './feet-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The life-heart layer - the faction-coloured heart the original floats over a unit whose life the player
 * tracks. The app's life-heart projection decides who wears one and carries that rule's source basis; this
 * layer only draws the list. The heart is a gauge over ONE silhouette (plus a thin black rim
 * for contrast): the bottom `life` fraction wears the faction colour, the drained rest above the horizontal
 * boundary a darkened shade of the same colour - a full pool is simply one solid faction heart. Retained
 * exactly like the settler bubbles: culled to the viewport, rebuilt only when its colour changes (a
 * re-capture). The heart art is a placeholder vector shape (two lobes + a point) until the original's glyph
 * is identified.
 */

/** One unit's heart: its entity id (the retained key), snapshot `Position` (fixed-point units), the
 *  owning faction's resolved `0xRRGGBB` colour, and its remaining life as a `[0, 1]` fraction. */
export interface LifeHeart {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly colour: number;
  readonly life: number;
}

/** The frame's projection seams - the bubble layer's shape (see {@link SettlerBubbleFrame}). */
export interface LifeHeartFrame {
  readonly hearts: readonly LifeHeart[];
  readonly drawn?: DrawnGeometry | undefined;
  readonly elevation?: ElevationField | undefined;
}

/** World-px the heart floats above the unit's back (the sprite-bounds top, or the feet estimate).
 *  Unstacked: the bubble layer anchors on the same point and reaches higher, so a settler that is both
 *  hearted and bubbling draws the heart across the balloon's lower edge. Neither layer owns the head. */
const HEART_GAP = 4;
/** Feet→back estimate (world px) when the pool has no sprite bounds for the unit. */
const BACK_ABOVE_FEET = 26;
/** Half-width of a heart lobe (world px) - the shape, its rim, and its gauge all scale off this one knob. */
const LOBE_RADIUS = 3.5;
/** Lobe centres, in lobe radii: this far to each side of the axis, this far above the tip. The shape
 *  tops out one radius higher again. */
const LOBE_SPREAD = 0.9;
const LOBE_RAISE = 2.2;
/** Where a lobe hands the outline over to the straight run down to the tip, in lobe radii from it. */
const SHOULDER_X = 1.82;
const SHOULDER_Y = -1.8;
/** The same handover as an angle on the left lobe's circle (screen angles: +y points down). */
const SHOULDER_ANGLE = Math.atan2(SHOULDER_Y + LOBE_RAISE, LOBE_SPREAD - SHOULDER_X);
/** The top cleft, where the two lobe circles cross, as an angle on the left lobe's circle. */
const CLEFT_ANGLE = -Math.acos(LOBE_SPREAD);
/** The shape's full height (world px): tip at 0 up to the lobes' top. */
const HEART_HEIGHT = LOBE_RADIUS * (LOBE_RAISE + 1);
/** Half the fill's clip-rect width (world px) - wider than the shape's half-width. */
const MASK_HALF_WIDTH = LOBE_RADIUS * 2;
/** The rim: ONE constant-width stroke on the silhouette path, drawn over both fills, so it reads the same
 *  all round and at every life level (user feedback: the rimless heart blended into the terrain). */
const RIM_COLOUR = 0x000000;
const RIM_WIDTH = LOBE_RADIUS / 3;
/** The drained top: the faction colour scaled toward black, then lifted back off it so no faction's empty
 *  half can sink into {@link RIM_COLOUR} - the one shade the rim must never blend with. */
const DRAINED_SHADE = 0.42;
const DRAINED_LIFT = 0x16;

interface HeartNode {
  readonly node: Container;
  readonly colour: number;
  readonly fill: Graphics;
  /** The fill's clip rect (a unit rect; see {@link setFillLevel}). */
  readonly fillMask: Graphics;
}

export class LifeHeartLayer {
  readonly container = new Container();
  /** One heart per on-screen unit id; rebuilt only on a colour change (re-capture). */
  private readonly hearts = new Map<number, HeartNode>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<number>();

  /** Reconcile to `frame.hearts`: build/move one heart per visible unit, retire the rest. */
  draw(frame: LifeHeartFrame, viewport?: Viewport): void {
    this.seen.clear();
    for (const heart of frame.hearts) {
      const feet = tileToScreen(heart.x / ONE, heart.y / ONE);
      if (viewport !== undefined && !isVisible(viewport, feet.x, feet.y)) continue;

      const top = this.backOf(frame, heart);
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

  /** The point the heart floats over: the pool's lerped sprite-bounds top+centre when the unit was
   *  drawn this frame, else its {@link feetAnchor} raised by the back estimate. */
  private backOf(frame: LifeHeartFrame, heart: LifeHeart): { x: number; y: number } {
    const bounds = frame.drawn?.boundsOf(heart.id);
    if (bounds !== undefined) return { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY };
    const feet = feetAnchor(frame.drawn, heart.id, heart, frame.elevation);
    return { x: feet.x, y: feet.y - BACK_ABOVE_FEET };
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

/** One heart node, tip anchored at the container origin so the shape reads above the unit. The rim goes
 *  on last: over the drained top as much as over the filled bottom, so the border never thins where the
 *  gauge is empty. */
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

/** The faction colour scaled by {@link DRAINED_SHADE}, then lifted by {@link DRAINED_LIFT}. */
function drainedShadeOf(colour: number): number {
  const drain = (c: number): number => Math.min(0xff, Math.round(c * DRAINED_SHADE) + DRAINED_LIFT);
  const r = drain((colour >> 16) & 0xff);
  const g = drain((colour >> 8) & 0xff);
  const b = drain(colour & 0xff);
  return (r << 16) | (g << 8) | b;
}

/**
 * The placeholder heart vector as ONE closed path, tip at (0, 0): up the left run to the shoulder, over
 * both lobes through the cleft, then back down to the tip. One path rather than a union of two circles
 * and a triangle, so a stroke traces the silhouette alone and never the seams inside it.
 */
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
