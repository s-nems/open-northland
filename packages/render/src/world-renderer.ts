import type { WorldSnapshot } from '@vinland/sim';
import {
  type Application,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type TextureSource,
} from 'pixi.js';
import type { HudPlacement } from './hud.js';
import { TILE_HALF_H, TILE_HALF_W, tileToScreen } from './index.js';
import type { Camera, SpriteLayer, SpriteSheet, TerrainTextureSet } from './pixi-renderer.js';
import {
  type DrawItem,
  type DrawKind,
  type SceneTerrain,
  buildSpriteScene,
  drawableEntityRefs,
} from './scene.js';
import {
  type AtlasFrame,
  type SpriteKind,
  pickByJob,
  resolveBuildingDraw,
  resolveSettlerBobId,
  resolveSpriteBobId,
} from './sprites.js';
import { DIAMOND_INDICES, diamondCorners, rectUVs } from './terrain.js';
import { cameraViewport } from './viewport.js';

/**
 * The RETAINED-mode world renderer — the scalable replacement for the old immediate-mode `renderScene`.
 *
 * The old path cleared the whole stage and re-allocated one Pixi object per tile + per entity **every
 * frame** (a `new Graphics`/`new Sprite`/`new Texture`/`new MeshGeometry` per draw item at 60fps), so
 * the object churn — not the draw-call count — exhausted GC/GPU and crashed the tab once a grid grew
 * past a couple thousand tiles. This owns a **persistent scene graph** instead: terrain is meshed ONCE
 * (`setTerrain`), sprites live in a **pool keyed by entity id** and are reused across frames (only their
 * position + texture-frame + depth change), textures are cached per atlas frame, and each `update`
 * renders exactly once. Per frame the *drawn* work is O(visible) with near-zero allocation, so a 256×256
 * map with thousands of animated bobs holds up; the cull itself is still an O(entities) visibility pass
 * (`buildSpriteScene` + `drawableEntityRefs` + the detach walk) — cheap per entity, but a true spatial
 * index (OpenRA's `ScreenMap`) that makes the QUERY O(visible) is a future seam (see `CLAUDE.md`). When
 * fully zoomed OUT the shared-atlas sprites collapse into a few batched draw calls.
 *
 * Still the GPU half an agent cannot self-verify (pixels need a human). The load-bearing DATA decisions
 * it consumes stay upstream + unit-tested: the depth-sorted draw list (`buildSpriteScene`), the frame
 * selection (`resolveSpriteBobId`/`resolveBuildingDraw`), and the cull math (`viewport.ts`). Floats are
 * fine — this is `render`, never read back into the deterministic sim.
 */

/** A flat colour per landscape typeId for the placeholder terrain (cycled if a typeId exceeds the table). */
const TILE_COLOURS: readonly number[] = [
  0x4a7c3a, // 0: grass
  0x3a6ea5, // 1: water
  0x8a6d3b, // 2: dirt/path
  0x9a9a9a, // 3: stone
];
const DEFAULT_TILE_COLOUR = 0x4a7c3a;

/**
 * Terrain is meshed in square blocks of this many tiles a side, and each frame only the blocks whose
 * world-space box meets the viewport are drawn. This is the RTS rule (OpenRA's `Viewport` visible-cell
 * region, our `viewport.ts`): **render cost scales with the SCREEN, not the map** — a 1024² map draws
 * the same handful of blocks a 64² one does, because everything off-screen is a cheap `visible = false`.
 * 32 keeps the visible-block count (≈ draw calls) low while still culling tightly at the screen edges.
 */
const TERRAIN_CHUNK_TILES = 32;

/** Placeholder body colour per drawable sprite kind (drawn when no atlas frame binds the entity). */
const KIND_COLOURS: Record<Exclude<DrawKind, 'tile'>, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
};

/**
 * World-space slack (px) the sprite cull box is grown by on every side, so a TALL sprite whose feet are
 * just off-screen but whose body pokes into view still draws (culling is by the feet anchor). Generous
 * enough to cover the tallest scaled building; small next to a real map (≈8 tiles), so culling still
 * bites. Tunable.
 */
const SPRITE_CULL_MARGIN = 512;

/** Visual style for the HUD panel — the part a human tunes (colour/font/opacity). */
export interface HudStyle {
  readonly panelColor: number;
  readonly panelAlpha: number;
  readonly textColor: number;
  readonly fontSize: number;
  readonly fontFamily: string;
}

/** A readable default HUD style (a dark translucent panel, light monospace text). */
export const DEFAULT_HUD_STYLE: HudStyle = {
  panelColor: 0x000000,
  panelAlpha: 0.55,
  textColor: 0xf0e8d8,
  fontSize: 12,
  fontFamily: 'monospace',
};

/** One frame's HUD overlay: the placed panel/rows ({@link HudPlacement}) + an optional style override. */
export interface HudFrame {
  readonly placement: HudPlacement;
  readonly style?: HudStyle;
}

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale. */
interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
}

/**
 * One entity's persistent display objects, kept across frames and reused: a {@link Container} at the
 * entity's feet anchor holding its atlas layer {@link Sprite}s (body + head overlays, or a single
 * kind/family sprite) and a lazily-built placeholder {@link Graphics}. Per frame only the container
 * position, the sprites' textures/offsets, and their visibility change — nothing is re-allocated.
 */
interface PooledEntity {
  readonly container: Container;
  readonly kind: Exclude<DrawKind, 'tile'>;
  readonly sprites: Sprite[];
  placeholder?: Graphics;
  attached: boolean;
  lastSeen: number;
}

/**
 * One meshed terrain block: its display {@link Container} (built once) plus the world-space AABB used to
 * toggle `.visible` against the viewport each frame. Children hold ABSOLUTE world coords (the container
 * sits at the origin), so the box math and the sprite cull share one coordinate space.
 */
interface TerrainChunk {
  readonly container: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The batched geometry accumulated for one draw call (a colour, or a texture page) within a chunk. */
interface TerrainBatch {
  readonly positions: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

/** Upload one accumulated terrain batch (positions/uvs/indices) as a {@link MeshGeometry}. */
function meshGeometry(batch: TerrainBatch): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array(batch.positions),
    uvs: new Float32Array(batch.uvs),
    indices: new Uint32Array(batch.indices),
  });
}

/**
 * Which pooled entities must be DESTROYED this frame: those whose entity has left the snapshot (died),
 * NOT ones merely culled off-screen (still in `liveRefs`, kept in the pool for when they scroll back).
 * Pure + testable without a GPU — the pool-bookkeeping decision split out from the Pixi mutation.
 */
export function reconcileSprites(
  liveRefs: ReadonlySet<number>,
  pooledKeys: Iterable<number>,
): { toDestroy: number[] } {
  const toDestroy: number[] = [];
  for (const key of pooledKeys) {
    if (!liveRefs.has(key)) toDestroy.push(key);
  }
  return { toDestroy };
}

export class WorldRenderer {
  private readonly app: Application;
  private readonly sheet: SpriteSheet | undefined;
  /** Camera transform lives here; terrain + sprites are its children so one transform pans/zooms both. */
  private readonly worldLayer = new Container();
  /** Static, built once by {@link setTerrain}; always behind the sprite layer (added first). */
  private readonly terrainLayer = new Container();
  /** The meshed terrain blocks + their world-space AABBs, culled to the viewport each frame. */
  private terrainChunks: TerrainChunk[] = [];
  /** Pooled per-entity containers, depth-ordered by zIndex each frame (`sortableChildren`). */
  private readonly spriteLayer = new Container();
  /** HUD overlay — a sibling of the world layer (NOT under the camera), so it stays pinned. */
  private readonly hudLayer = new Container();
  private readonly pool = new Map<number, PooledEntity>();
  /** Texture per atlas frame — each frame belongs to exactly one atlas→source, so keying by it is 1:1. */
  private readonly textureCache = new Map<AtlasFrame, Texture>();
  private frameId = 0;
  private drawn = 0;

  constructor(app: Application, opts?: { readonly sheet?: SpriteSheet | undefined }) {
    this.app = app;
    this.sheet = opts?.sheet;
    this.spriteLayer.sortableChildren = true;
    this.worldLayer.addChild(this.terrainLayer);
    this.worldLayer.addChild(this.spriteLayer);
    app.stage.addChild(this.worldLayer);
    app.stage.addChild(this.hudLayer);
  }

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it batches every cell into one {@link Mesh} per texture page (draw-call count ~one per
   * page, independent of map size); without them it draws the flat placeholder diamonds. Either way the
   * geometry + page textures are built here and RETAINED, so no terrain work happens per frame.
   */
  setTerrain(terrain: SceneTerrain, textures?: TerrainTextureSet): void {
    this.destroyTerrain();
    if (textures !== undefined) this.buildTexturedTerrain(terrain, textures);
    else this.buildFlatTerrain(terrain);
  }

  /**
   * Free the current terrain: each chunk is a {@link Container} of {@link Mesh}es, and a `Mesh` does NOT
   * own its {@link MeshGeometry} (so `destroy` never frees the vertex/uv/index GPU buffers) — release the
   * geometry explicitly, then destroy the container + its children. The tile textures/`Texture.WHITE` are
   * SHARED sources and are deliberately left alone. Used by {@link setTerrain} (a rebuild) and {@link dispose}.
   */
  private destroyTerrain(): void {
    for (const chunk of this.terrainChunks) {
      for (const child of chunk.container.children) {
        if (child instanceof Mesh) child.geometry.destroy();
      }
      chunk.container.destroy({ children: true });
    }
    this.terrainChunks = [];
  }

  /**
   * Draw ONE frame: apply the camera, reconcile the sprite pool to the (culled, depth-sorted) list,
   * refresh the HUD, and render once. No allocation in the steady state — pooled sprites are updated in
   * place; only a first-seen entity or a growing layer set mints a new object.
   */
  update(snapshot: WorldSnapshot, camera: Camera, tick = 0, hud?: HudFrame): void {
    // Camera: the world layer's own transform (screen = world*scale + offset).
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);

    // Cull to the framed viewport (grown to cover tall sprites). Fully zoomed out, this passes
    // everything through and the shared-atlas sprites lean on GPU batching instead.
    const vp = cameraViewport(camera, this.app.screen.width, this.app.screen.height, SPRITE_CULL_MARGIN);
    const items = buildSpriteScene(snapshot, vp);

    // Terrain: draw ONLY the blocks whose box meets the viewport (RTS rule — cost tracks the screen, not
    // the map, so a huge map costs no more than the slice on screen). Off-screen blocks stay in the graph
    // but skip rasterization; a bounded MIN_ZOOM keeps the visible-block count small even fully zoomed out.
    for (const chunk of this.terrainChunks) {
      chunk.container.visible =
        chunk.maxX >= vp.minX && chunk.minX <= vp.maxX && chunk.maxY >= vp.minY && chunk.minY <= vp.maxY;
    }

    // Reconcile the pool: get-or-create each drawn entity, update it in place, order it by zIndex.
    this.frameId++;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        pe = this.createPooled(item.kind as Exclude<DrawKind, 'tile'>);
        this.pool.set(item.ref, pe);
      }
      this.updatePooled(pe, item, tick);
      pe.container.zIndex = i; // paint order == the depth-sorted list index (sprites move, so re-set each frame)
      if (!pe.attached) {
        this.spriteLayer.addChild(pe.container);
        pe.attached = true;
      }
      pe.lastSeen = this.frameId;
    }
    this.drawn = items.length;

    // Detach pooled entities not drawn this frame (culled or gone) so the layer's sort stays O(visible).
    for (const pe of this.pool.values()) {
      if (pe.lastSeen !== this.frameId && pe.attached) {
        this.spriteLayer.removeChild(pe.container);
        pe.attached = false;
      }
    }

    // Destroy sprites of entities that LEFT the snapshot (died) — not the ones merely culled off-screen.
    const live = drawableEntityRefs(snapshot);
    for (const ref of reconcileSprites(live, this.pool.keys()).toDestroy) {
      const pe = this.pool.get(ref);
      if (pe !== undefined) {
        pe.container.destroy({ children: true });
        this.pool.delete(ref);
      }
    }

    this.drawHud(hud);
    this.app.render();
  }

  /** Entities drawn last frame + sprites currently pooled — for the perf overlay's on-screen readout. */
  stats(): { drawn: number; pooled: number } {
    return { drawn: this.drawn, pooled: this.pool.size };
  }

  /** Tear down the whole retained graph + caches. */
  dispose(): void {
    this.destroyTerrain(); // frees mesh geometry the layer.destroy below would otherwise orphan
    // Destroy EVERY pooled entity — including ones currently detached (culled off-screen), which the
    // scene-graph walk in worldLayer.destroy can't reach because they were removed from the sprite layer.
    for (const pe of this.pool.values()) pe.container.destroy({ children: true });
    this.pool.clear();
    this.worldLayer.destroy({ children: true });
    this.hudLayer.destroy({ children: true });
    this.textureCache.clear();
  }

  // ─── sprite pool ────────────────────────────────────────────────────────────────────────────────

  private createPooled(kind: Exclude<DrawKind, 'tile'>): PooledEntity {
    return { container: new Container(), kind, sprites: [], attached: false, lastSeen: 0 };
  }

  /**
   * Update one pooled entity for this frame: move its container to the feet anchor, then either bind its
   * atlas layers (reusing/growing its child sprites) or show its placeholder geometry — mirroring the old
   * `atlasLayers`/`spriteGraphic` decision, but reusing objects instead of re-creating them.
   */
  private updatePooled(pe: PooledEntity, item: DrawItem, tick: number): void {
    pe.container.position.set(item.x, item.y);
    const layers = this.resolveLayers(item, tick);
    if (layers === null) {
      // Unbound / no sheet → placeholder marker (footprint diamond + body box), hide any atlas sprites.
      for (const s of pe.sprites) s.visible = false;
      if (pe.placeholder === undefined) {
        pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
        pe.container.addChild(pe.placeholder);
      }
      pe.placeholder.visible = true;
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      let spr = pe.sprites[i];
      if (spr === undefined) {
        spr = new Sprite();
        pe.sprites.push(spr);
        pe.container.addChild(spr);
      }
      spr.texture = this.textureFor(layer.source, layer.frame);
      // Feet-anchored: the frame's authored draw offset, scaled about the anchor (the container origin).
      spr.position.set(layer.frame.offsetX * layer.scale, layer.frame.offsetY * layer.scale);
      spr.scale.set(layer.scale);
      spr.visible = true;
    }
    // Hide any leftover sprites from a frame that needed more layers than this one.
    for (let i = layers.length; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
  }

  /**
   * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder — the retained
   * twin of the old `atlasLayers`, returning DATA (source + frame + scale) instead of display objects so
   * the caller can reuse pooled sprites. Faithfully reproduces the family → kind-layer → shared-body
   * decision (an unloaded named family falls through to the default building layer; a loaded family/kind
   * layer with a missing/empty frame returns `null` → placeholder, since its id space differs).
   */
  private resolveLayers(item: DrawItem, tick: number): ResolvedLayer[] | null {
    const sheet = this.sheet;
    if (sheet === undefined) return null;

    // Per-job settler CHARACTER (the `[jobbasegraphics]` join): the job's own body + one stable head
    // pick + its own binding, resolved in that body's frame-id space. Falls through to the sheet-global
    // settler path only when the sheet carries no characters (the synthetic sheet — unchanged).
    if (item.kind === 'settler' && sheet.characters !== undefined) {
      const char = pickByJob(sheet.characters, item.jobType, item.young === true);
      const bob = resolveSettlerBobId(char.binding, item, tick);
      const layers: ResolvedLayer[] = [];
      const bodyFrame = char.body.atlas.frames.get(bob);
      if (bodyFrame !== undefined && bodyFrame.width > 0 && bodyFrame.height > 0) {
        layers.push({ source: char.body.source, frame: bodyFrame, scale: 1 });
      }
      // ONE head per individual, stable by entity id (ids are monotonic, never reused), so a crowd
      // shows varied faces without per-frame flicker — the render-side analogue of the original's
      // per-individual random head pick.
      const heads = char.heads;
      if (heads !== undefined && heads.length > 0) {
        const head = heads[item.ref % heads.length];
        const headFrame = head?.atlas.frames.get(bob);
        if (head !== undefined && headFrame !== undefined && headFrame.width > 0 && headFrame.height > 0) {
          layers.push({ source: head.source, frame: headFrame, scale: 1 });
        }
      }
      return layers.length > 0 ? layers : null;
    }

    let bobId: number | null;
    if (item.kind === 'building') {
      const draw = resolveBuildingDraw(sheet.bindings.building, item);
      if (draw.layer !== undefined) {
        const family = sheet.families?.[draw.layer];
        if (family !== undefined) {
          const frame = family.atlas.frames.get(draw.bob);
          if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
          const scale = sheet.familyScales?.[draw.layer] ?? sheet.kindScales?.building ?? 1;
          return [{ source: family.source, frame, scale }];
        }
        // Unloaded named family → fall through to the default building layer below.
      }
      bobId = draw.bob;
    } else {
      bobId = resolveSpriteBobId(item, sheet.bindings, tick);
    }
    if (bobId === null) return null;

    const kindLayer: SpriteLayer | undefined =
      item.kind === 'tile' ? undefined : sheet.kindLayers?.[item.kind as SpriteKind];
    if (kindLayer !== undefined) {
      const frame = kindLayer.atlas.frames.get(bobId);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
      const scale = sheet.kindScales?.[item.kind as SpriteKind] ?? 1;
      return [{ source: kindLayer.source, frame, scale }];
    }

    // Shared body atlas + overlay (head) layers, all indexed by the same resolved bob id.
    const id = bobId;
    const layers: ResolvedLayer[] = [];
    const add = (layer: SpriteLayer): void => {
      const frame = layer.atlas.frames.get(id);
      if (frame !== undefined && frame.width > 0 && frame.height > 0) {
        layers.push({ source: layer.source, frame, scale: 1 });
      }
    };
    add({ source: sheet.source, atlas: sheet.atlas });
    for (const overlay of sheet.overlays ?? []) add(overlay);
    return layers.length > 0 ? layers : null;
  }

  private textureFor(source: TextureSource, frame: AtlasFrame): Texture {
    let tex = this.textureCache.get(frame);
    if (tex === undefined) {
      tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.textureCache.set(frame, tex);
    }
    return tex;
  }

  // ─── terrain (built once, drawn per visible block) ────────────────────────────────────────────────

  /**
   * Drive the chunked build: split the grid into {@link TERRAIN_CHUNK_TILES}-square blocks, hand each
   * block's inclusive tile range to `meshBlock`, wrap the display objects it returns in ONE {@link
   * Container} (kept at the world origin, so children stay in absolute world coords), record the block's
   * AABB, and add it to the terrain layer. Empty blocks are skipped. The box is computed analytically
   * from the block's corner tiles — screen `x = (col−row)·halfW`, `y = (col+row)·halfH`, each diamond
   * reaching ±half a tile — so no per-cell scan is needed to know where a block lives on screen.
   */
  private buildTerrainChunks(
    terrain: SceneTerrain,
    meshBlock: (c0: number, r0: number, c1: number, r1: number) => (Mesh | Graphics)[],
  ): void {
    for (let r0 = 0; r0 < terrain.height; r0 += TERRAIN_CHUNK_TILES) {
      for (let c0 = 0; c0 < terrain.width; c0 += TERRAIN_CHUNK_TILES) {
        const c1 = Math.min(c0 + TERRAIN_CHUNK_TILES, terrain.width) - 1;
        const r1 = Math.min(r0 + TERRAIN_CHUNK_TILES, terrain.height) - 1;
        const children = meshBlock(c0, r0, c1, r1);
        if (children.length === 0) continue;
        const container = new Container();
        for (const child of children) container.addChild(child);
        this.terrainLayer.addChild(container);
        this.terrainChunks.push({
          container,
          minX: (c0 - r1) * TILE_HALF_W - TILE_HALF_W,
          maxX: (c1 - r0) * TILE_HALF_W + TILE_HALF_W,
          minY: (c0 + r0) * TILE_HALF_H - TILE_HALF_H,
          maxY: (c1 + r1) * TILE_HALF_H + TILE_HALF_H,
        });
      }
    }
  }

  /** One batched {@link Mesh} per texture page + a fallback {@link Graphics} for unbound cells, **per
   *  block** — the GPU twin of the pure `terrain.ts` geometry, built ONCE from the grid (no per-frame
   *  re-batch); the per-block split is what lets {@link update} cull off-screen ground. */
  private buildTexturedTerrain(terrain: SceneTerrain, textures: TerrainTextureSet): void {
    this.buildTerrainChunks(terrain, (c0, r0, c1, r1) => {
      const byPage = new Map<string, TerrainBatch & { source: TextureSource }>();
      const fallback = new Graphics();
      let fallbackUsed = false;
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? -1;
          const screen = tileToScreen(col, row);
          const cellTex = textures.cellFor(typeId);
          const source = cellTex !== undefined ? textures.pages.get(cellTex.pageKey) : undefined;
          if (cellTex === undefined || source === undefined) {
            fallbackDiamond(fallback, screen.x, screen.y, cellTex?.fallbackColour ?? DEFAULT_TILE_COLOUR);
            fallbackUsed = true;
            continue;
          }
          let batch = byPage.get(cellTex.pageKey);
          if (batch === undefined) {
            batch = { positions: [], uvs: [], indices: [], source };
            byPage.set(cellTex.pageKey, batch);
          }
          const base = batch.positions.length / 2;
          batch.positions.push(...diamondCorners(screen.x, screen.y));
          batch.uvs.push(...rectUVs(cellTex.rect, source.width, source.height));
          for (const idx of DIAMOND_INDICES) batch.indices.push(base + idx);
        }
      }
      const children: (Mesh | Graphics)[] = [];
      if (fallbackUsed) children.push(fallback);
      for (const batch of byPage.values()) {
        children.push(
          new Mesh({ geometry: meshGeometry(batch), texture: new Texture({ source: batch.source }) }),
        );
      }
      return children;
    });
  }

  /**
   * The flat-tint placeholder ground: each block's cells batched into ONE {@link Mesh} **per distinct
   * tile colour** (a white texel tinted by the colour), built once. A grass-only block is a single
   * draw call regardless of tile count. NOT one `Graphics` of N stroked diamonds: that tessellates the
   * stroke of every cell and does not batch, so at 65 536 cells it costs ~1 s/frame on any renderer (the
   * crash-adjacent path this replaces). The per-cell grid outline is dropped (the textured ground has
   * none either); a solid ground reads the same when zoomed out.
   */
  private buildFlatTerrain(terrain: SceneTerrain): void {
    this.buildTerrainChunks(terrain, (c0, r0, c1, r1) => {
      const byColour = new Map<number, TerrainBatch>();
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const typeId = terrain.typeIds[row * terrain.width + col] ?? 0;
          const screen = tileToScreen(col, row);
          const colour = TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
          let batch = byColour.get(colour);
          if (batch === undefined) {
            batch = { positions: [], uvs: [], indices: [] };
            byColour.set(colour, batch);
          }
          const base = batch.positions.length / 2;
          const corners = diamondCorners(screen.x, screen.y);
          batch.positions.push(...corners);
          for (let v = 0; v < corners.length / 2; v++) batch.uvs.push(0, 0); // every vertex samples the 1×1 white texel
          for (const idx of DIAMOND_INDICES) batch.indices.push(base + idx);
        }
      }
      const children: Mesh[] = [];
      for (const [colour, batch] of byColour) {
        const mesh = new Mesh({ geometry: meshGeometry(batch), texture: Texture.WHITE });
        mesh.tint = colour;
        children.push(mesh);
      }
      return children;
    });
  }

  // ─── hud ────────────────────────────────────────────────────────────────────────────────────────

  /** Repaint the pinned HUD overlay into its persistent layer (a panel + one {@link Text} per row).
   *  Cheap (a handful of rows); full text pooling is a later refinement. */
  private drawHud(hud?: HudFrame): void {
    for (const child of this.hudLayer.removeChildren()) child.destroy();
    if (hud === undefined) return;
    const style = hud.style ?? DEFAULT_HUD_STYLE;
    const p = hud.placement;
    const panel = new Graphics();
    panel
      .rect(p.panelX, p.panelY, p.width, p.height)
      .fill({ color: style.panelColor, alpha: style.panelAlpha });
    this.hudLayer.addChild(panel);
    for (const row of p.rows) {
      const text = new Text({
        text: row.text,
        style: { fill: style.textColor, fontSize: style.fontSize, fontFamily: style.fontFamily },
      });
      text.position.set(row.x, row.y);
      this.hudLayer.addChild(text);
    }
  }
}

/** Trace one flat-colour ground diamond into a shared {@link Graphics} (the textured-terrain fallback). */
function fallbackDiamond(g: Graphics, sx: number, sy: number, colour: number): void {
  g.moveTo(sx, sy - TILE_HALF_H)
    .lineTo(sx + TILE_HALF_W, sy)
    .lineTo(sx, sy + TILE_HALF_H)
    .lineTo(sx - TILE_HALF_W, sy)
    .closePath()
    .fill({ color: colour });
}

/**
 * Draw a feet-anchored sprite placeholder into `g`, relative to its container origin `(0,0)`: a small
 * footprint diamond on the ground + a body box rising from it, coloured by kind — the retained twin of
 * the old `spriteGraphic`, so an unbound entity (or the no-atlas default) still shows depth-sortable
 * geometry. Built ONCE per entity (kind is stable); only its visibility toggles per frame.
 */
function drawPlaceholder(g: Graphics, kind: Exclude<DrawKind, 'tile'>): Graphics {
  const colour = KIND_COLOURS[kind];
  const bodyW = kind === 'building' ? 28 : 14;
  const bodyH = kind === 'building' ? 40 : 24;
  g.moveTo(0, -5).lineTo(9, 0).lineTo(0, 5).lineTo(-9, 0).closePath().fill({ color: 0x000000, alpha: 0.3 });
  g.rect(-bodyW / 2, -bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
