import type { SimEvent } from '@open-northland/sim';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
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
import { buildTimeThreshold } from '../../data/sprites/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import type { FallenBody } from '../building-damage/building-damage.js';
import { DamageEffectTextures } from '../building-damage/effect-textures.js';
import { markMagnifiedTexture } from '../pixel-art-registry.js';
import { createLayerDrawBox, layerDrawBox, type ResolvedLayer, resolveLayers } from '../sprite-pool/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { worldBatched } from '../world-batcher.js';
import { retainOffscreen, retireUndrawn } from './retained-pool.js';

/**
 * A razed building sinks into the ground instead of blinking out: the body is re-resolved from the
 * `buildingDestroyed` event's building type (the entity left the snapshot the same tick), then shifted
 * down while its lowest pixel rows are cropped at the ground line, as in the
 * original. An unfinished site sinks only what its construction reveal showed. Cast-shadow layers are
 * skipped, because a sinking body's ground shadow would crop nonsensically.
 */
export class CollapseLayer {
  /** One node per live collapse, keyed by {@link collapseKey}. */
  private readonly nodes = new Map<string, CollapseNode>();
  private readonly seen = new Set<string>();
  private collapses: BuildingCollapse[] = [];
  private readonly revealBox = createLayerDrawBox();
  private dustArt: DamageEffectTextures | undefined;
  private readonly fallen = new Map<string, readonly FallenBody[]>();

  constructor(
    /** Depth-sorted sprite layer - collapse nodes interleave with live sprites. */
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    /** Undefined draws nothing. */
    private readonly sheet: SpriteSheet | undefined,
    private readonly captureDamage?: (ref: number) => readonly FallenBody[] | undefined,
  ) {}

  ingest(events: readonly SimEvent[], tick: number): void {
    this.collapses = foldBuildingCollapses(this.collapses, events, tick);
    for (const c of this.collapses) {
      const key = collapseKey(c);
      if (c.spawnTick !== tick || this.fallen.has(key)) continue;
      const bodies = this.captureDamage?.(c.entity);
      if (bodies !== undefined) this.fallen.set(key, bodies);
    }
    for (const [key, bodies] of this.fallen) {
      if (this.collapses.some((c) => collapseKey(c) === key)) continue;
      for (const body of bodies) body.release();
      this.fallen.delete(key);
    }
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
    retireUndrawn(this.nodes, this.seen, destroyNode);
    for (const [key, bodies] of this.fallen) {
      const collapse = this.collapses.find((c) => collapseKey(c) === key);
      if (collapse !== undefined && tick - collapse.spawnTick < COLLAPSE_LIFETIME_TICKS) continue;
      for (const body of bodies) body.release();
      this.fallen.delete(key);
    }
  }

  destroy(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
    for (const bodies of this.fallen.values()) for (const body of bodies) body.release();
    this.fallen.clear();
    this.dustArt?.destroy();
  }

  /** Mints the body's layer sprites, dust last so it covers their crop edge; null when nothing resolves
   *  or the site had revealed nothing yet. */
  private makeNode(c: BuildingCollapse): CollapseNode | null {
    // `builtPct` rides along so an unfinished site sinks its construction-stage body.
    const item: DrawItem = {
      kind: 'building',
      ref: c.entity,
      x: 0,
      y: 0,
      depth: 0,
      typeId: c.typeId,
      tribe: c.tribe,
      ...(c.builtPct !== undefined ? { builtPct: c.builtPct } : {}),
    };
    const fallen = this.fallen.get(collapseKey(c));
    const layers: readonly ResolvedLayer[] | null =
      fallen === undefined
        ? resolveLayers(this.sheet, item, 0)
        : fallen.map((body) => ({
            source: body.texture.source,
            scale: body.scale,
            frame: {
              x: body.texture.frame.x,
              y: body.texture.frame.y,
              width: body.texture.frame.width,
              height: body.texture.frame.height,
              offsetX: body.x / body.scale,
              offsetY: body.y / body.scale,
            },
          }));
    if (layers === null || layers.length === 0) return null;
    const node = new Container() as CollapseNode;
    let minX = Infinity;
    let maxX = -Infinity;
    let baseY = -Infinity;
    for (const [i, layer] of layers.entries()) {
      // The collapse draws the plain body; the ground's shade and cover would copy it.
      if (layer.shadow === true || layer.groundFoot === 'cover') continue;
      const body = this.revealedBody(layer);
      if (body === null) continue;
      const spr = worldBatched(new Sprite(body.view)) as CollapseSprite;
      spr.scale.set(layer.scale);
      spr.alpha = fallen?.[i]?.alpha ?? 1;
      spr.collapseBody = body;
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
    this.dustArt ??= new DamageEffectTextures(false);
    for (let i = 0; i < DUST_PUFFS; i++) {
      const puff = worldBatched(new Sprite(this.dustArt.smoke[i % 4] ?? Texture.EMPTY));
      puff.anchor.set(0.5);
      puff.tint = DUST_COLOUR;
      dust.addChild(puff);
    }
    dust.position.set((minX + maxX) / 2, baseY);
    node.addChild(dust);
    node.dust = dust;
    node.dustHalfWidth = (maxX - minX) / 2;
    return node;
  }

  /**
   * The layer as the live site last drew it, frozen at destruction: the per-pixel reveal baked from its
   * time sheet, or the bottom-up crop without one. Null when the crop has revealed nothing.
   */
  private revealedBody(layer: ResolvedLayer): CollapseBody | null {
    const { frame } = layer;
    const bake =
      layer.reveal !== undefined && layer.times !== undefined && layer.revealWindow !== undefined
        ? this.textures.bakeReveal(
            layer.source,
            frame,
            layer.times,
            buildTimeThreshold(layer.reveal, layer.revealWindow[0], layer.revealWindow[1]),
          )
        : null;
    const box = this.revealBox;
    layerDrawBox(box, layer, layer.reveal, bake !== null);
    const hiddenTop = box.hiddenTop;
    if (hiddenTop >= frame.height) return null;
    const rows = new Rectangle(0, hiddenTop, frame.width, frame.height - hiddenTop);
    if (bake === null) {
      rows.x += frame.x;
      rows.y += frame.y;
    }
    const view = new Texture({ source: bake?.source ?? layer.source, frame: rows, dynamic: true });
    markMagnifiedTexture(view, layer.source);
    return { layer, view, hiddenTop, ...(bake !== null ? { bake } : {}) };
  }

  /** Hides the bottom `progress · height` rows and shifts the remainder down by the same amount, so the
   *  body's bottom edge stays pinned at the ground line. */
  private sinkTo(node: Container, progress: number): void {
    for (const child of node.children) {
      const body = (child as CollapseSprite).collapseBody;
      if (body === undefined) continue;
      const { frame, scale } = body.layer;
      const hiddenBottom = Math.round(progress * frame.height);
      const keptRows = frame.height - body.hiddenTop - hiddenBottom;
      if (keptRows <= 0) {
        child.visible = false;
        continue;
      }
      if (body.view.frame.height !== keptRows) {
        body.view.frame.height = keptRows;
        body.view.update();
      }
      child.position.set(frame.offsetX * scale, (frame.offsetY + body.hiddenTop + hiddenBottom) * scale);
    }
  }
}

/** The textures a collapse owns go with it; the atlas page under a plain view stays. */
function destroyNode(node: Container): void {
  for (const child of node.children) {
    const body = (child as CollapseSprite).collapseBody;
    body?.view.destroy();
    body?.bake?.destroy(true);
  }
  node.destroy({ children: true });
}

/** Warm grey, a shade off the damage smoke so debris reads distinct from fire smoke. */
const DUST_COLOUR = 0x9b9186;

function poseDust(node: CollapseNode, seed: number, age: number): void {
  const dust = node.dust;
  if (dust === undefined) return;
  const halfWidth = node.dustHalfWidth ?? 0;
  for (let i = 0; i < dust.children.length; i++) {
    const puff = dust.children[i] as Sprite;
    const pose = collapseDustPuff(seed, i, age, halfWidth);
    puff.position.set(pose.x, pose.y);
    puff.scale.set(pose.radius / 22);
    puff.alpha = pose.alpha * 0.75;
  }
}

interface CollapseNode extends Container {
  dust?: Container;
  dustHalfWidth?: number;
}

/** One sinking layer: `view` samples its revealed rows and shrinks from the bottom as it sinks. */
interface CollapseBody {
  readonly layer: ResolvedLayer;
  readonly view: Texture;
  /** Frame rows the construction crop still hid at destruction; 0 for a per-pixel reveal or a finished body. */
  readonly hiddenTop: number;
  /** The frozen per-pixel reveal `view` samples, when the stage has a time sheet. */
  readonly bake?: Texture;
}

interface CollapseSprite extends Sprite {
  collapseBody?: CollapseBody;
}
