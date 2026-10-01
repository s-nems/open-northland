import { Container, Graphics } from 'pixi.js';
import { isVisible, TILE_HALF_H, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The order markers - the acknowledgement of a walk or march order: four darts slide into the named spot
 * and a ring lands there. A presentation addition, not taken from the original. The app owns the clock
 * and hands each marker's progress in.
 */

/** A walk is green like the selection ring; an attack-move is red. */
export type OrderMarkerKind = 'move' | 'attack';

export interface OrderMarker {
  /** Stable for the marker's life, the retained-pool key. */
  readonly id: number;
  readonly kind: OrderMarkerKind;
  /** The half-cell node the order names. */
  readonly hx: number;
  readonly hy: number;
  /** 0 when placed, 1 when it has played out. */
  readonly progress: number;
}

/** One frame of a marker's animation. */
export interface OrderMarkerPose {
  /** Each dart tip's distance from the spot on the ground plane, in world px; the ellipse squashes its
   *  north-south part. */
  readonly reach: number;
  readonly dartScale: number;
  readonly dartAlpha: number;
  readonly ringScale: number;
  readonly ringAlpha: number;
}

/** Ground-ellipse squash, the selection ring's: a ground circle spans a cell width east-west but only a
 *  row step north-south. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);

/** The darts slide from about a cell out to just short of the spot, along the ground ellipse. */
const REACH_START = 44;
const REACH_END = 11;
/** The share of the marker's life the slide takes; the darts then hold and fade. */
const CONVERGE_SHARE = 0.55;
/** The share the darts take to fade in, so a marker never pops in at full strength. */
const FADE_IN_SHARE = 0.1;
/** The marker never draws fully opaque: it acknowledges the order without covering the ground. */
const PEAK_ALPHA = 0.75;
const DART_SCALE_START = 1.1;
const DART_SCALE_END = 0.75;
/** The landing ring starts as the darts close and grows out from the spot. */
const RING_START_SHARE = 0.4;
const RING_SCALE_START = 0.25;
const RING_RADIUS = 13;
const RING_WIDTH = 1.5;

/** A dart arrowhead with its tip at the origin, pointing along -x: length, half-span, notch depth. It
 *  stands upright on screen; only its path follows the ground, so it reads at every zoom. */
const DART_LENGTH = 12;
const DART_HALF_SPAN = 5;
const DART_NOTCH = 9;
const OUTLINE_WIDTH = 1;
/** A faint drop shadow keeps the darts legible on ground of their own colour. */
const SHADOW_OFFSET = 1;
const SHADOW_COLOUR = 0x000000;
const SHADOW_ALPHA = 0.25;
/** The darts come in along the ground diagonals, parallel to the cell diamond's edges, closing in as
 *  an X; a narrow dart keeps its direction readable there. */
const APPROACHES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4].map((angle) => {
  const x = Math.cos(angle);
  const y = Math.sin(angle) * ISO_RATIO;
  return { x, y, rotation: Math.atan2(y, x) };
});

const COLOURS: Readonly<Record<OrderMarkerKind, { readonly fill: number; readonly outline: number }>> = {
  move: { fill: 0xa8e890, outline: 0x1c3a14 },
  attack: { fill: 0xe8604a, outline: 0x3a0e08 },
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

export function orderMarkerPose(progress: number): OrderMarkerPose {
  const p = clamp01(progress);
  const slide = easeOutCubic(clamp01(p / CONVERGE_SHARE));
  const fadeOut = clamp01((p - CONVERGE_SHARE) / (1 - CONVERGE_SHARE));
  const ring = clamp01((p - RING_START_SHARE) / (1 - RING_START_SHARE));
  return {
    reach: lerp(REACH_START, REACH_END, slide),
    dartScale: lerp(DART_SCALE_START, DART_SCALE_END, slide),
    dartAlpha: PEAK_ALPHA * Math.min(clamp01(p / FADE_IN_SHARE), 1 - fadeOut),
    ringScale: lerp(RING_SCALE_START, 1, easeOutCubic(ring)),
    ringAlpha: ring === 0 ? 0 : PEAK_ALPHA * (1 - ring),
  };
}

interface MarkerNode {
  readonly root: Container;
  readonly darts: readonly Graphics[];
  readonly ring: Graphics;
}

const DART = [0, 0, DART_LENGTH, -DART_HALF_SPAN, DART_NOTCH, 0, DART_LENGTH, DART_HALF_SPAN];

function makeDart(kind: OrderMarkerKind, rotation: number): Graphics {
  const { fill, outline } = COLOURS[kind];
  // The shadow falls straight down the screen whichever way the dart points.
  const dx = SHADOW_OFFSET * Math.sin(rotation);
  const dy = SHADOW_OFFSET * Math.cos(rotation);
  const shadow = DART.map((v, i) => v + (i % 2 === 0 ? dx : dy));
  const dart = new Graphics()
    .poly(shadow)
    .fill({ color: SHADOW_COLOUR, alpha: SHADOW_ALPHA })
    .poly(DART)
    .fill({ color: fill })
    .stroke({ width: OUTLINE_WIDTH, color: outline, join: 'round' });
  dart.rotation = rotation;
  return dart;
}

function makeMarker(kind: OrderMarkerKind): MarkerNode {
  const { fill, outline } = COLOURS[kind];
  const root = new Container();
  // The ring lies flat on the ground plane and squashes with it.
  const ring = new Graphics()
    .circle(0, 0, RING_RADIUS)
    .stroke({ width: RING_WIDTH + 2 * OUTLINE_WIDTH, color: outline })
    .circle(0, 0, RING_RADIUS)
    .stroke({ width: RING_WIDTH, color: fill });
  const ground = new Container();
  ground.scale.y = ISO_RATIO;
  ground.addChild(ring);
  const darts = APPROACHES.map((approach) => makeDart(kind, approach.rotation));
  root.addChild(ground, ...darts);
  return { root, darts, ring };
}

export class OrderMarkerLayer {
  readonly container = new Container();
  private readonly markers = new Map<number, MarkerNode>();
  private readonly seen = new Set<number>();

  draw(markers: readonly OrderMarker[], elevation: ElevationField, viewport: Viewport): void {
    this.seen.clear();
    for (const marker of markers) {
      const at = projectNode(elevation, marker.hx, marker.hy);
      if (!isVisible(viewport, at.x, at.y)) continue;
      let node = this.markers.get(marker.id);
      // A marker keeps its kind for life: a new order is a new id.
      if (node === undefined) {
        node = makeMarker(marker.kind);
        this.container.addChild(node.root);
        this.markers.set(marker.id, node);
      }
      node.root.position.set(at.x, at.y);
      pose(node, orderMarkerPose(marker.progress));
      this.seen.add(marker.id);
    }
    retireUndrawn(this.markers, this.seen, (node) => node.root.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.markers.clear();
  }
}

function pose(node: MarkerNode, p: OrderMarkerPose): void {
  APPROACHES.forEach((approach, i) => {
    const dart = node.darts[i];
    if (dart === undefined) return;
    dart.position.set(p.reach * approach.x, p.reach * approach.y);
    dart.scale.set(p.dartScale);
    dart.alpha = p.dartAlpha;
  });
  node.ring.scale.set(p.ringScale);
  node.ring.alpha = p.ringAlpha;
}
