import { Container, Graphics, GraphicsPath } from 'pixi.js';
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
  /** The life fraction {@link fill} was last cut to; NaN before the first. */
  level: number;
}

export class LifeHeartLayer {
  /** Its own render group: a life change redraws a fill, and a redrawn Graphics rebuilds the
   *  instructions of the group it sits in, which would otherwise be the whole world's. */
  readonly container = new Container({ isRenderGroup: true });
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

/**
 * Cut the coloured fill to the bottom `life` of the heart. The fill is the heart's own outline clipped
 * at the level line, so a gauge costs no stencil mask and no batch break; only a level change redraws it.
 */
function setFillLevel(entry: HeartNode, life: number): void {
  const level = Math.max(0, Math.min(1, life));
  entry.fill.visible = level > 0;
  if (level === entry.level || level === 0) return;
  entry.level = level;
  entry.fill
    .clear()
    .poly(heartBelow(-HEART_HEIGHT * level))
    .fill(entry.colour);
}

/** One heart node, tip anchored at the container origin. The rim is added last, so it covers the drained
 *  top as much as the filled bottom. */
function makeHeart(colour: number): HeartNode {
  const node = new Container();
  const drained = new Graphics().path(HEART_PATH).fill(drainedShadeOf(colour));
  const fill = new Graphics();
  const rim = new Graphics().path(HEART_PATH).stroke({ color: RIM_COLOUR, width: RIM_WIDTH });
  node.addChild(drained, fill, rim);
  return { node, colour, fill, level: Number.NaN };
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
function heartPath(): GraphicsPath {
  const r = LOBE_RADIUS;
  const lobeY = -LOBE_RAISE * r;
  const turn = Math.PI * 2; // sweep each lobe forward, never the short way back through the shape
  return new GraphicsPath()
    .moveTo(0, 0)
    .lineTo(-SHOULDER_X * r, SHOULDER_Y * r)
    .arc(-LOBE_SPREAD * r, lobeY, r, SHOULDER_ANGLE, CLEFT_ANGLE + turn)
    .arc(LOBE_SPREAD * r, lobeY, r, Math.PI - CLEFT_ANGLE, Math.PI - SHOULDER_ANGLE + turn)
    .closePath();
}

const HEART_PATH = heartPath();

/** The heart's outline as Pixi flattens the path for a fill, `[x, y, ...]`. */
function heartOutline(): readonly number[] {
  const [primitive] = HEART_PATH.shapePath.shapePrimitives;
  const shape = primitive?.shape;
  if (shape === undefined || !('points' in shape)) throw new Error('the heart path flattened to no outline');
  return shape.points;
}

const HEART_OUTLINE = heartOutline();

/** The part of the heart outline at or below `cutY` (y grows down), clipped against that line. */
export function heartBelow(cutY: number): number[] {
  const out: number[] = [];
  const count = HEART_OUTLINE.length / 2;
  for (let i = 0; i < count; i++) {
    const ax = HEART_OUTLINE[2 * i] ?? 0;
    const ay = HEART_OUTLINE[2 * i + 1] ?? 0;
    const j = (i + 1) % count;
    const bx = HEART_OUTLINE[2 * j] ?? 0;
    const by = HEART_OUTLINE[2 * j + 1] ?? 0;
    const aIn = ay >= cutY;
    if (aIn) out.push(ax, ay);
    if (aIn !== by >= cutY) {
      const t = (cutY - ay) / (by - ay);
      out.push(ax + t * (bx - ax), cutY);
    }
  }
  return out;
}
