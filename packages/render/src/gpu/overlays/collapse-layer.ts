import type { SimEvent } from '@open-northland/sim';
import { Container, Graphics, Sprite } from 'pixi.js';
import {
  type BuildingCollapse,
  COLLAPSE_LIFETIME_TICKS,
  collapseDustPuff,
  collapseKey,
  collapseProgress,
  DUST_PUFFS,
  foldBuildingCollapses,
} from '../../data/effects/index.js';
import { depthKey, isVisible, type Viewport } from '../../data/projection/index.js';
import type { DrawItem } from '../../data/scene/index.js';
import { paintOrderBias } from '../../data/scene/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { type ResolvedLayer, resolveLayers, SCREEN_PAINT_EPS } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * The building-collapse transient — a razed/demolished building sinks into the ground instead of
 * blinking out: on `buildingDestroyed` the body is re-resolved from the event's `buildingType` (the
 * entity left the snapshot the same tick) and drawn for {@link import('../../data/effects/collapse.js')}'s
 * sink window with its graphic shifted DOWN while its lowest pixel rows are clipped at the ground line
 * ({@link TextureCache.croppedBottom} — the mirror of the construction rise; the original's
 * `PrintBob_UsingCollapseTimeMask`). A dense dust cloud churns along the ground line the whole while —
 * it hides the hard crop edge, so the body reads as sinking INTO the dust — and settles for a few ticks
 * after the body is gone ({@link collapseDustPuff}). Retained like the combat-effects layer: one node
 * per collapse, minted once, then only re-cropped/re-positioned/culled; nodes join the depth-sorted
 * sprite layer so fighters still occlude correctly around the falling body. Cast-shadow layers are
 * skipped — a sinking body's ground shadow would crop nonsensically, and the shadow vanishing at the
 * first crack reads fine.
 */
export class CollapseLayer {
  /** One retained node per live collapse, keyed by {@link collapseKey}. */
  private readonly nodes = new Map<string, Container>();
  /** Reused per-frame scratch of keys drawn this frame. */
  private readonly seen = new Set<string>();
  private collapses: BuildingCollapse[] = [];

  constructor(
    /** The renderer's depth-sorted sprite layer — collapse nodes interleave with live sprites. */
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** The session's resolved sprite sheet (immutable, like the pool's) — undefined draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /** Fold this frame's events into the live collapse list — see {@link foldBuildingCollapses}. */
  ingest(events: readonly SimEvent[], tick: number): void {
    this.collapses = foldBuildingCollapses(this.collapses, events, tick);
  }

  /** Advance every live collapse: crop/sink its sprites by the tick's progress, churn the ground dust,
   *  cull off-screen ones, retire the settled. `tick` is interpolated render time so the sink is smooth
   *  at any frame rate. */
  draw(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.seen.clear();
    for (const c of this.collapses) {
      const age = tick - c.spawnTick;
      if (age >= COLLAPSE_LIFETIME_TICKS) continue; // body sunk and dust settled — retired below
      const key = collapseKey(c);
      const p = projectNode(elevation, c.hx, c.hy);
      let node = this.nodes.get(key);
      if (!isVisible(viewport, p.x, p.y)) {
        retainOffscreen(node, key, this.seen);
        continue;
      }
      if (node === undefined) {
        const minted = this.makeNode(c);
        if (minted === null) continue; // nothing resolvable to draw (no sheet / no frames) — skip silently
        node = minted;
        this.spriteLayer.addChild(node);
        this.nodes.set(key, node);
      }
      node.visible = true;
      node.position.set(p.x, p.y);
      node.zIndex = depthKey(p.x, p.y) + paintOrderBias('building') * SCREEN_PAINT_EPS;
      this.sinkTo(node, collapseProgress(c, tick));
      poseDust(node as CollapseNode, c.entity, age);
      this.seen.add(key);
    }
    retireUndrawn(this.nodes, this.seen, (node) => node.destroy({ children: true }));
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy({ children: true });
    this.nodes.clear();
  }

  /** Mint a collapse node: the building body's resolved atlas layers (finished state, shadows skipped),
   *  each a child Sprite carrying its {@link ResolvedLayer} for the per-frame crop, topped with the
   *  ground-line dust cloud (drawn last, so it covers the sprites' crop edge). */
  private makeNode(c: BuildingCollapse): Container | null {
    // A minimal finished-building item: no builtPct/upgradePct, so the body (not a stage stack) resolves.
    const item: DrawItem = { kind: 'building', ref: c.entity, x: 0, y: 0, depth: 0, typeId: c.typeId };
    const layers = resolveLayers(this.sheet, item, 0);
    if (layers === null || layers.length === 0) return null;
    const node = new Container() as CollapseNode;
    let minX = Infinity;
    let maxX = -Infinity;
    let baseY = -Infinity;
    for (const layer of layers) {
      if (layer.shadow === true) continue;
      const spr = new Sprite(this.textures.get(layer.source, layer.frame));
      spr.position.set(layer.frame.offsetX * layer.scale, layer.frame.offsetY * layer.scale);
      spr.scale.set(layer.scale);
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

  /** Re-crop/re-place a node's sprites for `progress`: hide the bottom `progress · height` rows and shift
   *  the remainder down by the same amount, so the bottom edge stays pinned at the ground line. */
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

/** The warm grey of collapse dust — a shade off the damage smoke, so debris reads distinct from fire smoke. */
const DUST_COLOUR = 0x9b9186;

/** Pose the node's dust cloud for this frame: every puff churned by {@link collapseDustPuff} around the
 *  cloud container sitting at the body's base-line center. */
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

/** A collapse node with its dust-cloud container and the body's half-width riding along for the churn. */
interface CollapseNode extends Container {
  dust?: Container;
  dustHalfWidth?: number;
}

/** A collapse node's child sprite with its resolved layer riding along for the per-frame crop. */
interface CollapseSprite extends Sprite {
  collapseLayer?: ResolvedLayer;
}
