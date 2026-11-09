import {
  entityById,
  type Fixed,
  hexDistanceBetween,
  nodeHxOfPosition,
  nodeHyOfPosition,
  ONE,
  positionXOfNode,
  positionYOfNode,
  type WorldSnapshot,
} from '@open-northland/sim';
import { Container, Sprite } from 'pixi.js';
import {
  DUST_SCALE,
  dustAlpha,
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
import { readPosition, readWearsLiveBoots } from '../../data/snapshot/index.js';
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

/** A tracked walker: its nearest node at the last sighting and the step it is finishing, if any. */
interface WalkerSteps {
  hx: number;
  hy: number;
  /** The node the step came from; the step's node is `hx, hy`. */
  fromHx: number;
  fromHy: number;
  stepping: boolean;
}

/** How near, per position axis, a walker counts as standing on the node it steps onto: an eighth of a
 *  column step. */
const ON_NODE_TOLERANCE = ONE / 16;

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
 * dust rises in the depth-sorted sprite layer. A step is seen by comparing each drawn walker's nearest
 * node across snapshots, so the work follows the walkers on screen; one off screen leaves none.
 *
 * Original behavior: a mark is raised on the node a human reaches, a road leaving nothing, and the dust
 * plays its frames once, a tick each. A human in live boots also kicks up dust on every step, on any
 * ground and road, whatever its age or tribe; on sand an adult so shod raises two. The dust's slow drift
 * and five-unit start height are left out (approximation).
 */
export class FootfallLayer {
  readonly container = new Container();
  private ground: FootfallGround | null = null;
  /** Each tracked walker's node at its last sighting, updated in place. */
  private readonly lastNode = new Map<number, WalkerSteps>();
  private readonly walking = new Set<number>();
  private readonly marks: Footfall[] = [];
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

  /** The map's footfall per cell; `null` leaves no step a mark of its ground. */
  setGround(ground: FootfallGround | null): void {
    this.ground = ground;
    this.lastNode.clear();
    this.marks.length = 0;
  }

  draw(frame: FootfallFrame): void {
    this.seen.clear();
    const binding = this.sheet?.bindings.footfall;
    if (binding !== undefined) {
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
   *  marks that are gone. A walker's nearest node turns at half a step, so the step is held until the
   *  walker stands on its node, or turns to the next one, and its mark falls under the foot. */
  private track(frame: FootfallFrame, ground: FootfallGround | null): void {
    const snapshot = frame.snapshot;
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    const tick = snapshot.tick;
    this.dropExpired(tick);
    this.walking.clear();
    for (const walker of frame.walkers) {
      const ref = walker.ref;
      const components = entityById(snapshot, ref)?.components;
      if (components === undefined || !('Person' in components)) continue;
      const position = readPosition(components);
      if (position === null) continue;
      const x = position.x as Fixed;
      const y = position.y as Fixed;
      const hx = nodeHxOfPosition(x, y);
      const hy = nodeHyOfPosition(x, y);
      this.walking.add(ref);
      const steps = this.lastNode.get(ref);
      if (steps === undefined) {
        this.lastNode.set(ref, { hx, hy, fromHx: hx, fromHy: hy, stepping: false });
        continue;
      }
      if (steps.hx !== hx || steps.hy !== hy) {
        if (steps.stepping) this.land(steps, walker.marksGround, components, frame, ground, tick);
        steps.stepping = hexDistanceBetween(steps.hx, steps.hy, hx, hy) <= MAX_STEP_NODES;
        steps.fromHx = steps.hx;
        steps.fromHy = steps.hy;
        steps.hx = hx;
        steps.hy = hy;
      }
      if (
        steps.stepping &&
        Math.abs(x - positionXOfNode(hx, hy)) <= ON_NODE_TOLERANCE &&
        Math.abs(y - positionYOfNode(hy)) <= ON_NODE_TOLERANCE
      )
        this.land(steps, walker.marksGround, components, frame, ground, tick);
    }
    for (const ref of this.lastNode.keys()) if (!this.walking.has(ref)) this.lastNode.delete(ref);
  }

  /** Mark the node a step lands on: the boots' dust, then the ground's print or dust. */
  private land(
    steps: WalkerSteps,
    marksGround: boolean,
    components: Readonly<Record<string, unknown>>,
    frame: FootfallFrame,
    ground: FootfallGround | null,
    tick: number,
  ): void {
    steps.stepping = false;
    const { fromHx, fromHy, hx, hy } = steps;
    if (readWearsLiveBoots(components)) this.raise('dust', hx, hy, 0, tick);
    if (!marksGround || frame.roadAt(hx, hy)) return;
    const kind = ground === null ? undefined : footfallAt(ground, hx, hy);
    if (kind === undefined) return;
    const count = this.sheet?.bindings.footfall?.[kind]?.valencies.length ?? 1;
    this.raise(kind, hx, hy, stepValency(stepHeadingDegrees(fromHx, fromHy, hx, hy), count), tick);
  }

  private raise(kind: FootfallKind, hx: number, hy: number, valency: number, tick: number): void {
    this.marks.push({ key: this.nextKey++, kind, hx, hy, valency, tick });
  }

  /** Drop the marks whose life is over, compacting the list in place. */
  private dropExpired(tick: number): void {
    let kept = 0;
    for (const mark of this.marks) if (tick - mark.tick < lifeOf(mark, this.sheet)) this.marks[kept++] = mark;
    this.marks.length = kept;
  }

  private place(mark: Footfall, ref: ParticleRef, frame: FootfallFrame): void {
    const age = frame.renderTime - mark.tick;
    const print = mark.kind !== 'dust';
    const alpha = print ? printAlpha(age) : dustAlpha(age, lifeOf(mark, this.sheet));
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
    const scale = print ? resolved.scale : resolved.scale * DUST_SCALE;
    node.scale.set(scale);
    node.position.set(x + resolved.frame.offsetX * scale, y + resolved.frame.offsetY * scale);
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
