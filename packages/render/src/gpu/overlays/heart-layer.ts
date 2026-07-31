import { Container, Graphics } from 'pixi.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { feetAnchor } from './feet-anchor.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The livestock-heart layer - the faction-coloured life heart the original floats over a CLAIMED
 * animal (a scout walked onto it; its `Owner` marks the herd as that player's stock). A client-side
 * projection of the read-only snapshot, anchored and retained exactly like the settler bubbles: the
 * heart rides the pool's lerped sprite bounds (falling back to the raw `Position` projection), is
 * culled to the viewport, and is rebuilt only when its colour changes (a re-capture), else just
 * repositioned. The heart art is a placeholder vector shape (two lobes + a point, dark backing for
 * contrast on any ground) until the original's glyph is identified - the placement, faction tint,
 * and appears-only-when-claimed behaviour are the mechanic.
 */

/** One claimed animal's heart: its entity id (the retained key), snapshot `Position` (fixed-point
 *  units), and the owning faction's resolved `0xRRGGBB` colour. */
export interface LivestockHeart {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly colour: number;
}

/** The frame's projection seams - the bubble layer's shape (see {@link SettlerBubbleFrame}). */
export interface LivestockHeartFrame {
  readonly hearts: readonly LivestockHeart[];
  readonly drawn?: DrawnGeometry | undefined;
  readonly elevation?: ElevationField | undefined;
}

/** World-px the heart floats above the animal's back (the sprite-bounds top, or the feet estimate). */
const HEART_GAP = 4;
/** Feet→back estimate (world px) when the pool has no sprite bounds for the animal. */
const BACK_ABOVE_FEET = 26;
/** Half-width of a heart lobe (world px) - the shape scales off this one knob. */
const LOBE_RADIUS = 3;
/** The dark backing under the coloured fill, so the heart reads on bright and dark ground alike. */
const BACKING_COLOUR = 0x221a14;
const BACKING_SCALE = 1.35;

interface HeartNode {
  readonly node: Container;
  readonly colour: number;
}

export class LivestockHeartLayer {
  readonly container = new Container();
  /** One heart per on-screen claimed animal id; rebuilt only on a colour change (re-capture). */
  private readonly hearts = new Map<number, HeartNode>();
  /** Reused per-frame scratch of ids drawn this frame (avoids a per-frame allocation). */
  private readonly seen = new Set<number>();

  /** Reconcile to `frame.hearts`: build/move one heart per visible claimed animal, retire the rest. */
  draw(frame: LivestockHeartFrame, viewport?: Viewport): void {
    this.seen.clear();
    for (const heart of frame.hearts) {
      const feet = tileToScreen(heart.x / ONE, heart.y / ONE);
      if (viewport !== undefined && !isVisible(viewport, feet.x, feet.y)) continue;

      const top = this.backOf(frame, heart);
      let entry = this.hearts.get(heart.id);
      if (entry === undefined || entry.colour !== heart.colour) {
        entry?.node.destroy({ children: true });
        const node = makeHeart(heart.colour);
        this.container.addChild(node);
        entry = { node, colour: heart.colour };
        this.hearts.set(heart.id, entry);
      }
      entry.node.position.set(top.x, top.y - HEART_GAP);
      this.seen.add(heart.id);
    }
    retireUndrawn(this.hearts, this.seen, (entry) => entry.node.destroy({ children: true }));
  }

  /** The point the heart floats over: the pool's lerped sprite-bounds top+centre when the animal was
   *  drawn this frame, else its {@link feetAnchor} raised by the back estimate. */
  private backOf(frame: LivestockHeartFrame, heart: LivestockHeart): { x: number; y: number } {
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

/** One heart node, tip anchored at the container origin so the shape reads above the animal. */
function makeHeart(colour: number): Container {
  const c = new Container();
  const backing = heartShape(BACKING_COLOUR);
  backing.scale.set(BACKING_SCALE);
  c.addChild(backing);
  c.addChild(heartShape(colour));
  return c;
}

/** The placeholder heart vector: two lobes and a point, drawn tip-down with the tip at (0, 0). */
function heartShape(colour: number): Graphics {
  const r = LOBE_RADIUS;
  return new Graphics()
    .circle(-r * 0.9, -r * 2.2, r)
    .circle(r * 0.9, -r * 2.2, r)
    .poly([-r * 1.82, -r * 1.8, 0, 0, r * 1.82, -r * 1.8])
    .fill(colour);
}
