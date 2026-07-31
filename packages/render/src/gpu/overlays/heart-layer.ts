import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { feetAnchor } from './feet-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The life-heart layer - the faction-coloured heart the original floats over a unit whose life the
 * player tracks (today the claimed livestock; settlers are the planned next feeder). The heart is a
 * gauge over ONE silhouette: the bottom `life` fraction wears the faction colour, the drained rest
 * above the horizontal boundary a darkened shade of the same colour - a full pool is simply one
 * solid faction heart. A client-side projection of the read-only snapshot, anchored and retained
 * exactly like the settler bubbles: the heart rides the pool's lerped sprite bounds (falling back
 * to the raw `Position` projection), is culled to the viewport, and is rebuilt only when its colour
 * changes (a re-capture). The heart art is a placeholder vector shape (two lobes + a point) until
 * the original's glyph is identified.
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

/** World-px the heart floats above the unit's back (the sprite-bounds top, or the feet estimate). */
const HEART_GAP = 4;
/** Feet→back estimate (world px) when the pool has no sprite bounds for the unit. */
const BACK_ABOVE_FEET = 26;
/** Half-width of a heart lobe (world px) - the shape scales off this one knob. */
const LOBE_RADIUS = 3;
/** Channel multiplier of the drained top's shade - the faction colour, darkened to read as missing. */
const DRAINED_SHADE = 0.35;
/** Lobe centres sit this many radii above the tip; the shape tops out one radius higher. */
const LOBE_RAISE = 2.2;
/** The shape's full height (world px): tip at 0 up to the lobes' top. */
const HEART_HEIGHT = LOBE_RADIUS * (LOBE_RAISE + 1);
/** Half the fill's clip-rect width (world px) - wider than the shape's half-width. */
const MASK_HALF_WIDTH = LOBE_RADIUS * 2;

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

/** One heart node, tip anchored at the container origin so the shape reads above the unit. */
function makeHeart(colour: number): HeartNode {
  const node = new Container();
  const drained = heartShape(drainedShadeOf(colour));
  const fill = heartShape(colour);
  const fillMask = new Graphics().rect(0, 0, 1, 1).fill(0xffffff);
  fill.mask = fillMask;
  node.addChild(drained, fill, fillMask);
  return { node, colour, fill, fillMask };
}

/** The faction colour with each RGB channel scaled by {@link DRAINED_SHADE}. */
function drainedShadeOf(colour: number): number {
  const r = Math.round(((colour >> 16) & 0xff) * DRAINED_SHADE);
  const g = Math.round(((colour >> 8) & 0xff) * DRAINED_SHADE);
  const b = Math.round((colour & 0xff) * DRAINED_SHADE);
  return (r << 16) | (g << 8) | b;
}

/** The placeholder heart vector: two lobes and a point, drawn tip-down with the tip at (0, 0). */
function heartShape(colour: number): Graphics {
  const r = LOBE_RADIUS;
  return new Graphics()
    .circle(-r * 0.9, -r * LOBE_RAISE, r)
    .circle(r * 0.9, -r * LOBE_RAISE, r)
    .poly([-r * 1.82, -r * 1.8, 0, 0, r * 1.82, -r * 1.8])
    .fill(colour);
}
