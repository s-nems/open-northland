import type { SimEvent } from '@open-northland/sim';
import { Container, Graphics, type Sprite } from 'pixi.js';
import {
  type BuildingCollapse,
  COLLAPSE_LIFETIME_TICKS,
  collapseDustPuff,
  collapseKey,
  collapseProgress,
  DUST_PUFFS,
  foldBuildingCollapses,
} from '../../data/effects/index.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { type DrawItem, screenDepth } from '../../data/scene/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { type ResolvedLayer, resolveLayers } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { mintLayerSprite } from './layer-sprite.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * A razed building sinks into the ground instead of blinking out: the body is re-resolved from the
 * `buildingDestroyed` event's building type (the entity left the snapshot the same tick), then shifted
 * down while its lowest pixel rows are cropped at the ground line - the original's
 * `PrintBob_UsingCollapseTimeMask`. Cast-shadow layers are skipped, because a sinking body's ground
 * shadow would crop nonsensically.
 */
export class CollapseLayer {
  /** One node per live collapse, keyed by {@link collapseKey}. */
  private readonly nodes = new Map<string, CollapseNode>();
  private readonly seen = new Set<string>();
  private collapses: BuildingCollapse[] = [];

  constructor(
    /** Depth-sorted sprite layer - collapse nodes interleave with live sprites. */
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** Undefined draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  ingest(events: readonly SimEvent[], tick: number): void {
    this.collapses = foldBuildingCollapses(this.collapses, events, tick);
  }

  /** `tick` is interpolated render time, so the sink stays smooth at any frame rate. */
  draw(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.seen.clear();
    for (const c of this.collapses) {
      const age = tick - c.spawnTick;
      if (age >= COLLAPSE_LIFETIME_TICKS) continue; // body sunk and dust settled - retired below
      const key = collapseKey(c);
      const p = projectNode(elevation, c.hx, c.hy);
      let node = this.nodes.get(key);
      if (!isVisible(viewport, p.x, p.y)) {
        retainOffscreen(node, key, this.seen);
        continue;
      }
      if (node === undefined) {
        const minted = this.makeNode(c);
        if (minted === null) continue; // no sheet or no resolvable frames
        node = minted;
        this.spriteLayer.addChild(node);
        this.nodes.set(key, node);
      }
      node.visible = true;
      node.position.set(p.x, p.y);
      node.zIndex = screenDepth(p.x, p.y, 'building');
      this.sinkTo(node, collapseProgress(c, tick));
      poseDust(node, c.entity, age);
      this.seen.add(key);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy({ children: true }));
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy({ children: true });
    this.nodes.clear();
  }

  /** Mints the body's layer sprites, dust last so it covers their crop edge; null when nothing resolves. */
  private makeNode(c: BuildingCollapse): CollapseNode | null {
    // `builtPct` rides along so an unfinished site sinks its construction-stage body.
    const item: DrawItem = {
      kind: 'building',
      ref: c.entity,
      x: 0,
      y: 0,
      depth: 0,
      typeId: c.typeId,
      ...(c.builtPct !== undefined ? { builtPct: c.builtPct } : {}),
    };
    const layers = resolveLayers(this.sheet, item, 0);
    if (layers === null || layers.length === 0) return null;
    const node = new Container() as CollapseNode;
    let minX = Infinity;
    let maxX = -Infinity;
    let baseY = -Infinity;
    for (const layer of layers) {
      if (layer.shadow === true) continue;
      const spr = mintLayerSprite(this.textures, layer);
      (spr as CollapseSprite).collapseLayer = layer;
      node.addChild(spr);
      minX = Math.min(minX, layer.frame.offsetX * layer.scale);
      maxX = Math.max(maxX, (layer.frame.offsetX + layer.frame.width) * layer.scale);
      baseY = Math.max(baseY, (layer.frame.offsetY + layer.frame.height) * layer.scale);
    }
    if (node.children.length === 0) {
      node.destroy();
      return null;
    }
    const dust = new Container();
    for (let i = 0; i < DUST_PUFFS; i++) {
      dust.addChild(new Graphics().circle(0, 0, 1).fill({ color: DUST_COLOUR }));
    }
    dust.position.set((minX + maxX) / 2, baseY);
    node.addChild(dust);
    node.dust = dust;
    node.dustHalfWidth = (maxX - minX) / 2;
    return node;
  }

  /** Hides the bottom `progress · height` rows and shifts the remainder down by the same amount, so the
   *  body's bottom edge stays pinned at the ground line. */
  private sinkTo(node: Container, progress: number): void {
    for (const child of node.children) {
      const spr = child as CollapseSprite;
      const layer = spr.collapseLayer;
      if (layer === undefined) continue;
      const hiddenBottom = Math.round(progress * layer.frame.height);
      if (hiddenBottom >= layer.frame.height) {
        spr.visible = false;
        continue;
      }
      spr.texture = this.textures.croppedBottom(layer.source, layer.frame, hiddenBottom);
      spr.position.set(layer.frame.offsetX * layer.scale, (layer.frame.offsetY + hiddenBottom) * layer.scale);
    }
  }
}

/** Warm grey, a shade off the damage smoke so debris reads distinct from fire smoke. */
const DUST_COLOUR = 0x9b9186;

function poseDust(node: CollapseNode, seed: number, age: number): void {
  const dust = node.dust;
  if (dust === undefined) return;
  const halfWidth = node.dustHalfWidth ?? 0;
  for (let i = 0; i < dust.children.length; i++) {
    const puff = dust.children[i] as Graphics;
    const pose = collapseDustPuff(seed, i, age, halfWidth);
    puff.position.set(pose.x, pose.y);
    puff.scale.set(pose.radius);
    puff.alpha = pose.alpha;
  }
}

interface CollapseNode extends Container {
  dust?: Container;
  dustHalfWidth?: number;
}

interface CollapseSprite extends Sprite {
  collapseLayer?: ResolvedLayer;
}
