import type { SimEvent } from '@open-northland/sim';
import { Container, Rectangle, Texture } from 'pixi.js';
import { dismantleMask } from '../../data/effects/dismantle.js';
import {
  type BuildingCollapse,
  COLLAPSE_LIFETIME_TICKS,
  collapseKey,
  collapseProgress,
  foldBuildingCollapses,
} from '../../data/effects/index.js';
import { isVisible, type Viewport } from '../../data/projection/index.js';
import { type DrawItem, screenDepth } from '../../data/scene/index.js';
import { buildTimeThreshold } from '../../data/sprites/index.js';
import { type ElevationField, projectNode } from '../../data/terrain/index.js';
import { DamageAtlas } from '../building-damage/atlas.js';
import type { FallenBody } from '../building-damage/building-damage.js';
import { DamageEffectTextures } from '../building-damage/effect-textures.js';
import { retainOffscreen, retireUndrawn } from '../overlays/retained-pool.js';
import { markMagnifiedTexture } from '../pixel-art/registry.js';
import { createLayerDrawBox, layerDrawBox, type ResolvedLayer } from '../sprite-pool/index.js';
import { readable2dContext } from '../textures/drawable-resource.js';
import { RecolouredPageSource } from '../textures/recoloured-pages.js';
import type { SpriteSheet } from '../textures/sprite-sheet.js';
import type { TextureCache } from '../textures/texture-cache.js';
import { collapsePlan } from './collapse-plan.js';
import { DismantleBody } from './dismantle-body.js';
import { DismantleDebris } from './dismantle-debris.js';

/** Unwind the building's authored construction layers while retaining its last visible damage. */
export class CollapseLayer {
  /** One node per live collapse, keyed by {@link collapseKey}. */
  private readonly nodes = new Map<string, CollapseNode>();
  private readonly seen = new Set<string>();
  private readonly covers: Viewport[] = [];
  private collapses: readonly BuildingCollapse[] = [];
  private readonly masks = new DamageAtlas();
  private readonly revealBox = createLayerDrawBox();
  private dustArt: DamageEffectTextures | undefined;
  private scratch: ReturnType<typeof readable2dContext> | undefined;
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

  /** Interpolated sim time keeps debris smooth, pausable and reproducible. */
  draw(elevation: ElevationField, viewport: Viewport, tick: number): void {
    this.seen.clear();
    this.covers.length = 0;
    for (const c of this.collapses) {
      const age = tick - c.spawnTick;
      if (age >= COLLAPSE_LIFETIME_TICKS) continue;
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
      for (const body of node.bodies) body.pose(collapseProgress(c, tick));
      node.debris.draw(age, node.ground);
      const bounds = node.getLocalBounds();
      const cover = node.cover;
      cover.minX = p.x + bounds.minX;
      cover.minY = p.y + bounds.minY;
      cover.maxX = p.x + bounds.maxX;
      cover.maxY = p.y + bounds.maxY;
      this.covers.push(cover);
      this.seen.add(key);
    }
    this.masks.flush(false);
    retireUndrawn(this.nodes, this.seen, destroyNode);
    for (const [key, bodies] of this.fallen) {
      const collapse = this.collapses.find((c) => collapseKey(c) === key);
      if (collapse !== undefined && tick - collapse.spawnTick < COLLAPSE_LIFETIME_TICKS) continue;
      for (const body of bodies) body.release();
      this.fallen.delete(key);
    }
  }

  /** Visible body and dust bounds in world pixels, valid until the next draw. */
  groundCover(): readonly Viewport[] {
    return this.covers;
  }

  destroy(): void {
    for (const node of this.nodes.values()) destroyNode(node);
    this.nodes.clear();
    for (const bodies of this.fallen.values()) for (const body of bodies) body.release();
    this.fallen.clear();
    this.dustArt?.destroy();
    this.masks.destroy();
    this.scratch = null;
  }

  /** Mints the body's layer quads, dust last to cover impacts; null when nothing resolves
   *  or the site had revealed nothing yet. */
  private makeNode(c: BuildingCollapse): CollapseNode | null {
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
    const plan = collapsePlan(this.sheet, item, fallen);
    if (plan.length === 0) return null;
    const node = new Container() as CollapseNode;
    node.bodies = [];
    node.cover = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    node.debris = new DismantleDebris();
    this.dustArt ??= new DamageEffectTextures(false);
    if (this.scratch === undefined) this.scratch = readable2dContext(1024, 1024);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let baseY = -Infinity;
    for (const [i, part] of plan.entries()) {
      const { draw: layer, construction } = part;
      const frozen = this.revealedBody(layer);
      if (frozen === null) continue;
      const { view, hiddenTop, bake } = frozen;
      const left = (layer.frame.offsetX * layer.scale) / construction.scale - construction.frame.offsetX;
      const top =
        ((layer.frame.offsetY + hiddenTop) * layer.scale) / construction.scale - construction.frame.offsetY;
      const removal = dismantleMask(
        view.width,
        view.height,
        {
          frame: construction.frame,
          ...(construction.times !== undefined ? { times: construction.times } : {}),
          ...(construction.revealWindow !== undefined ? { window: construction.revealWindow } : {}),
          built: construction.reveal ?? (c.builtPct === undefined ? 1 : c.builtPct / 100),
          seed: c.entity + i * 83,
        },
        left,
        top,
      );
      const body = new DismantleBody(view, removal, this.masks, {
        introduced: part.introduced,
        shade: part.shade,
        alpha: part.alpha,
        ...(bake !== undefined ? { bake } : {}),
      });
      body.display.scale.set(layer.scale);
      body.display.position.set(
        layer.frame.offsetX * layer.scale,
        (layer.frame.offsetY + hiddenTop) * layer.scale,
      );
      body.display.alpha = part.alpha;
      node.debris.add(
        view,
        removal,
        body.display.x,
        body.display.y,
        layer.scale,
        c.entity + i * 83,
        this.scratch,
      );
      node.bodies.push(body);
      node.addChild(body.display);
      minX = Math.min(minX, layer.frame.offsetX * layer.scale);
      maxX = Math.max(maxX, (layer.frame.offsetX + layer.frame.width) * layer.scale);
      minY = Math.min(minY, (layer.frame.offsetY + hiddenTop) * layer.scale);
      baseY = Math.max(baseY, (layer.frame.offsetY + layer.frame.height) * layer.scale);
    }
    if (node.children.length === 0) {
      node.debris.destroy();
      node.destroy();
      return null;
    }
    node.debris.addDust(maxX - minX, baseY - minY, c.entity, this.dustArt);
    node.addChild(node.debris.display);
    node.ground = baseY;
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
    // The dismantle shader reads colours, so a recoloured frame comes off its RGBA copy. Any other
    // frame is cut where it lies, never through the texture cache: a leased damage tile's page would
    // join the world pages there, and a prescaler would then draw that rewritten page's twin once.
    const copy =
      bake === null && layer.source instanceof RecolouredPageSource
        ? this.textures.colouredView(layer.source, frame)
        : null;
    if (copy !== null) {
      rows.x += copy.frame.x;
      rows.y += copy.frame.y;
    } else if (bake === null) {
      rows.x += frame.x;
      rows.y += frame.y;
    }
    const view = new Texture({ source: bake?.source ?? copy?.source ?? layer.source, frame: rows });
    markMagnifiedTexture(view, layer.source);
    return { view, hiddenTop, ...(bake !== null ? { bake } : {}) };
  }
}

function destroyNode(node: CollapseNode): void {
  for (const body of node.bodies) body.destroy();
  node.debris.destroy();
  node.destroy({ children: true });
}

interface CollapseNode extends Container {
  bodies: DismantleBody[];
  debris: DismantleDebris;
  ground: number;
  cover: { -readonly [K in keyof Viewport]: Viewport[K] };
}

/** Frozen pixels of a visible layer, before construction is reversed. */
interface CollapseBody {
  readonly view: Texture;
  /** Frame rows the construction crop still hid at destruction; 0 for a per-pixel reveal or a finished body. */
  readonly hiddenTop: number;
  /** The frozen per-pixel reveal `view` samples, when the stage has a time sheet. */
  readonly bake?: Texture;
}
