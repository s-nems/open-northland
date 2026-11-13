import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import {
  ARC_DOTS,
  ARC_DRAW_SCALE,
  ARC_FRAME_PX,
  type ArcDot,
  arcDot,
  arcDotStrip,
} from '../../data/effects/amulet-arcs.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { SHADOW_DEPTH_EPS } from '../../data/scene/index.js';
import { readEquipmentMisc } from '../../data/scene/snapshot-readers/index.js';
import type { DrawnGeometry, DrawnWalker } from '../sprite-pool/index.js';
import { worldBatched } from '../world-batch/batcher.js';
import { retireUndrawn } from './retained-pool.js';

/** A wearer's arcs are a bit set of colours, so the strip holds at most this many. */
const MAX_ARC_COLOURS = 30;

interface ArcNode {
  /** {@link ARC_DOTS} sprites per arc, the arcs in rising colour order. */
  readonly sprites: Sprite[];
  /** The colours the sprites were dressed for, a bit each. */
  colours: number;
}

export interface AmuletArcFrame {
  readonly snapshot: WorldSnapshot;
  /** The drawn humans on the map ground, off the pool's culled draw list. */
  readonly walkers: readonly DrawnWalker[];
  readonly drawn: DrawnGeometry;
  readonly viewport: Viewport;
  /** Interpolated render clock, `tick + alpha`. */
  readonly renderTime: number;
}

/**
 * The arcs of light round each drawn human who carries an amulet the app gave a colour (see
 * `data/effects/amulet-arcs.ts`): one per colour carried, however many amulets share it. The sprites sit
 * in the depth-sorted sprite layer just over or under their wearer, so an arc passes behind the body and
 * whatever stands in front of the wearer covers it. They draw through the world batch off one strip, so
 * a company of wearers adds quads to the batch rather than breaking it.
 */
export class AmuletArcLayer {
  private colourOfGood: ReadonlyMap<number, number> | undefined;
  private source: BufferImageSource | undefined;
  private readonly textures: Texture[] = [];
  private readonly nodes = new Map<number, ArcNode>();
  private readonly seen = new Set<number>();
  private readonly dot: ArcDot = { x: 0, y: 0, scale: 1, alpha: 1, front: true };

  constructor(private readonly spriteLayer: Container) {}

  /** Good type → the colour (0xRRGGBB) of the arc a carrier of that good shows; `null` draws none. */
  setColours(colourOfGood: ReadonlyMap<number, number> | null): void {
    this.retireAll();
    this.dropTextures();
    this.colourOfGood = undefined;
    if (colourOfGood === null || colourOfGood.size === 0) return;
    const colours: number[] = [];
    const indexOfGood = new Map<number, number>();
    for (const [good, colour] of colourOfGood) {
      let index = colours.indexOf(colour);
      if (index === -1 && colours.length < MAX_ARC_COLOURS) index = colours.push(colour) - 1;
      if (index !== -1) indexOfGood.set(good, index);
    }
    const source = new BufferImageSource({
      resource: arcDotStrip(colours),
      width: ARC_FRAME_PX * colours.length,
      height: ARC_FRAME_PX,
      alphaMode: 'premultiplied-alpha',
      scaleMode: 'linear',
    });
    this.source = source;
    for (let i = 0; i < colours.length; i++)
      this.textures.push(
        new Texture({ source, frame: new Rectangle(i * ARC_FRAME_PX, 0, ARC_FRAME_PX, ARC_FRAME_PX) }),
      );
    this.colourOfGood = indexOfGood;
  }

  draw(frame: AmuletArcFrame): void {
    this.seen.clear();
    const colourOfGood = this.colourOfGood;
    if (colourOfGood !== undefined) {
      for (const walker of frame.walkers) {
        const ref = walker.ref;
        const worn = coloursWorn(frame.snapshot, ref, colourOfGood);
        if (worn === 0) continue;
        const feet = frame.drawn.anchorOf(ref);
        const depth = frame.drawn.depthOf?.(ref);
        if (feet === undefined || depth === undefined) continue;
        if (!isVisible(frame.viewport, feet.x, feet.y)) continue;
        this.place(this.nodeOf(ref, worn), ref, feet, depth, frame.renderTime);
        this.seen.add(ref);
      }
    }
    retireUndrawn(this.nodes, this.seen, destroyNode);
  }

  destroy(): void {
    this.retireAll();
    this.dropTextures();
  }

  private nodeOf(ref: number, worn: number): ArcNode {
    let node = this.nodes.get(ref);
    if (node === undefined) {
      node = { sprites: [], colours: 0 };
      this.nodes.set(ref, node);
    }
    if (node.colours === worn) return node;
    node.colours = worn;
    let used = 0;
    for (let colour = 0; colour < this.textures.length; colour++) {
      const texture = (worn & (1 << colour)) === 0 ? undefined : this.textures[colour];
      if (texture === undefined) continue;
      for (let dot = 0; dot < ARC_DOTS; dot++) {
        let sprite = node.sprites[used];
        if (sprite === undefined) {
          sprite = worldBatched(new Sprite());
          sprite.anchor.set(0.5);
          this.spriteLayer.addChild(sprite);
          node.sprites.push(sprite);
        }
        sprite.texture = texture;
        used++;
      }
    }
    for (const spare of node.sprites.splice(used)) spare.destroy();
    return node;
  }

  private place(
    node: ArcNode,
    ref: number,
    feet: { readonly x: number; readonly y: number },
    depth: number,
    renderTime: number,
  ): void {
    const dot = this.dot;
    const arcs = node.sprites.length / ARC_DOTS;
    for (let i = 0; i < node.sprites.length; i++) {
      const sprite = node.sprites[i];
      if (sprite === undefined) continue;
      arcDot(renderTime, ref, Math.trunc(i / ARC_DOTS), arcs, i % ARC_DOTS, dot);
      sprite.position.set(feet.x + dot.x, feet.y + dot.y);
      sprite.scale.set(dot.scale * ARC_DRAW_SCALE);
      sprite.alpha = dot.alpha;
      sprite.zIndex = dot.front ? depth + SHADOW_DEPTH_EPS : depth - SHADOW_DEPTH_EPS;
    }
  }

  private retireAll(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
  }

  private dropTextures(): void {
    for (const texture of this.textures) texture.destroy();
    this.textures.length = 0;
    this.source?.destroy();
    this.source = undefined;
  }
}

/** The colours of the amulets `ref` carries, a bit each; 0 for none. */
function coloursWorn(
  snapshot: WorldSnapshot,
  ref: number,
  colourOfGood: ReadonlyMap<number, number>,
): number {
  const components = entityById(snapshot, ref)?.components;
  const misc = components === undefined ? undefined : readEquipmentMisc(components);
  if (misc === undefined) return 0;
  let worn = 0;
  for (const slot of misc) {
    const good = slot?.goodType;
    const colour = typeof good === 'number' ? colourOfGood.get(good) : undefined;
    if (colour !== undefined) worn |= 1 << colour;
  }
  return worn;
}

function destroyNode(node: ArcNode): void {
  for (const sprite of node.sprites) sprite.destroy();
}
