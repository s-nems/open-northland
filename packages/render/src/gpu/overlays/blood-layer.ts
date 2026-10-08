import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { Container, Sprite } from 'pixi.js';
import {
  BLOOD_AIR_TICKS,
  type BloodDrop,
  type BloodDropPose,
  type BloodMark,
  bloodDroplet,
  bloodDrops,
  bloodFade,
  foldBloodMarks,
  GROUND_SQUASH,
  smoothUnit,
} from '../../data/effects/blood.js';
import { frac } from '../../data/effects/random.js';
import {
  isVisible,
  rowStagger,
  TILE_HALF_H,
  TILE_HALF_W,
  type Viewport,
} from '../../data/projection/index.js';
import { screenDepth } from '../../data/scene/index.js';
import { type ElevationField, terrainLiftAtNode, type WaterField } from '../../data/terrain/index.js';
import type { DrawnGeometry } from '../sprite-pool/index.js';
import { worldBatched } from '../world-batcher.js';
import { BloodTextures } from './blood-textures.js';
import { retireUndrawn } from './retained-pool.js';

export interface BloodFrame {
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  /** Unpadded screen bounds; blood needs only its own small extent, not the tallest building's. */
  readonly screenViewport?: Viewport;
  readonly renderTime: number;
  readonly water: WaterField;
  readonly fogVisible?: ((x: number, y: number) => boolean) | undefined;
  readonly drawn?: DrawnGeometry;
}

interface DropNode {
  readonly motion: BloodDrop;
  air: Sprite | undefined;
  readonly stain: Sprite;
}
interface BloodNode {
  readonly ground: Container;
  air: Container | undefined;
  jet: Sprite | undefined;
  readonly pool: Sprite;
  readonly drops: readonly DropNode[];
  readonly poolScale: number;
  settled: boolean;
}

/** Blood in flight sorts at the victim's feet; settled blood lives below fog and selection.
 * Only on-screen marks own sprites. The bounded event history permits a later camera return. */
export class BloodLayer {
  readonly groundContainer = new Container();
  private enabled = true;
  private marks: readonly BloodMark[] = [];
  private readonly launches = new Map<number, { hx: number; hy: number; tick: number }>();
  private readonly bodyRises = new Map<BloodMark, number>();
  private readonly nodes = new Map<BloodMark, BloodNode>();
  private readonly seen = new Set<BloodMark>();
  private textures: BloodTextures | undefined;
  private readonly pose: BloodDropPose = {
    x: 0,
    y: 0,
    groundY: 0,
    angle: 0,
    stretch: 1,
    landed: false,
    visible: false,
  };

  constructor(private readonly spriteLayer: Container) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) return;
    this.marks = [];
    this.launches.clear();
    this.bodyRises.clear();
    for (const node of this.nodes.values()) this.retire(node);
    this.nodes.clear();
  }

  ingest(events: readonly SimEvent[], tick: number, snapshot?: WorldSnapshot): void {
    if (!this.enabled) return;
    // The source of a flying arrow survives its shooter's movement or death. Missed/hidden impacts
    // have no matching event here, so expire their origins and bound a large volley independently.
    for (const [id, launch] of this.launches) if (tick - launch.tick > 360) this.launches.delete(id);
    for (const event of events) {
      if (event.kind !== 'projectileLaunched') continue;
      this.launches.set(event.projectile, { ...event.at, tick });
      if (this.launches.size > 512) {
        const oldest = this.launches.keys().next().value;
        if (oldest !== undefined) this.launches.delete(oldest);
      }
    }
    const next = foldBloodMarks(this.marks, events, tick, snapshot, this.launches);
    if (next !== this.marks) {
      const live = new Set(next);
      for (const mark of this.bodyRises.keys()) if (!live.has(mark)) this.bodyRises.delete(mark);
      this.marks = next;
    }
    for (const event of events)
      if (event.kind === 'projectileHit' || event.kind === 'projectileMissed')
        this.launches.delete(event.projectile);
  }

  draw({
    elevation,
    viewport,
    screenViewport,
    renderTime: tick,
    water,
    fogVisible,
    drawn,
  }: BloodFrame): void {
    this.seen.clear();
    for (const mark of this.marks) {
      const age = tick - mark.spawnTick;
      const alpha = bloodFade(age);
      const x = mark.hx * TILE_HALF_W;
      const baseY = (mark.hy * TILE_HALF_H) / 2;
      const y = baseY - terrainLiftAtNode(elevation, mark.hx, mark.hy);
      if (alpha <= 0 || !isVisible(screenViewport ?? viewport, x, y, 64)) continue;
      let node = this.nodes.get(mark);
      if (node === undefined) {
        let bodyRise = this.bodyRises.get(mark);
        if (bodyRise === undefined) {
          const bounds = drawn?.boundsOf(mark.target);
          bodyRise =
            bounds === undefined ? 20 : Math.max(5, Math.min(26, (bounds.maxY - bounds.minY) * 0.42));
          // Keep the first sampled height after culling: later animation frames must not move old stains.
          this.bodyRises.set(mark, bodyRise);
        }
        node = this.makeNode(mark, bodyRise, age < BLOOD_AIR_TICKS);
        this.nodes.set(mark, node);
      }
      node.ground.position.set(x, y);
      if (node.air !== undefined) {
        node.air.position.set(x, y);
        // Same anchor as a settler, half a paint step above it; foreground fighters still occlude it.
        node.air.zIndex = screenDepth(x, baseY, 'settler') + 0.125;
        node.air.visible =
          age < BLOOD_AIR_TICKS &&
          (fogVisible === undefined || fogVisible((mark.hx - rowStagger(mark.hy / 2)) / 2, mark.hy / 2));
      }
      node.ground.alpha = alpha * (1 - water.surface(mark.hx, mark.hy));
      node.ground.tint = dryColour(age);
      this.animate(node, mark, age);
      this.seen.add(mark);
    }
    retireUndrawn(this.nodes, this.seen, (node) => this.retire(node));
  }

  private makeNode(mark: BloodMark, bodyRise: number, airborne: boolean): BloodNode {
    this.textures ??= new BloodTextures();
    const textures = this.textures;
    const ground = this.groundContainer.addChild(new Container());
    const air = airborne ? this.spriteLayer.addChild(new Container()) : undefined;
    const jet = air?.addChild(worldBatched(new Sprite(textures.stain(mark.seed + 3))));
    if (air !== undefined) air.tint = 0xc72620;
    if (jet !== undefined) {
      jet.anchor.set(0.1, 0.5);
      jet.position.set(0, -bodyRise);
      jet.rotation = Math.atan2(Math.sin(mark.heading) * GROUND_SQUASH, Math.cos(mark.heading));
    }
    const pool = ground.addChild(worldBatched(new Sprite(textures.stain(mark.seed))));
    pool.anchor.set(0.5);
    // Rotate in the ground plane, then squash the parent, so every shape stays flat on the terrain.
    const surface = ground.addChild(new Container());
    surface.scale.y = GROUND_SQUASH;
    pool.rotation = (frac(mark.seed, 90) - 0.5) * 0.5;
    const drops = bloodDrops(mark, bodyRise).map((motion, i) => {
      const flying = air?.addChild(worldBatched(new Sprite(textures.drop)));
      flying?.anchor.set(0.5);
      const stain = surface.addChild(worldBatched(new Sprite(textures.stain(mark.seed + i * 7))));
      stain.anchor.set(0.5);
      stain.position.set(motion.vx * motion.flight, (motion.vy * motion.flight) / GROUND_SQUASH);
      stain.rotation = frac(mark.seed, 110 + i) * Math.PI * 2;
      stain.visible = false;
      return { motion, air: flying, stain };
    });
    const strength = mark.fatal
      ? 1.25
      : mark.profile === 'blunt'
        ? 0.35
        : mark.profile === 'pierce'
          ? 0.55
          : 0.75;
    return {
      ground,
      air,
      jet,
      pool,
      drops,
      poolScale: strength * (0.85 + frac(mark.seed, 91) * 0.45),
      settled: false,
    };
  }

  private animate(node: BloodNode, mark: BloodMark, age: number): void {
    if (!node.settled || mark.fatal) {
      const spread = smoothUnit((age - 2) / (mark.fatal ? 20 : 7));
      node.pool.alpha = spread;
      node.pool.scale.set(
        node.poolScale * (0.55 + spread * 0.45),
        node.poolScale * GROUND_SQUASH * (0.55 + spread * 0.45),
      );
    }
    if (node.settled) return;
    if (node.jet !== undefined) {
      const strength = mark.profile === 'blunt' ? 0.6 : mark.fatal ? 1.2 : 1;
      const spread = smoothUnit(age / 3);
      node.jet.alpha = 1 - smoothUnit(age / 5);
      node.jet.scale.set(strength * (0.25 + spread * 0.7), strength * (0.23 + spread * 0.2));
    }
    for (const drop of node.drops) {
      const motion = drop.motion;
      bloodDroplet(motion, age, this.pose);
      if (drop.air !== undefined) {
        drop.air.visible = this.pose.visible && !this.pose.landed;
        drop.air.position.set(this.pose.x, this.pose.y);
        drop.air.rotation = this.pose.angle;
        drop.air.scale.set((motion.size * this.pose.stretch) / 4, motion.size / 4);
      }
      const contact = smoothUnit((age - motion.delay - motion.flight) / 1.5);
      drop.stain.visible = this.pose.landed;
      drop.stain.alpha = contact;
      drop.stain.scale.set(motion.size * (0.17 + contact * 0.06));
    }
    if (age >= BLOOD_AIR_TICKS) {
      // Thousands of settled marks must not retain or sort their old airborne particles.
      node.air?.destroy({ children: true });
      node.air = undefined;
      node.jet = undefined;
      for (const drop of node.drops) drop.air = undefined;
      node.settled = true;
    }
  }

  private retire(node: BloodNode): void {
    node.ground.destroy({ children: true });
    node.air?.destroy({ children: true });
  }

  destroy(): void {
    this.setEnabled(false);
    this.groundContainer.destroy();
    this.textures?.destroy();
    this.textures = undefined;
  }
}

/** Keep a red pigment through drying so the battlefield remains legible against grass. */
function dryColour(age: number): number {
  const dry = smoothUnit((age - 72) / 480);
  const r = Math.round(174 - dry * 58);
  const g = Math.round(24 + dry * 2);
  const b = Math.round(22 + dry * 1);
  return (r << 16) | (g << 8) | b;
}
