import { entityById, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { type Container, Sprite } from 'pixi.js';
import {
  type Deflection,
  type DeflectionPose,
  Deflections,
  deflectionPose,
} from '../../data/effects/deflection.js';
import {
  halfCellToScreenX,
  halfCellToScreenY,
  isVisible,
  rowStagger,
  type Viewport,
} from '../../data/projection/index.js';
import { type ShotShape, screenDepth } from '../../data/scene/index.js';
import { readNumField } from '../../data/snapshot/index.js';
import { headingValency, particleFrame, valencyHeading } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import { layeredLayerFor } from '../sprite-pool/layers/layered.js';
import { setStretchedScale } from '../sprite-pool/layers/stretch.js';
import type { SpriteSheet } from '../textures/sprite-sheet.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';

/** One frame's inputs: the marks' cull box, render clock and fog. */
export interface DeflectionFrame {
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
  readonly fogVisible?: ((x: number, y: number) => boolean) | undefined;
}

/** How far past the cull box a blocked arrow still draws: its longest drawn shaft. */
const CULL_MARGIN_PX = 40;

/**
 * The arrows a shield blocked, each drawn with its munition's heading frame and its shooter's arrow shape
 * as it glances off (`data/effects/deflection.ts`). A sprite lives as long as its arrow, so the work
 * follows the live blocks, at most `MAX_DEFLECTIONS` of them.
 */
export class DeflectionLayer {
  private readonly deflections = new Deflections();
  private readonly nodes = new Map<Deflection, ArrowNode>();
  private revision = -1;
  private snapshot: WorldSnapshot | undefined;
  private readonly pose: DeflectionPose = { dx: 0, dy: 0, lift: 0, spin: 0, alpha: 1 };

  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** Undefined, or a sheet with no munition binding, draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  ingest(events: readonly SimEvent[], tick: number, snapshot?: WorldSnapshot): void {
    this.snapshot = snapshot;
    this.deflections.ingest(events, tick, this.shapeOf);
    this.snapshot = undefined;
  }

  /** The arrow shooter `shooter` looses, read off the snapshot being ingested. */
  private readonly shapeOf = (shooter: number): ShotShape | undefined => {
    const shapes = this.sheet?.shotShapes;
    if (shapes === undefined) return undefined;
    const settler = this.snapshot === undefined ? undefined : entityById(this.snapshot, shooter)?.components;
    if (settler === undefined) return shapes(undefined, undefined);
    return shapes(readNumField(settler, 'Settler', 'tribe'), readNumField(settler, 'Settler', 'jobType'));
  };

  draw(frame: DeflectionFrame): void {
    const { renderTime } = frame;
    this.deflections.expire(renderTime);
    const live = this.deflections.values;
    if (this.revision !== this.deflections.revision) {
      this.retire(live);
      this.revision = this.deflections.revision;
    }
    for (const d of live) this.drawOne(d, frame, Math.max(0, renderTime - d.spawnTick));
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.sprite.destroy();
    this.nodes.clear();
    this.deflections.clear();
  }

  private drawOne(d: Deflection, frame: DeflectionFrame, age: number): void {
    let node = this.nodes.get(d);
    deflectionPose(d, age, this.pose);
    const groundX = halfCellToScreenX(d.hx, d.hy) + this.pose.dx;
    const groundY = halfCellToScreenY(d.hy) + this.pose.dy;
    const y = groundY - terrainLiftAtNode(frame.elevation, d.hx, d.hy) - this.pose.lift;
    const watched =
      frame.fogVisible === undefined || frame.fogVisible((d.hx - rowStagger(d.hy / 2)) / 2, d.hy / 2);
    if (!watched || !isVisible(frame.viewport, groundX, y, CULL_MARGIN_PX)) {
      if (node !== undefined) node.sprite.visible = false;
      return;
    }
    node ??= this.mint(d);
    if (node === undefined) return;
    const { sprite } = node;
    sprite.position.set(groundX + node.middleX, y + node.middleY);
    sprite.rotation = this.pose.spin;
    sprite.alpha = this.pose.alpha;
    sprite.zIndex = screenDepth(groundX, groundY, 'projectile');
    sprite.visible = true;
  }

  /** The arrow's heading frame, stretched to its shape about its middle; undefined when unbound. */
  private mint(d: Deflection): ArrowNode | undefined {
    const sheet = this.sheet;
    const ref = sheet?.bindings.munition?.byMunition[d.munitionType];
    if (sheet === undefined || ref === undefined || sheet.families?.[ref.layer] === undefined)
      return undefined;
    const count = ref.valencies.length;
    const valency = ref.directional ? headingValency(d.heading, count) : 0;
    const bob = particleFrame(ref, 0, valency);
    const resolved =
      bob === undefined ? null : layeredLayerFor(sheet, 'projectile', { layer: ref.layer, bob });
    if (resolved === null) return undefined;
    const sprite = worldBatched(new Sprite(this.textures.get(resolved.source, resolved.frame)));
    sprite.anchor.set(0.5);
    if (ref.directional && d.shape !== undefined)
      setStretchedScale(sprite, resolved.scale, {
        along: valencyHeading(valency, count),
        by: d.shape.length,
        across: d.shape.thickness,
      });
    else sprite.scale.set(resolved.scale);
    this.spriteLayer.addChild(sprite);
    const { frame, scale } = resolved;
    const node = {
      sprite,
      middleX: (frame.offsetX + frame.width / 2) * scale,
      middleY: (frame.offsetY + frame.height / 2) * scale,
    };
    this.nodes.set(d, node);
    return node;
  }

  private retire(live: readonly Deflection[]): void {
    const kept = new Set(live);
    for (const [d, node] of this.nodes) {
      if (kept.has(d)) continue;
      node.sprite.destroy();
      this.nodes.delete(d);
    }
  }
}

interface ArrowNode {
  readonly sprite: Sprite;
  /** The frame's middle off the arrow's anchor: the point it spins about. */
  readonly middleX: number;
  readonly middleY: number;
}
