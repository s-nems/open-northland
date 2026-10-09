import type { SimEvent, WorldSnapshot } from '@open-northland/sim';
import { Container, Sprite } from 'pixi.js';
import {
  BLOOD_AIR_TICKS,
  type BloodDrop,
  type BloodDropPose,
  type BloodMark,
  bloodDroplet,
  bloodDrops,
  GROUND_SQUASH,
  smoothUnit,
} from '../../data/effects/blood.js';
import { BloodHistory } from '../../data/effects/blood-history.js';
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
import { BloodGround } from './blood-ground.js';
import { BloodSurfaces, type SurfaceContact } from './blood-surfaces.js';
import { BloodTextures } from './blood-textures.js';

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

interface AirNode {
  readonly container: Container;
  readonly jet: Sprite;
  readonly strength: number;
  readonly drops: readonly {
    readonly motion: BloodDrop;
    readonly sprite: Sprite;
    readonly contact: SurfaceContact | undefined;
  }[];
}
interface ContactPlan {
  readonly contacts: readonly (SurfaceContact | undefined)[];
  delivered: number;
}
interface Place {
  readonly x: number;
  readonly baseY: number;
  rise: number | undefined;
  elevation: ElevationField;
  y: number;
  water: WaterField;
  surface: number;
  contacts?: readonly (SurfaceContact | undefined)[];
}

/** Visible ground is one retained mesh; only the short airborne phase owns sorted sprites. */
export class BloodLayer {
  readonly groundContainer = new Container();
  readonly surfaces = new BloodSurfaces();
  groundSurfaces: Container | undefined;
  private enabled = true;
  private readonly places = new Map<BloodMark, Place>();
  private readonly pending = new Map<BloodMark, ContactPlan>();
  private readonly history = new BloodHistory((mark) => {
    this.places.delete(mark);
    this.pending.delete(mark);
  });
  private readonly launches = new Map<number, { hx: number; hy: number; tick: number }>();
  private readonly nodes = new Map<BloodMark, AirNode>();
  private readonly candidates: BloodMark[] = [];
  private visible: BloodMark[] = [];
  private nextVisible: BloodMark[] = [];
  private readonly seenAir = new Set<BloodMark>();
  private textures: BloodTextures | undefined;
  private ground: BloodGround | undefined;
  private revision = -1;
  private view: Viewport | undefined;
  private elevation: ElevationField | undefined;
  private water: WaterField | undefined;
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

  /** Diagnostic snapshot; rendering reads the spatial index instead. */
  get marks(): readonly BloodMark[] {
    return this.history.values();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) return;
    this.surfaces.clear();
    this.pending.clear();
    this.history.clear();
    this.launches.clear();
    this.places.clear();
    for (const node of this.nodes.values()) node.container.destroy({ children: true });
    this.nodes.clear();
    this.candidates.length = 0;
    this.visible.length = 0;
    this.nextVisible.length = 0;
    this.ground?.clear();
    this.revision = -1;
  }

  ingest(events: readonly SimEvent[], tick: number, snapshot?: WorldSnapshot): void {
    if (!this.enabled) return;
    // Launches retain their origins after a shooter's movement/death; order permits prefix expiry.
    for (const [id, launch] of this.launches) {
      if (tick - launch.tick <= 360) break;
      this.launches.delete(id);
    }
    for (const event of events) {
      if (event.kind !== 'projectileLaunched') continue;
      this.launches.set(event.projectile, { ...event.at, tick });
      if (this.launches.size > 512) {
        const oldest = this.launches.keys().next().value;
        if (oldest !== undefined) this.launches.delete(oldest);
      }
    }
    this.history.ingest(events, tick, snapshot, this.launches);
    for (const event of events)
      if (event.kind === 'projectileHit' || event.kind === 'projectileMissed')
        this.launches.delete(event.projectile);
  }

  draw(frame: BloodFrame): void {
    if (!this.enabled) return;
    const { renderTime: tick, fogVisible, elevation, water } = frame;
    this.history.expire(tick);
    const view = frame.screenViewport ?? frame.viewport;
    if (
      this.revision !== this.history.revision ||
      this.elevation !== elevation ||
      this.water !== water ||
      !sameView(this.view, view)
    ) {
      this.reconcile(frame, view);
      this.revision = this.history.revision;
      this.view = { ...view };
      this.elevation = elevation;
      this.water = water;
    }
    this.deposit(tick);
    this.ground?.draw(tick);
    this.surfaces.draw(tick);
    for (const [mark, node] of this.nodes) {
      const age = tick - mark.spawnTick;
      if (age >= BLOOD_AIR_TICKS) {
        node.container.destroy({ children: true });
        this.nodes.delete(mark);
        continue;
      }
      node.container.visible =
        fogVisible === undefined || fogVisible((mark.hx - rowStagger(mark.hy / 2)) / 2, mark.hy / 2);
      this.animate(node, age);
    }
  }

  private reconcile(frame: BloodFrame, view: Viewport): void {
    this.history.query(view, frame.elevation.maxLift, this.candidates);
    this.nextVisible.length = 0;
    for (const mark of this.candidates) {
      const place = this.place(mark, frame);
      if (isVisible(view, place.x, place.y, 80)) this.nextVisible.push(mark);
    }
    const rebuild =
      this.elevation !== frame.elevation ||
      this.water !== frame.water ||
      this.nextVisible.length !== this.visible.length ||
      this.nextVisible.some((mark, i) => this.visible[i] !== mark);
    this.seenAir.clear();
    let preparedSurfaces = false;
    if (rebuild) this.ground?.begin();
    for (const mark of this.nextVisible) {
      const place = this.places.get(mark);
      if (place === undefined) continue;
      const airborne = frame.renderTime - mark.spawnTick < BLOOD_AIR_TICKS;
      if (place.surface >= 1 && !airborne) continue;
      if (place.rise === undefined) {
        const bounds = frame.drawn?.boundsOf(mark.target);
        // Spray starts at the upper torso. Only the first exactly visible frame chooses its height.
        place.rise =
          bounds === undefined ? 20 : Math.max(5, Math.min(34, (bounds.maxY - bounds.minY) * 0.62));
      }
      this.textures ??= new BloodTextures();
      if (place.surface < 1 && this.ground === undefined) {
        this.ground = new BloodGround(this.textures);
        this.groundContainer.addChild(this.ground.mesh);
        this.ground.begin();
      }
      let motions: readonly BloodDrop[] | undefined;
      if (airborne && place.contacts === undefined) {
        motions = bloodDrops(mark, place.rise);
        const watched =
          frame.fogVisible === undefined ||
          frame.fogVisible((mark.hx - rowStagger(mark.hy / 2)) / 2, mark.hy / 2);
        if (watched) {
          if (!preparedSurfaces) {
            this.surfaces.prepare(
              this.groundSurfaces === undefined
                ? [this.spriteLayer]
                : [this.groundSurfaces, this.spriteLayer],
            );
            preparedSurfaces = true;
          }
          place.contacts = motions.map((drop) => this.surfaces.trace(drop, place.x, place.y, place.baseY));
          if (place.contacts.some((contact) => contact !== undefined))
            this.pending.set(mark, { contacts: place.contacts, delivered: 0 });
        } else place.contacts = [];
      }
      const drops = rebuild
        ? this.ground?.add(mark, place.x, place.y, place.surface, place.rise, place.contacts)
        : undefined;
      if (!airborne) continue;
      let node = this.nodes.get(mark);
      if (node === undefined) {
        node = this.makeAir(mark, place, motions ?? drops ?? bloodDrops(mark, place.rise), this.textures);
        this.nodes.set(mark, node);
      }
      node.container.position.set(place.x, place.y);
      this.seenAir.add(mark);
    }
    if (rebuild) this.ground?.finish();
    const previous = this.visible;
    this.visible = this.nextVisible;
    this.nextVisible = previous;
    for (const [mark, node] of this.nodes) {
      if (this.seenAir.has(mark)) continue;
      node.container.destroy({ children: true });
      this.nodes.delete(mark);
    }
  }

  private place(mark: BloodMark, frame: BloodFrame): Place {
    let place = this.places.get(mark);
    if (place === undefined) {
      const baseY = (mark.hy * TILE_HALF_H) / 2;
      place = {
        x: mark.hx * TILE_HALF_W,
        baseY,
        rise: undefined,
        elevation: frame.elevation,
        y: baseY - terrainLiftAtNode(frame.elevation, mark.hx, mark.hy),
        water: frame.water,
        surface: frame.water.surface(mark.hx, mark.hy),
      };
      this.places.set(mark, place);
    }
    if (place.elevation !== frame.elevation) {
      place.elevation = frame.elevation;
      place.y = place.baseY - terrainLiftAtNode(frame.elevation, mark.hx, mark.hy);
    }
    if (place.water !== frame.water) {
      place.water = frame.water;
      place.surface = frame.water.surface(mark.hx, mark.hy);
    }
    return place;
  }

  private makeAir(
    mark: BloodMark,
    place: Place,
    motions: readonly BloodDrop[],
    textures: BloodTextures,
  ): AirNode {
    const container = this.spriteLayer.addChild(new Container());
    container.zIndex = screenDepth(place.x, place.baseY, 'settler') + 0.125;
    const jet = container.addChild(worldBatched(new Sprite(textures.stain(mark.seed + 3))));
    jet.anchor.set(0.1, 0.5);
    jet.position.set(0, -(place.rise ?? 20));
    jet.rotation = Math.atan2(Math.sin(mark.heading) * GROUND_SQUASH, Math.cos(mark.heading));
    const drops = motions.map((motion, i) => {
      const sprite = container.addChild(worldBatched(new Sprite(textures.drop)));
      sprite.anchor.set(0.5);
      return { motion, sprite, contact: place.contacts?.[i] };
    });
    return {
      container,
      jet,
      drops,
      strength: (mark.profile === 'blunt' ? 0.5 : 0.85) * Math.sqrt(mark.amount),
    };
  }

  private deposit(tick: number): void {
    if (this.pending.size === 0) return;
    const due: { contact: SurfaceContact; tick: number }[] = [];
    for (const [mark, plan] of this.pending) {
      let waiting = false;
      for (let i = 0; i < plan.contacts.length; i++) {
        const contact = plan.contacts[i];
        if (contact === undefined || (plan.delivered & (1 << i)) !== 0) continue;
        if (tick < mark.spawnTick + contact.age) {
          waiting = true;
          continue;
        }
        due.push({ contact, tick: mark.spawnTick + contact.age });
        plan.delivered |= 1 << i;
      }
      if (!waiting) this.pending.delete(mark);
    }
    // A skipped frame may deliver several interleaved bursts at once. Patch growth, ageing and
    // eviction must follow impact time, not emitter or droplet enumeration order.
    due.sort((a, b) => a.tick - b.tick);
    for (const impact of due) this.surfaces.stamp(impact.contact, impact.tick);
  }

  private animate(node: AirNode, age: number): void {
    const spread = smoothUnit(age / 3);
    node.jet.alpha = 1 - smoothUnit(age / 5);
    node.jet.scale.set(node.strength * (0.25 + spread * 0.7), node.strength * (0.23 + spread * 0.2));
    for (const { motion, sprite, contact } of node.drops) {
      bloodDroplet(motion, age, this.pose);
      sprite.visible = this.pose.visible && !this.pose.landed && (contact === undefined || age < contact.age);
      sprite.position.set(this.pose.x, this.pose.y);
      sprite.rotation = this.pose.angle;
      sprite.scale.set((motion.size * this.pose.stretch) / 4, motion.size / 4);
    }
  }

  destroy(): void {
    this.setEnabled(false);
    this.ground?.destroy();
    this.ground = undefined;
    this.groundContainer.destroy();
    this.textures?.destroy();
    this.textures = undefined;
  }
}

function sameView(a: Viewport | undefined, b: Viewport): boolean {
  return a !== undefined && a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}
