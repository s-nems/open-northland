import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { isVisible, TILE_HALF_H, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { markMagnifiedTexture } from '../pixel-art/registry.js';
import { retireUndrawn } from './retained-pool.js';

/**
 * A map ping on the world view: a pin headed by a round shield in the pinging player's colour drops
 * onto the spot, lands with a squash and hovers there pointing at it, while rings run out over the
 * ground from under its point. It stands over every sprite, so a ping behind a building still shows. A
 * presentation addition, not taken from the original. The app owns the clock and hands each ping's age.
 * Extents in world px at zoom 1; authored.
 */

export interface MapPing {
  /** Stable for the ping's life, the retained-pool key. */
  readonly id: number;
  /** The half-cell node the ping names. */
  readonly hx: number;
  readonly hy: number;
  readonly colour: number;
  /** Wall-clock ms since the ping was raised. */
  readonly ageMs: number;
}

/** How long one ping shows, in wall-clock ms. */
export const MAP_PING_MS = 4200;
/** The shares of the ping's life over which it fades in at the start and out at the end. */
const FADE_IN_SHARE = 0.03;
const FADE_OUT_SHARE = 0.18;

/** The pin falls this far onto the spot, squashes as it lands, then hovers. */
const DROP_HEIGHT = 72;
const DROP_MS = 220;
const SQUASH = 0.26;
const SQUASH_DECAY_MS = 150;
const SQUASH_MS_PER_RADIAN = 42;
/** How high the hovering pin's point rises over the spot, and its pace. */
const HOVER_HEIGHT = 7;
const HOVER_MS_PER_RADIAN = 190;

/** Two waves of two rings leave the spot, the first as the pin lands. */
const WAVE_STARTS_MS = [DROP_MS, DROP_MS + 1600];
const RINGS_PER_WAVE = 2;
const RING_STAGGER_MS = 260;
const RING_MS = 1100;
const RING_START_RADIUS = 6;
const RING_END_RADIUS = 66;
const RING_START_WIDTH = 3.4;
const RING_END_WIDTH = 1.2;
const RING_ALPHA = 0.9;
const RING_RIM_ALPHA = 0.5;

/** The ground under the pin: a patch of the player's colour that breathes, and the pin's shadow, which
 *  shrinks as the pin rises. */
const GLOW_RADIUS = 30;
const GLOW_ALPHA_LOW = 0.14;
const GLOW_ALPHA_HIGH = 0.3;
const GLOW_MS_PER_RADIAN = 210;
const SHADOW_RADIUS = 9;
const SHADOW_ALPHA = 0.4;
/** The lift at which the shadow has shrunk to half. */
const SHADOW_HALF_LIFT = 40;

/** The stand-in pin drawn when the art failed to load: a disc of the player's colour on a gilded point. */
const STAND_IN_RADIUS = 13;
const STAND_IN_HEIGHT = 44;
const STAND_IN_POINT_HALF_WIDTH = 5;
const GILT = 0xd8a93a;

const OUTLINE = 0x1a120a;
const OUTLINE_WIDTH = 1.5;

/** Ground-ellipse squash, the selection ring's: a ground circle spans a cell width east-west but only a
 *  row step north-south. */
const ISO_RATIO = TILE_HALF_H / (2 * TILE_HALF_W);

interface MapPingRing {
  readonly radius: number;
  readonly width: number;
  readonly alpha: number;
}

/** One frame of a ping's animation. */
interface MapPingPose {
  /** The whole ping's opacity. */
  readonly alpha: number;
  readonly rings: readonly MapPingRing[];
  /** How high over its spot the pin's point is, in world px. */
  readonly lift: number;
  /** The landing squash: the share the pin loses in height and gains, halved, in width. */
  readonly squash: number;
  readonly glowAlpha: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInQuad = (t: number): number => t * t;
const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** The ping `ageMs` after it was raised, or null once it has gone. */
function mapPingPose(ageMs: number): MapPingPose | null {
  if (ageMs < 0 || ageMs >= MAP_PING_MS) return null;
  const life = ageMs / MAP_PING_MS;
  const alpha = Math.min(clamp01(life / FADE_IN_SHARE), clamp01((1 - life) / FADE_OUT_SHARE));
  const rings: MapPingRing[] = [];
  for (const waveStart of WAVE_STARTS_MS) {
    for (let k = 0; k < RINGS_PER_WAVE; k++) {
      const local = (ageMs - waveStart - k * RING_STAGGER_MS) / RING_MS;
      if (local < 0 || local > 1) continue;
      rings.push({
        radius: lerp(RING_START_RADIUS, RING_END_RADIUS, easeOutCubic(local)),
        width: lerp(RING_START_WIDTH, RING_END_WIDTH, local),
        alpha: (1 - local) * RING_ALPHA,
      });
    }
  }
  const landed = ageMs - DROP_MS;
  const breathing = (1 + Math.sin(ageMs / GLOW_MS_PER_RADIAN)) / 2;
  return {
    alpha,
    rings,
    lift:
      landed < 0
        ? DROP_HEIGHT * (1 - easeInQuad(ageMs / DROP_MS))
        : (HOVER_HEIGHT * (1 - Math.cos(landed / HOVER_MS_PER_RADIAN))) / 2,
    squash:
      landed < 0 ? 0 : SQUASH * Math.exp(-landed / SQUASH_DECAY_MS) * Math.cos(landed / SQUASH_MS_PER_RADIAN),
    glowAlpha: lerp(GLOW_ALPHA_LOW, GLOW_ALPHA_HIGH, breathing),
  };
}

/** The pin art's two halves: the painted pin, and beside it the shield's planks in grey for tinting.
 *  Each half wears a transparent gutter, so a scaled sample never reaches the other. */
interface PinArt {
  readonly body: Texture;
  readonly planks: Texture;
}
const PIN_GUTTER = 2;

function splitPinArt(page: Texture): PinArt {
  const width = page.frame.width / 2;
  const half = (x: number): Texture => {
    const texture = new Texture({
      source: page.source,
      frame: new Rectangle(page.frame.x + x, page.frame.y, width, page.frame.height),
    });
    markMagnifiedTexture(texture);
    return texture;
  };
  return { body: half(0), planks: half(width) };
}

interface PingNode {
  readonly root: Container;
  readonly glow: Graphics;
  readonly shadow: Graphics;
  readonly rings: Graphics;
  /** The pin, its point at the origin. */
  readonly pin: Container;
}

function standInPin(colour: number): Graphics {
  const centreY = -STAND_IN_HEIGHT + STAND_IN_RADIUS;
  return new Graphics()
    .poly([-STAND_IN_POINT_HALF_WIDTH, centreY, STAND_IN_POINT_HALF_WIDTH, centreY, 0, 0])
    .fill({ color: GILT })
    .stroke({ width: OUTLINE_WIDTH, color: OUTLINE, join: 'round' })
    .circle(0, centreY, STAND_IN_RADIUS)
    .fill({ color: colour })
    .stroke({ width: OUTLINE_WIDTH * 2, color: GILT });
}

function makeNode(colour: number, art: PinArt | undefined): PingNode {
  const root = new Container();
  const ground = new Container();
  ground.scale.y = ISO_RATIO;
  const glow = new Graphics().circle(0, 0, GLOW_RADIUS).fill({ color: colour });
  const shadow = new Graphics().circle(0, 0, SHADOW_RADIUS).fill({ color: OUTLINE });
  const rings = new Graphics();
  ground.addChild(glow, rings, shadow);
  const pin = new Container();
  if (art === undefined) pin.addChild(standInPin(colour));
  else {
    const body = new Sprite(art.body);
    const planks = new Sprite(art.planks);
    planks.tint = colour;
    for (const sprite of [body, planks]) {
      sprite.anchor.set(0.5, 1);
      sprite.y = PIN_GUTTER;
    }
    pin.addChild(body, planks);
  }
  root.addChild(ground, pin);
  return { root, glow, shadow, rings, pin };
}

function pose(node: PingNode, colour: number, p: MapPingPose): void {
  node.root.alpha = p.alpha;
  node.glow.alpha = p.glowAlpha;
  node.shadow.alpha = SHADOW_ALPHA;
  node.shadow.scale.set(SHADOW_HALF_LIFT / (SHADOW_HALF_LIFT + p.lift));
  node.rings.clear();
  for (const ring of p.rings) {
    node.rings
      .circle(0, 0, ring.radius)
      .stroke({ width: ring.width + 2 * OUTLINE_WIDTH, color: OUTLINE, alpha: RING_RIM_ALPHA * ring.alpha })
      .circle(0, 0, ring.radius)
      .stroke({ width: ring.width, color: colour, alpha: ring.alpha });
  }
  node.pin.position.set(0, -p.lift);
  node.pin.scale.set(1 + p.squash / 2, 1 - p.squash);
}

export class MapPingLayer {
  readonly container = new Container();
  private readonly nodes = new Map<number, PingNode>();
  private readonly seen = new Set<number>();
  private readonly art: PinArt | undefined;

  /** `pin` is the pin art's page; absent draws a flat stand-in. */
  constructor(pin?: Texture) {
    this.art = pin === undefined ? undefined : splitPinArt(pin);
  }

  draw(pings: readonly MapPing[], elevation: ElevationField, viewport: Viewport): void {
    this.seen.clear();
    for (const ping of pings) {
      const p = mapPingPose(ping.ageMs);
      if (p === null) continue;
      const spot = projectNode(elevation, ping.hx, ping.hy);
      if (!isVisible(viewport, spot.x, spot.y)) continue;
      let node = this.nodes.get(ping.id);
      if (node === undefined) {
        node = makeNode(ping.colour, this.art);
        this.container.addChild(node.root);
        this.nodes.set(ping.id, node);
      }
      node.root.position.set(spot.x, spot.y);
      pose(node, ping.colour, p);
      this.seen.add(ping.id);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.root.destroy({ children: true }));
  }

  destroy(): void {
    this.container.destroy({ children: true });
    this.art?.body.destroy();
    this.art?.planks.destroy();
    this.nodes.clear();
  }
}
