import type { SimEvent } from '@open-northland/sim';
import { Container } from 'pixi.js';
import {
  foldShipSinkings,
  type ShipSinking,
  SINKING_LIFETIME_TICKS,
  sinkProgress,
  sinkSmokeAlpha,
} from '../../data/effects/index.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  isVisible,
  snapToDevicePixels,
  type Viewport,
} from '../../data/projection/index.js';
import type { WindSway } from '../../data/weather/climate.js';
import type { DamageEffectTextures } from '../building-damage/effect-textures.js';
import { DamageEffects, type DamageOrigin, SHIP_DAMAGE_STYLE } from '../building-damage/effects.js';
import {
  emptyHullBox,
  type HullBox,
  hullBoxOf,
  placeDeckFires,
  type ShipBody,
} from '../building-damage/ship-damage.js';
import { MAX_DAMAGE_LEVEL } from '../building-damage/surface.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import type { PaletteLut } from '../textures/sprite-sheet.js';

/** A ship as the pool last drew it, handed over on the tick it is destroyed. */
export interface SinkingHull {
  /** The feet anchor in world px and the depth it sorted at. */
  readonly x: number;
  readonly y: number;
  readonly zIndex: number;
  readonly lut: PaletteLut;
  /** The live layers, whose hull meshes are copied before the pool frees them. */
  readonly sprites: ShipBody['sprites'];
  readonly damageSeed: number;
}

export interface ShipSinkFrame {
  readonly camera: Camera;
  readonly screenW: number;
  readonly screenH: number;
  readonly snapResolution?: number;
  readonly viewport: Viewport;
  /** Interpolated sim time, so the dive is smooth, pausable and reproducible. */
  readonly tick: number;
  readonly wind?: WindSway;
  readonly zoom: number;
}

/** The hull goes this far past its own height, so its top row clears the waterline. */
const SUBMERGE_MARGIN_PX = 4;
/** The roll a hull takes on as it goes down, in px of x per px of y. Tuned by eye. */
const SINK_LIST = 0.16;
/** World px a hull's art and smoke reach past its feet, for the cull. */
const CULL_MARGIN_PX = 260;
/** How fast the waves along a sinking hull's waterline roll. Tuned by eye. */
const WAVE_RADIANS_PER_TICK = 0.45;
/** Turns after which the shader's two swells (the second at 0.6 of the phase) both repeat. */
const WAVE_PHASE_TURNS = 5;
const NO_GROUND: readonly never[] = [];

interface SinkNode {
  /** At the hull's feet anchor in world px. */
  display: Container;
  hulls: { mesh: PalettedSprite; dy: number; shear: number }[];
  effects: DamageEffects;
  origins: DamageOrigin[];
  box: HullBox;
  list: number;
  damageSeed: number;
}

/**
 * A destroyed ship's transient: its last drawn hull burns and slides straight down under its own
 * waterline. The nodes live inside the depth-sorted sprite layer, so the shore and other ships still
 * occlude around them. A ship destroyed off screen leaves nothing.
 */
export class ShipSinkLayer {
  private sinkings: readonly ShipSinking[] = [];
  private readonly nodes = new Map<ShipSinking, SinkNode>();

  constructor(
    private readonly spriteLayer: Container,
    private readonly capture: (ref: number) => SinkingHull | undefined,
    private readonly art: () => DamageEffectTextures,
  ) {}

  ingest(events: readonly SimEvent[], tick: number): void {
    const next = foldShipSinkings(this.sinkings, events, tick);
    if (next === this.sinkings) return;
    this.sinkings = next;
    for (const sinking of next) {
      if (sinking.spawnTick !== tick || this.nodes.has(sinking)) continue;
      const hull = this.capture(sinking.entity);
      if (hull !== undefined) this.mint(sinking, hull);
    }
    for (const [sinking, node] of this.nodes) {
      if (next.includes(sinking)) continue;
      destroyNode(node);
      this.nodes.delete(sinking);
    }
  }

  draw(frame: ShipSinkFrame): void {
    for (const [sinking, node] of this.nodes) {
      const age = frame.tick - sinking.spawnTick;
      const display = node.display;
      display.visible =
        age < SINKING_LIFETIME_TICKS && isVisible(frame.viewport, display.x, display.y, CULL_MARGIN_PX);
      if (!display.visible) continue;
      const progress = sinkProgress(age);
      const sink = progress * (node.box.height + SUBMERGE_MARGIN_PX);
      const waterline = node.box.top + node.box.height;
      for (const hull of node.hulls) {
        const { mesh } = hull;
        mesh.visible = progress < 1;
        mesh.artDy = hull.dy + sink;
        mesh.shear = hull.shear + node.list * progress;
        mesh.setDamage(
          1,
          node.damageSeed,
          (waterline - mesh.artDy) / mesh.artScale,
          (frame.tick * WAVE_RADIANS_PER_TICK) % (Math.PI * 2 * WAVE_PHASE_TURNS),
        );
      }
      placeDeckFires(node.origins, node.box, sink);
      node.effects.container.alpha = sinkSmokeAlpha(age);
      node.effects.draw(node.origins, 0, MAX_DAMAGE_LEVEL, frame.tick, frame.wind, frame.zoom, NO_GROUND);
    }
    this.place(frame.camera, frame.screenW, frame.screenH, frame.snapResolution);
  }

  /** Place the self-placing hull meshes for a camera and target size, as the pool places a live ship's. */
  place(camera: Camera, resWidth: number, resHeight: number, snap: number | undefined): void {
    const camScale = camera.scale ?? 1;
    for (const node of this.nodes.values()) {
      if (!node.display.visible) continue;
      const originX = snapToDevicePixels(cameraScreenX(camera, node.display.x), snap);
      const originY = snapToDevicePixels(cameraScreenY(camera, node.display.y), snap);
      for (const { mesh } of node.hulls) {
        mesh.place(
          originX + mesh.artDx * camScale,
          originY + mesh.artDy * camScale,
          camScale * mesh.artScale,
          resWidth,
          resHeight,
        );
      }
    }
  }

  destroy(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
  }

  private mint(sinking: ShipSinking, hull: SinkingHull): void {
    const box = emptyHullBox();
    if (!hullBoxOf(hull.sprites, box)) return;
    const display = new Container();
    const hulls: SinkNode['hulls'] = [];
    for (const live of hull.sprites) {
      if (!(live instanceof PalettedSprite) || !live.visible) continue;
      const mesh = new PalettedSprite(hull.lut.source, hull.lut.colours);
      mesh.copyLook(live);
      hulls.push({ mesh, dy: mesh.artDy, shear: mesh.shear });
      display.addChild(mesh);
    }
    const effects = new DamageEffects(this.art(), sinking.entity, SHIP_DAMAGE_STYLE);
    effects.hit(sinking.spawnTick);
    display.addChild(effects.container);
    display.position.set(hull.x, hull.y);
    display.zIndex = hull.zIndex;
    this.spriteLayer.addChild(display);
    this.nodes.set(sinking, {
      display,
      hulls,
      effects,
      origins: [],
      box,
      // The side it lists to is the entity's own, steady through the dive.
      list: sinking.entity % 2 === 0 ? SINK_LIST : -SINK_LIST,
      damageSeed: hull.damageSeed,
    });
  }
}

function destroyNode(node: SinkNode): void {
  node.effects.destroy();
  node.display.destroy({ children: true });
}
