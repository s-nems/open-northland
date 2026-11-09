import {
  entityById,
  type Fixed,
  hexDistanceBetween,
  nodeOfPosition,
  type WorldSnapshot,
} from '@open-northland/sim';
import { Container, Sprite } from 'pixi.js';
import {
  type FootfallGround,
  type FootfallKind,
  footfallAt,
  MAX_STEP_NODES,
  PRINT_SHOWN_TICKS,
  printAlpha,
  stepHeadingDegrees,
  stepValency,
} from '../../data/effects/index.js';
import { halfCellToScreen, isVisible, type Viewport } from '../../data/projection/index.js';
import { screenDepth } from '../../data/scene/index.js';
import { readPosition } from '../../data/snapshot/index.js';
import { type ParticleRef, particleFrame } from '../../data/sprites/index.js';
import { type ElevationField, terrainLiftAtNode } from '../../data/terrain/index.js';
import type { DrawnWalker } from '../sprite-pool/index.js';
import { layeredLayerFor } from '../sprite-pool/layers/layered.js';
import type { SpriteSheet } from '../textures/sprite-sheet.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { worldBatched } from '../world-batch/batcher.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/** One frame's inputs: the pool's drawn walkers and the clock and cull box the marks draw by. */
export interface FootfallFrame {
  readonly snapshot: WorldSnapshot;
  readonly walkers: readonly DrawnWalker[];
  /** Whether a road runs over a node: a step onto one leaves nothing. */
  readonly roadAt: (hx: number, hy: number) => boolean;
  readonly elevation: ElevationField;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

interface Footfall {
  readonly key: number;
  readonly kind: FootfallKind;
  readonly hx: number;
  readonly hy: number;
  readonly valency: number;
  readonly tick: number;
}

/**
 * The prints and dust the drawn walkers leave as they step from node to node (`data/effects/footfall.ts`).
 * Prints lie in a ground container under the fog and every sprite, as the original draws them first; the
 * dust rises in the depth-sorted sprite layer at the step's node. A step is seen by comparing each drawn
 * walker's node across snapshots, so the work follows the walkers on screen; one off screen leaves none.
 * Original behavior: a step onto a road leaves nothing.
 *
 * Original behavior: the dust plays its frames once, a tick each, from the node it was raised on. Its
 * slow drift and five-unit start height are left out (approximation).
 */
export class FootfallLayer {
  readonly container = new Container();
  private ground: FootfallGround | null = null;
  private readonly lastNode = new Map<number, { hx: number; hy: number }>();
  private readonly walking = new Set<number>();
  private marks: Footfall[] = [];
  private nextKey = 0;
  private lastSnapshot: WorldSnapshot | undefined;
  private readonly nodes = new Map<number, Sprite>();
  private readonly seen = new Set<number>();

  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** Undefined, or a sheet with no footfall binding, draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /** The map's footfall per cell; `null` leaves every step without a mark. */
  setGround(ground: FootfallGround | null): void {
    this.ground = ground;
    this.lastNode.clear();
    this.marks = [];
  }

  draw(frame: FootfallFrame): void {
    this.seen.clear();
    const binding = this.sheet?.bindings.footfall;
    if (binding !== undefined && this.ground !== null) {
      this.track(frame, this.ground);
      for (const mark of this.marks) {
        const ref = binding[mark.kind];
        if (ref !== undefined) this.place(mark, ref, frame);
      }
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy());
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy();
    this.nodes.clear();
    this.container.destroy({ children: true });
  }

  /** Raise a mark for every drawn walker that reached a new node since the last snapshot, and drop the
   *  marks that are gone. */
  private track(frame: FootfallFrame, ground: FootfallGround): void {
    const snapshot = frame.snapshot;
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    const tick = snapshot.tick;
    this.marks = this.marks.filter((m) => tick - m.tick < lifeOf(m, this.sheet));
    this.walking.clear();
    for (const { ref } of frame.walkers) {
      const components = entityById(snapshot, ref)?.components;
      if (components === undefined || !('Person' in components)) continue;
      const position = readPosition(components);
      if (position === null) continue;
      const node = nodeOfPosition(position.x as Fixed, position.y as Fixed);
      this.walking.add(ref);
      const last = this.lastNode.get(ref);
      this.lastNode.set(ref, node);
      if (last === undefined || (last.hx === node.hx && last.hy === node.hy)) continue;
      if (hexDistanceBetween(last.hx, last.hy, node.hx, node.hy) > MAX_STEP_NODES) continue;
      if (frame.roadAt(node.hx, node.hy)) continue;
      const kind = footfallAt(ground, node.hx, node.hy);
      if (kind === undefined) continue;
      const count = this.sheet?.bindings.footfall?.[kind]?.valencies.length ?? 1;
      const degrees = stepHeadingDegrees(last.hx, last.hy, node.hx, node.hy);
      this.marks.push({
        key: this.nextKey++,
        kind,
        hx: node.hx,
        hy: node.hy,
        valency: stepValency(degrees, count),
        tick,
      });
    }
    for (const ref of this.lastNode.keys()) if (!this.walking.has(ref)) this.lastNode.delete(ref);
  }

  private place(mark: Footfall, ref: ParticleRef, frame: FootfallFrame): void {
    const age = frame.renderTime - mark.tick;
    const print = mark.kind !== 'dust';
    const alpha = print ? printAlpha(age) : 1;
    const bob = print ? particleFrame(ref, 0, mark.valency) : particleFrame(ref, age);
    if (alpha <= 0 || bob === undefined) return;
    const ground = halfCellToScreen(mark.hx, mark.hy);
    const x = ground.x;
    const y = ground.y - terrainLiftAtNode(frame.elevation, mark.hx, mark.hy);
    let node = this.nodes.get(mark.key);
    if (!isVisible(frame.viewport, x, y)) {
      retainOffscreen(node, mark.key, this.seen);
      return;
    }
    const sheet = this.sheet;
    const resolved =
      sheet === undefined ? null : layeredLayerFor(sheet, 'projectile', { layer: ref.layer, bob });
    if (resolved === null) return;
    if (node === undefined) {
      node = worldBatched(new Sprite());
      (print ? this.container : this.spriteLayer).addChild(node);
      this.nodes.set(mark.key, node);
    }
    node.texture = this.textures.get(resolved.source, resolved.frame);
    node.scale.set(resolved.scale);
    node.position.set(
      x + resolved.frame.offsetX * resolved.scale,
      y + resolved.frame.offsetY * resolved.scale,
    );
    if (!print) node.zIndex = screenDepth(ground.x, ground.y, 'projectile');
    node.alpha = alpha;
    node.visible = true;
    this.seen.add(mark.key);
  }
}

/** Ticks a mark stays: a print its shown life, the dust its frames once. */
function lifeOf(mark: Footfall, sheet: SpriteSheet | undefined): number {
  if (mark.kind !== 'dust') return PRINT_SHOWN_TICKS;
  return sheet?.bindings.footfall?.dust?.valencies[0]?.length ?? 0;
}
