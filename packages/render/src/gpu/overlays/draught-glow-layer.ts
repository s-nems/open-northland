import type { SimEvent } from '@open-northland/sim';
import { Container, Graphics } from 'pixi.js';
import { frac } from '../../data/effects/index.js';
import { clamp01 } from '../../data/math.js';
import { isVisible, TILE_HALF_H, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import { SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * The moment a settler drinks a draught: a glow of the drink's colour flushes over the body and fades,
 * a ring runs out over the ground from the feet, and a few sparks rise off the drinker. The app names
 * which goods glow and in what colour; a sip of any other good shows nothing. A presentation addition:
 * the original drinks without any sign. Extents in world px at zoom 1 and times in sim ticks, authored.
 */

/** How long one sip shows. */
export const DRAUGHT_GLOW_TICKS = 14;

const GLOW_PEAK_TICKS = 1.5;
const GLOW_END_TICKS = 10;
const GLOW_ALPHA = 0.6;
/** The glow's half extents and how high over the feet its middle sits: a standing adult's body. Fixed,
 *  so a swing's reach does not move it. */
const GLOW_HALF_WIDTH = 13;
const GLOW_HALF_HEIGHT = 22;
const GLOW_ABOVE_FEET = 19;
/** The glow swells this much over its life. */
const GLOW_START_SCALE = 0.8;
const GLOW_END_SCALE = 1.15;
/** Concentric discs, each as faint as the next, add up to a soft falloff. */
const GLOW_STEPS = 12;
const GLOW_UNIT_RADIUS = 16;

const RING_TICKS = 9;
const RING_RADIUS = 21;
const RING_START_SCALE = 0.4;
const RING_WIDTH = 2.4;
const RING_ALPHA = 0.75;
/** Ground-ellipse squash, the selection ring's. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);

const SPARKS = 6;
/** Sparks leave over the sip's first ticks rather than all at once. */
const SPARK_SPREAD_TICKS = 5;
const SPARK_TICKS = 9;
const SPARK_RADIUS = 5;
/** How far in a spark's arms pinch toward its middle. */
const SPARK_WAIST = 0.32;
const SPARK_MIN_RISE = 16;
const SPARK_EXTRA_RISE = 14;
const SPARK_END_SCALE = 0.35;
const SPARK_FADE_IN_SHARE = 0.15;
/** How far toward white a spark stands from the drink's colour. */
const SPARK_LIGHTEN = 0.55;

/** The streams of the per-spark random numbers. */
const SEED_DELAY = 0;
const SEED_X = 1;
const SEED_Y = 2;
const SEED_RISE = 3;
const SEED_STREAMS = 4;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

function lighten(colour: number, share: number): number {
  const channel = (shift: number): number => {
    const value = (colour >> shift) & 0xff;
    return Math.round(lerp(value, 0xff, share)) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

interface SparkPose {
  /** Offsets from the body's middle, as shares of the glow's half extents. */
  readonly x: number;
  readonly y: number;
  /** World px risen so far. */
  readonly rise: number;
  readonly scale: number;
  readonly alpha: number;
}

/** One frame of a sip's show. */
export interface DraughtGlowPose {
  readonly glowAlpha: number;
  readonly glowScale: number;
  /** Zero once the ring has run out. */
  readonly ringAlpha: number;
  readonly ringScale: number;
  /** One per spark, `null` before it leaves and after it has gone. */
  readonly sparks: readonly (SparkPose | null)[];
}

/** The show `age` ticks after the sip, or null outside its life. `seed` scatters the sparks. */
export function draughtGlowPose(age: number, seed: number): DraughtGlowPose | null {
  if (age < 0 || age >= DRAUGHT_GLOW_TICKS) return null;
  const glowLife = clamp01(age / GLOW_END_TICKS);
  const fade = clamp01((GLOW_END_TICKS - age) / (GLOW_END_TICKS - GLOW_PEAK_TICKS));
  const ringLife = clamp01(age / RING_TICKS);
  const sparks: (SparkPose | null)[] = [];
  for (let i = 0; i < SPARKS; i++) {
    const stream = i * SEED_STREAMS;
    const local = (age - frac(seed, stream + SEED_DELAY) * SPARK_SPREAD_TICKS) / SPARK_TICKS;
    if (local < 0 || local >= 1) {
      sparks.push(null);
      continue;
    }
    sparks.push({
      x: frac(seed, stream + SEED_X) * 2 - 1,
      y: frac(seed, stream + SEED_Y) - 0.5,
      rise: (SPARK_MIN_RISE + frac(seed, stream + SEED_RISE) * SPARK_EXTRA_RISE) * easeOutCubic(local),
      scale: lerp(1, SPARK_END_SCALE, local),
      alpha: Math.min(clamp01(local / SPARK_FADE_IN_SHARE), 1 - local),
    });
  }
  return {
    glowAlpha: GLOW_ALPHA * clamp01(age / GLOW_PEAK_TICKS) * fade * fade,
    glowScale: lerp(GLOW_START_SCALE, GLOW_END_SCALE, easeOutCubic(glowLife)),
    ringAlpha: RING_ALPHA * (1 - ringLife),
    ringScale: lerp(RING_START_SCALE, 1, easeOutCubic(ringLife)),
    sparks,
  };
}

interface Sip {
  readonly spawnTick: number;
  readonly colour: number;
}

interface GlowNode {
  /** Under the drinker, on the ground. */
  readonly ring: Graphics;
  /** Over the drinker: the glow and the sparks. */
  readonly over: Container;
  readonly glow: Graphics;
  readonly sparks: readonly Graphics[];
  colour: number | undefined;
}

export interface DraughtGlowFrame {
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

function sparkShape(): Graphics {
  const waist = SPARK_RADIUS * SPARK_WAIST;
  return new Graphics()
    .poly([0, -SPARK_RADIUS, waist, -waist, SPARK_RADIUS, 0, waist, waist])
    .poly([0, SPARK_RADIUS, -waist, waist, -SPARK_RADIUS, 0, -waist, -waist])
    .poly([waist, -waist, waist, waist, -waist, waist, -waist, -waist])
    .fill({ color: 0xffffff });
}

function glowShape(): Graphics {
  const glow = new Graphics();
  for (let step = GLOW_STEPS; step >= 1; step--) {
    glow
      .circle(0, 0, (GLOW_UNIT_RADIUS * step) / GLOW_STEPS)
      .fill({ color: 0xffffff, alpha: 1 / GLOW_STEPS });
  }
  return glow;
}

export class DraughtGlowLayer {
  /** The latest sip of each drinker still showing. */
  private readonly sips = new Map<number, Sip>();
  private readonly nodes = new Map<number, GlowNode>();
  private readonly seen = new Set<number>();
  private colourOfGood: ReadonlyMap<number, number> | undefined;

  /** The nodes sit in the depth-sorted sprite layer, so what stands in front of the drinker covers them. */
  constructor(private readonly spriteLayer: Container) {}

  /** Good type → the colour its sip glows in; `null` shows no sip at all. */
  setColours(colourOfGood: ReadonlyMap<number, number> | null): void {
    this.colourOfGood = colourOfGood ?? undefined;
  }

  ingest(events: readonly SimEvent[], tick: number): void {
    const colours = this.colourOfGood;
    if (colours === undefined) return;
    for (const ev of events) {
      if (ev.kind !== 'draughtDrunk') continue;
      const colour = colours.get(ev.goodType);
      if (colour !== undefined) this.sips.set(ev.entity, { spawnTick: tick, colour });
    }
  }

  draw(frame: DraughtGlowFrame): void {
    this.seen.clear();
    for (const [id, sip] of this.sips) {
      const age = frame.renderTime - sip.spawnTick;
      if (age >= DRAUGHT_GLOW_TICKS) {
        this.sips.delete(id);
        continue;
      }
      const pose = draughtGlowPose(age, id ^ sip.spawnTick);
      const feet = frame.drawn.anchorOf(id);
      const depth = frame.drawn.depthOf?.(id);
      if (pose === null || feet === undefined || depth === undefined) continue;
      if (!isVisible(frame.viewport, feet.x, feet.y)) continue;
      this.place(this.nodeOf(id, sip.colour), pose, feet, depth);
      this.seen.add(id);
    }
    retireUndrawn(this.nodes, this.seen, destroyNode);
  }

  destroy(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
    this.sips.clear();
  }

  private nodeOf(id: number, colour: number): GlowNode {
    let node = this.nodes.get(id);
    if (node === undefined) {
      const ring = new Graphics()
        .ellipse(0, 0, RING_RADIUS, RING_RADIUS * ISO_RATIO)
        .stroke({ color: 0xffffff, width: RING_WIDTH });
      const glow = glowShape();
      const sparks = Array.from({ length: SPARKS }, sparkShape);
      const over = new Container();
      over.addChild(glow, ...sparks);
      // Only the glow adds light: added to the ground, the ring and sparks would lose the drink's hue.
      glow.blendMode = 'add';
      this.spriteLayer.addChild(ring, over);
      node = { ring, over, glow, sparks, colour: undefined };
      this.nodes.set(id, node);
    }
    if (node.colour !== colour) {
      node.colour = colour;
      node.ring.tint = colour;
      node.glow.tint = colour;
      const sparkColour = lighten(colour, SPARK_LIGHTEN);
      for (const spark of node.sparks) spark.tint = sparkColour;
    }
    return node;
  }

  private place(
    node: GlowNode,
    pose: DraughtGlowPose,
    feet: { readonly x: number; readonly y: number },
    depth: number,
  ): void {
    // Alpha, not visibility, hides a part: a visibility change rebuilds the layer's draw instructions.
    node.ring.position.set(feet.x, feet.y);
    node.ring.scale.set(pose.ringScale);
    node.ring.alpha = pose.ringAlpha;
    node.ring.zIndex = depth - SHADOW_DEPTH_EPS;

    node.over.position.set(feet.x, feet.y - GLOW_ABOVE_FEET);
    node.over.zIndex = depth + SHADOW_DEPTH_EPS;
    node.glow.alpha = pose.glowAlpha;
    node.glow.scale.set(
      (GLOW_HALF_WIDTH / GLOW_UNIT_RADIUS) * pose.glowScale,
      (GLOW_HALF_HEIGHT / GLOW_UNIT_RADIUS) * pose.glowScale,
    );
    for (let i = 0; i < node.sparks.length; i++) {
      const spark = node.sparks[i];
      const at = pose.sparks[i] ?? null;
      if (spark === undefined) continue;
      spark.alpha = at?.alpha ?? 0;
      if (at === null) continue;
      spark.position.set(at.x * GLOW_HALF_WIDTH, at.y * GLOW_HALF_HEIGHT - at.rise);
      spark.scale.set(at.scale);
    }
  }
}

function destroyNode(node: GlowNode): void {
  node.ring.destroy();
  node.over.destroy({ children: true });
}
