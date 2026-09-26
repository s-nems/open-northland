import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { type Container, Graphics, Sprite } from 'pixi.js';
import { frac } from '../../data/effects/index.js';
import { clamp01 } from '../../data/math.js';
import { halfCellToScreen, isVisible, TILE_HALF_H, type Viewport } from '../../data/projection/index.js';
import {
  SHADOW_DEPTH_EPS,
  type ShotPath,
  type SiegeShot,
  screenDepth,
  shotGroundLift,
  shotPath,
  shotPoseAt,
  siegeShotsOf,
} from '../../data/scene/index.js';
import { type ParticleRef, particleFrame } from '../../data/sprites/index.js';
import { type ElevationField, elevationLiftPerUnit, terrainLiftAtNode } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { layeredLayerFor } from '../sprite-pool/layered-layers.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { worldBatched } from '../world-batcher.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * A siege shot from launch to the smoke it raises: the tumbling stone on a parabola drawn at the frame's
 * own time, its soft shadow on the ground, the puff it leaves behind every flight tick, and the smoke
 * where it comes down. Every node sits in the depth-sorted sprite layer at the ground point under it, as
 * the original files a particle into the row of the map point beneath it.
 *
 * Original behavior: the stone (`[particel] Rock`) loops its 8 tumble frames a tick each and spawns its
 * `spawnparticelId` puff (`Rock Smoke`) every tick from its second on, each puff playing its frames once
 * while it sinks; the weapon's `createsmoke` raises `Smoke.org` on the landing point for `smokelifetime`
 * less up to 9 random ticks, cut off part-grown. It draws no shadow: the shadow, the smoke's full growth and
 * fade-out, and its sorting in front of what it struck are Open Northland's.
 */
export class ShotLayer {
  private readonly tracks = new Map<number, Track>();
  private smokes: ImpactSmoke[] = [];
  private readonly nodes = new Map<string, Container>();
  private readonly seen = new Set<string>();
  private lastSnapshot: WorldSnapshot | undefined;

  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** Undefined, or a sheet with no munition binding, draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /** Raise the smoke of every siege shot that came down this frame. */
  ingest(events: readonly SimEvent[], tick: number): void {
    const live = this.smokes.filter((s) => tick - s.spawnTick < s.lifetime);
    for (const ev of events) {
      if (ev.kind !== 'groundBurst' || ev.smokeTicks === undefined) continue;
      const jitter = Math.floor(frac(ev.projectile, SMOKE_JITTER_SEED) * SMOKE_LIFETIME_JITTER_TICKS);
      live.push({
        key: `smoke:${ev.projectile}`,
        hx: ev.at.hx,
        hy: ev.at.hy,
        spawnTick: tick,
        lifetime: Math.max(1, ev.smokeTicks - jitter),
      });
    }
    this.smokes = live;
  }

  draw(frame: ShotFrame): void {
    this.seen.clear();
    const binding = this.sheet?.bindings.munition;
    if (binding !== undefined) {
      this.trackShots(frame);
      this.drawShots(frame, binding.byMunition, binding.trailByMunition);
      if (binding.impactSmoke !== undefined) this.drawSmokes(frame, binding.impactSmoke);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy({ children: true }));
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy({ children: true });
    this.nodes.clear();
    this.tracks.clear();
  }

  /** Remember every shot in the snapshot the pool draws, so its trail outlives the stone's landing. */
  private trackShots(frame: ShotFrame): void {
    if (frame.snapshot === this.lastSnapshot) return;
    this.lastSnapshot = frame.snapshot;
    for (const track of this.tracks.values()) track.inFlight = false;
    for (const shot of siegeShotsOf(frame.snapshot)) {
      const known = this.tracks.get(shot.ref);
      if (known !== undefined) {
        known.inFlight = true;
        continue;
      }
      this.tracks.set(shot.ref, { shot, path: shotPath(shot, frame.elevation), inFlight: true });
    }
  }

  private drawShots(
    frame: ShotFrame,
    stones: Readonly<Record<number, ParticleRef>>,
    trails: Readonly<Record<number, ParticleRef>>,
  ): void {
    for (const [ref, track] of this.tracks) {
      const { shot, path } = track;
      // The pool draws each entity a tick behind the snapshot, sliding from its previous anchor; the stone
      // keeps that pace, so it lands as the snapshot that drops it arrives.
      const flown = frame.renderTime - SNAPSHOT_LAG_TICKS - shot.launchTick;
      const trail = trails[shot.munitionType];
      if (flown > shot.flightTicks + (trail === undefined ? 0 : trailLifeTicks(trail)) + 1) {
        this.tracks.delete(ref);
        continue;
      }
      const stone = stones[shot.munitionType];
      if (stone === undefined) continue;
      // The pool's cull and fog decide whether the shot shows at all; a landed one keeps its last verdict.
      if (track.inFlight) track.visible = frame.drawn.anchorOf(ref) !== undefined;
      if (track.visible !== true) continue;
      if (track.inFlight) this.drawStone(frame, track, stone, flown);
      if (trail !== undefined) this.drawTrail(frame, shot, path, trail, flown);
    }
  }

  private drawStone(frame: ShotFrame, track: Track, stone: ParticleRef, flown: number): void {
    const { shot, path } = track;
    const pose = shotPoseAt(path, shot, flown);
    const depth = screenDepth(pose.x, pose.y, 'projectile');
    const bob = particleFrame(stone, Math.max(0, flown));
    if (bob !== undefined) {
      this.placeParticle(`stone:${shot.ref}`, stone.layer, bob, pose.x, pose.y - pose.lift, depth, 1, frame);
    }
    const ground = shotGroundLift(shot, frame.elevation, flown);
    const height = clamp01((pose.lift - ground) / Math.max(1, path.peak));
    this.placeShadow(`shadow:${shot.ref}`, pose.x, pose.y - ground, depth - SHADOW_DEPTH_EPS, height, frame);
  }

  /** One puff per flight tick from the second on, each where the stone was that tick, sinking as it
   *  shrinks through its frames. */
  private drawTrail(
    frame: ShotFrame,
    shot: SiegeShot,
    path: ShotPath,
    trail: ParticleRef,
    flown: number,
  ): void {
    const life = trailLifeTicks(trail);
    const newest = Math.min(Math.floor(flown), shot.flightTicks);
    const oldest = Math.max(1, newest - life + 1);
    const sink = elevationLiftPerUnit() * TRAIL_SINK_UNITS_PER_TICK;
    for (let spawned = oldest; spawned <= newest; spawned++) {
      const age = flown - spawned;
      if (age < 0 || age >= life) continue;
      const bob = particleFrame(trail, age);
      if (bob === undefined) continue;
      const pose = shotPoseAt(path, shot, spawned);
      this.placeParticle(
        `trail:${shot.ref}:${spawned}`,
        trail.layer,
        bob,
        pose.x,
        pose.y - pose.lift + sink * age,
        screenDepth(pose.x, pose.y, 'projectile') - TRAIL_DEPTH_EPS,
        TRAIL_ALPHA,
        frame,
      );
    }
  }

  private drawSmokes(frame: ShotFrame, smoke: ParticleRef): void {
    for (const s of this.smokes) {
      const age = frame.renderTime - s.spawnTick;
      if (age < 0 || age >= s.lifetime) continue;
      // The cloud grows through its whole frame list over its life, where the original cuts it off part-grown.
      const frameCount = smoke.valencies[0]?.length ?? 1;
      const bob = particleFrame(smoke, (age * frameCount) / s.lifetime);
      if (bob === undefined) continue;
      const ground = halfCellToScreen(s.hx, s.hy);
      const lift = terrainLiftAtNode(frame.elevation, s.hx, s.hy);
      const fade = clamp01((s.lifetime - age) / (s.lifetime * SMOKE_FADE_FRACTION));
      const depth = screenDepth(ground.x, ground.y + SMOKE_FORWARD_ROWS * TILE_HALF_H, 'projectile');
      this.placeParticle(s.key, smoke.layer, bob, ground.x, ground.y - lift, depth, fade, frame);
    }
  }

  /** Show `bob` of family `layer` with its anchor at `(x, y)`, re-texturing the key's retained sprite. */
  private placeParticle(
    key: string,
    layer: string,
    bob: number,
    x: number,
    y: number,
    depth: number,
    alpha: number,
    frame: ShotFrame,
  ): void {
    let node = this.nodes.get(key);
    if (!isVisible(frame.viewport, x, y)) {
      retainOffscreen(node, key, this.seen);
      return;
    }
    const sheet = this.sheet;
    const resolved = sheet === undefined ? null : layeredLayerFor(sheet, 'projectile', { layer, bob });
    if (resolved === null) return;
    if (node === undefined) {
      node = worldBatched(new Sprite());
      this.spriteLayer.addChild(node);
      this.nodes.set(key, node);
    }
    const sprite = node as Sprite;
    sprite.texture = this.textures.get(resolved.source, resolved.frame);
    sprite.scale.set(resolved.scale);
    sprite.position.set(
      x + resolved.frame.offsetX * resolved.scale,
      y + resolved.frame.offsetY * resolved.scale,
    );
    sprite.zIndex = depth;
    sprite.alpha = alpha;
    sprite.visible = true;
    this.seen.add(key);
  }

  /** A soft ellipse on the ground under the stone, smaller and fainter the higher the stone flies. */
  private placeShadow(
    key: string,
    x: number,
    y: number,
    depth: number,
    height: number,
    frame: ShotFrame,
  ): void {
    let node = this.nodes.get(key);
    if (!isVisible(frame.viewport, x, y)) {
      retainOffscreen(node, key, this.seen);
      return;
    }
    if (node === undefined) {
      node = new Graphics()
        .ellipse(0, 0, SHADOW_RADIUS_X, SHADOW_RADIUS_X * SHADOW_SQUASH)
        .fill({ color: SHADOW_COLOUR });
      this.spriteLayer.addChild(node);
      this.nodes.set(key, node);
    }
    node.position.set(x, y);
    node.scale.set(1 - SHADOW_SHRINK * height);
    node.alpha = SHADOW_ALPHA * (1 - SHADOW_FADE * height);
    node.zIndex = depth;
    node.visible = true;
    this.seen.add(key);
  }
}

/** One frame's inputs: the same snapshot, pool geometry, cull box and render clock the marks draw by. */
export interface ShotFrame {
  readonly snapshot: WorldSnapshot;
  readonly drawn: DrawnGeometry;
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

interface Track {
  readonly shot: SiegeShot;
  readonly path: ShotPath;
  /** Still in the latest snapshot; a landed shot's trail plays out without it. */
  inFlight: boolean;
  /** The pool drew the shot at its last sighting in flight. */
  visible?: boolean;
}

interface ImpactSmoke {
  readonly key: string;
  readonly hx: number;
  readonly hy: number;
  readonly spawnTick: number;
  readonly lifetime: number;
}

/** The pool's one-tick draw lag behind the snapshot, which the stone keeps. */
const SNAPSHOT_LAG_TICKS = 1;
/** A trail puff's life: its shrinking frames once through, a tick each (approximation of the pacing). */
function trailLifeTicks(trail: ParticleRef): number {
  return trail.valencies[0]?.length ?? 0;
}
/** How far a puff sinks per tick, in elevation units (approximation, about one a tick). */
const TRAIL_SINK_UNITS_PER_TICK = 1;
/** Trail puffs draw translucent (`bobtype 2`); the blend strength is an approximation. The landing smoke's
 *  own pixels are faint enough to draw opaque. */
const TRAIL_ALPHA = 0.6;
/** The stone draws in front of its own newest puff at the same ground point. */
const TRAIL_DEPTH_EPS = SHADOW_DEPTH_EPS / 2;
/** The landing smoke's lifetime shortens by up to this many ticks, seeded per shot (original: `rand%10`). */
const SMOKE_LIFETIME_JITTER_TICKS = 10;
const SMOKE_JITTER_SEED = 7;
/** How many map rows in front of its landing point the landing smoke sorts, so the cloud rises in front
 *  of the house or hull it struck; the original files it at the landing row, behind that body. */
const SMOKE_FORWARD_ROWS = 3;
/** The share of its life over which the landing smoke fades out, where the original cuts it off. */
const SMOKE_FADE_FRACTION = 0.4;
/** The shadow at ground level, in world px, and how much of its size and opacity it loses at the lob's
 *  peak. */
const SHADOW_RADIUS_X = 8;
const SHADOW_SQUASH = 0.45;
const SHADOW_SHRINK = 0.5;
const SHADOW_ALPHA = 0.35;
const SHADOW_FADE = 0.6;
const SHADOW_COLOUR = 0x000000;
