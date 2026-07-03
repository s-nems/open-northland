import type { WorldSnapshot } from '@vinland/sim';
import { Container, Graphics, Sprite, type TextureSource } from 'pixi.js';
import { type Camera, depthKey } from '../data/iso.js';
import { type DrawItem, type DrawKind, buildSpriteScene, drawableEntityRefs } from '../data/scene.js';
import {
  type AtlasFrame,
  type BuildingDraw,
  type SpriteKind,
  pickByJob,
  resolveBuildingDraw,
  resolveConstructionDraws,
  resolveResourceDraw,
  resolveSettlerBobId,
  resolveSpriteBobId,
  resolveStockpileDraw,
  unwrapBobRef,
} from '../data/sprites.js';
import type { Viewport } from '../data/viewport.js';
import { PalettedSprite } from './paletted-sprite.js';
import type { SpriteLayer, SpriteSheet } from './pixi-app.js';
import type { TextureCache } from './texture-cache.js';

/**
 * The retained per-entity sprite pool — a display object per drawable entity, keyed by its (monotonic,
 * never-reused) entity id and REUSED across frames: only the container position, the sprites'
 * textures/offsets, and their visibility change, so the steady state allocates nothing. Each frame the
 * pool is reconciled to the culled, depth-sorted draw list; an entity that scrolled off-screen is kept
 * pooled (it may scroll back), one that LEFT the snapshot (died) is destroyed. This is where the
 * frame-selection data decisions (`resolveSettlerBobId`/`resolveBuildingDraw`, unit-tested upstream)
 * become actual bound textures — the GPU half a human judges.
 */

/** Placeholder body colour per drawable sprite kind (drawn when no atlas frame binds the entity). */
const KIND_COLOURS: Record<Exclude<DrawKind, 'tile'>, number> = {
  building: 0xc8a04a,
  settler: 0xe8e0d0,
  resource: 0x2f7d32,
  stockpile: 0xb08040, // a sandy heap/flag marker, distinct from the green resource node
  stump: 0x6b4a2a, // a brown stump/debris marker (the felled-tree remnant), distinct from both
  grounddrop: 0x8a5a2a, // a log-brown marker for a freshly-felled trunk lying on the ground
};

/** One resolved atlas layer to draw for an entity: which source page, which frame rect, at what scale.
 *  `atlasW`/`atlasH` (the source sheet's pixel size) ride along ONLY for the paletted settler path — the
 *  {@link PalettedSprite} mesh samples the indexed atlas by UV, so it needs the sheet dimensions; the plain
 *  {@link Sprite} path binds a cached sub-texture and ignores them. */
interface ResolvedLayer {
  readonly source: TextureSource;
  readonly frame: AtlasFrame;
  readonly scale: number;
  readonly atlasW?: number;
  readonly atlasH?: number;
}

/**
 * The WORLD-space axis-aligned bounding box of an entity's drawn sprite this frame (pre-camera, the same
 * space as a {@link DrawItem}'s `x`/`y`). The union of its visible atlas layers (or its placeholder box),
 * translated to the feet anchor. This is what makes "click anywhere on the graphic" and a footprint-sized
 * selection marker EXACT per building/settler — the picker + selection ring read it instead of guessing a
 * fixed box, so a big headquarters and a small hut each get a hit box the size of their own sprite.
 */
export interface EntityBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The mutable backing of an entity's bounds — one per pooled entity, restamped in place each frame so
 *  the per-frame bounds pass allocates nothing (see {@link PooledEntity.bounds}). */
interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
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
  /** This entity's atlas layers. A PALETTED settler (team colours on) draws {@link PalettedSprite} meshes;
   *  every other entity draws plain {@link Sprite}s. Homogeneous per entity — set by {@link PooledEntity.paletted}. */
  readonly sprites: (Sprite | PalettedSprite)[];
  /** Whether this entity draws team-coloured {@link PalettedSprite} meshes (a settler, with a LUT + indexed
   *  characters loaded). Fixed at creation — the sprite CLASS can't change, so the pool decides once. */
  readonly paletted: boolean;
  placeholder?: Graphics;
  attached: boolean;
  lastSeen: number;
  /** This entity's world-space sprite AABB, restamped IN PLACE each frame it's drawn (no per-frame alloc). */
  readonly bounds: MutableBounds;
  /** The `frameId` the bounds were last stamped on; `boundsOf` only returns them when it's the current one. */
  boundsFrame: number;
  /** Last real facing (0..7) this settler drew with — reused across the 1-tick heading gap a re-pathing
   *  unit shows, so its walk doesn't flip to the default facing for a frame each tile (see updatePooled). */
  lastFacing?: number;
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

export class SpritePool {
  private readonly pool = new Map<number, PooledEntity>();
  private frameId = 0;
  private drawn = 0;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer (also holds the tall map
   *   objects) — pooled entities attach HERE.
   * @param textures the renderer's shared frame→texture cache.
   * @param sheet the loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity.
   */
  constructor(
    private readonly spriteLayer: Container,
    private readonly textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
  ) {}

  /**
   * Reconcile the pool to one frame: get-or-create a display object per drawn (culled, depth-sorted)
   * entity, update it in place, order it by its feet-anchor {@link depthKey}, detach entities not drawn
   * this frame (culled or gone), and destroy the ones that LEFT the snapshot (died). No allocation in
   * the steady state — only a first-seen entity or a growing layer set mints a new object.
   */
  reconcile(
    snapshot: WorldSnapshot,
    vp: Viewport,
    tick: number,
    camera: Camera,
    resW: number,
    resH: number,
  ): void {
    const items = buildSpriteScene(snapshot, vp);
    this.frameId++;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item === undefined) continue;
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        const kind = item.kind as Exclude<DrawKind, 'tile'>;
        pe = createPooled(kind, this.isPaletted(kind));
        this.pool.set(item.ref, pe);
      }
      this.updatePooled(pe, item, tick, camera, resW, resH);
      // Depth = the feet-anchor SCREEN y (+ a small deterministic x tiebreak), the same key the tall
      // map objects use, so a settler and the tree it walks behind sort into one painter order.
      // NOTE this deliberately diverges from the headless `buildScene` oracle's row-major
      // (tileY, tileX) list order: screen y ∝ (col + row) is the iso-correct occlusion key once
      // static objects interleave with entities.
      pe.container.zIndex = depthKey(item.x, item.y);
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
  }

  /** Entities drawn last frame + sprites currently pooled — for the perf overlay's on-screen readout. */
  stats(): { drawn: number; pooled: number } {
    return { drawn: this.drawn, pooled: this.pool.size };
  }

  /**
   * The WORLD-space bounding box of an entity's sprite as DRAWN last frame, or `undefined` if it wasn't
   * drawn (off-screen / not in the snapshot). The picker uses it for an exact "click the graphic" hit
   * test and the selection ring to size a building marker to its actual footprint — see {@link EntityBounds}.
   */
  boundsOf(ref: number): EntityBounds | undefined {
    const pe = this.pool.get(ref);
    // Only the CURRENT frame's stamp is valid: a pooled-but-culled entity keeps a stale stamp, so it
    // correctly reads as "no bounds" (off-screen → the picker falls back to its kind box).
    return pe !== undefined && pe.boundsFrame === this.frameId ? pe.bounds : undefined;
  }

  /**
   * Destroy EVERY pooled entity — including ones currently detached (culled off-screen), which a
   * scene-graph walk from the sprite layer can't reach because they were removed from it. Called on the
   * renderer's dispose.
   */
  destroy(): void {
    for (const pe of this.pool.values()) pe.container.destroy({ children: true });
    this.pool.clear();
  }

  /**
   * Update one pooled entity for this frame: move its container to the feet anchor, then either bind its
   * atlas layers (reusing/growing its child sprites) or show its placeholder geometry — reusing objects
   * instead of re-creating them.
   */
  private updatePooled(
    pe: PooledEntity,
    item: DrawItem,
    tick: number,
    camera: Camera,
    resW: number,
    resH: number,
  ): void {
    pe.container.position.set(item.x, item.y);
    // Sticky facing: a MOVING settler that dropped its PathFollow for a tick (the repath gap — state stays
    // `moving` via MoveGoal/PathRequest but there is no heading to read) reuses its last real heading so the
    // walk doesn't flip to DEFAULT_FACING for a frame each tile (the pool half of what `readSpriteState`
    // smooths). Gating on `state === 'moving'` is what keeps the spread to that RARE gap frame: an IDLE
    // settler ALSO has no facing but must not allocate a copy every frame — it just draws the default idle
    // facing, as before. A settler with a live heading has `facing` set and passes `item` through untouched.
    if (item.facing !== undefined) pe.lastFacing = item.facing;
    const drawItem =
      pe.kind === 'settler' &&
      item.state === 'moving' &&
      item.facing === undefined &&
      pe.lastFacing !== undefined
        ? { ...item, facing: pe.lastFacing }
        : item;
    const layers = this.resolveLayers(drawItem, tick);
    if (layers === null) {
      // Unbound / no sheet → placeholder marker (footprint diamond + body box), hide any atlas sprites.
      for (const s of pe.sprites) s.visible = false;
      if (pe.placeholder === undefined) {
        pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
        pe.container.addChild(pe.placeholder);
      }
      pe.placeholder.visible = true;
      const { bodyW, bodyH } = placeholderBody(pe.kind);
      const halfW = Math.max(9, bodyW / 2);
      this.stampBounds(pe, item.x - halfW, item.y - bodyH, item.x + halfW, item.y + 5);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    // A PALETTED settler draws team-coloured PalettedSprite meshes. A custom-shader mesh can't ride the
    // camera-transformed spriteLayer (Pixi leaves its transform UBO unbound), so it SELF-places in screen
    // space — mirror the camera the plain sprites inherit: screen feet-anchor = camera applied to this
    // entity's world-screen anchor (item.x/y). Cheap to compute once; unused on the plain-sprite path.
    const camScale = camera.scale ?? 1;
    const originX = camera.offsetX + camScale * item.x;
    const originY = camera.offsetY + camScale * item.y;
    const playerRow = item.player ?? 0; // an unowned settler reads LUT row 0 (the base palette)
    // Accumulate the union of the drawn layers' rects (feet-local) → the entity's exact sprite bounds. The
    // bounds live in WORLD-screen space (item.x + feet-local offsets), the same for a mesh or a plain sprite,
    // so the picker/selection ring reads one consistent box regardless of how the layer was drawn.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // Feet-anchored: the frame's authored draw offset, scaled about the anchor (the container origin).
      const ox = layer.frame.offsetX * layer.scale;
      const oy = layer.frame.offsetY * layer.scale;
      if (pe.paletted && this.sheet?.palette !== undefined) {
        const lut = this.sheet.palette;
        let spr = pe.sprites[i] as PalettedSprite | undefined; // pe.paletted ⇒ every layer is a PalettedSprite
        if (spr === undefined) {
          spr = new PalettedSprite(lut.source, lut.colours);
          pe.sprites[i] = spr;
          pe.container.addChild(spr);
        }
        // The mesh samples the INDEXED atlas by UV, so it needs the sheet size; the frame's own draw offset
        // is baked into its quad, and place() maps native pixels → screen at the camera zoom (× the layer
        // art scale) about the feet anchor. `player` selects the LUT row (the team colour).
        spr.setFrame(
          layer.source,
          layer.frame,
          layer.atlasW ?? layer.frame.width,
          layer.atlasH ?? layer.frame.height,
        );
        spr.place(originX, originY, camScale * layer.scale, resW, resH);
        spr.player = playerRow;
        spr.visible = true;
      } else {
        let spr = pe.sprites[i] as Sprite | undefined;
        if (spr === undefined) {
          spr = new Sprite();
          pe.sprites[i] = spr;
          pe.container.addChild(spr);
        }
        spr.texture = this.textures.get(layer.source, layer.frame);
        spr.position.set(ox, oy);
        spr.scale.set(layer.scale);
        spr.visible = true;
      }
      if (ox < minX) minX = ox;
      if (oy < minY) minY = oy;
      if (ox + layer.frame.width * layer.scale > maxX) maxX = ox + layer.frame.width * layer.scale;
      if (oy + layer.frame.height * layer.scale > maxY) maxY = oy + layer.frame.height * layer.scale;
    }
    // Hide any leftover sprites from a frame that needed more layers than this one.
    for (let i = layers.length; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
    if (minX <= maxX) {
      this.stampBounds(pe, item.x + minX, item.y + minY, item.x + maxX, item.y + maxY);
    }
  }

  /** Whether an entity of `kind` draws team-coloured {@link PalettedSprite} meshes: a settler, with BOTH the
   *  player-colour LUT ({@link SpriteSheet.palette}) and the indexed {@link SpriteSheet.characters} loaded
   *  (real graphics + the pipeline's colour stage). Fixed for the pool's life — the sheet never changes — so
   *  a pooled entity's sprite CLASS is decided once at creation. Without the LUT this is false everywhere and
   *  every entity draws plain {@link Sprite}s exactly as before. */
  private isPaletted(kind: Exclude<DrawKind, 'tile'>): boolean {
    return kind === 'settler' && this.sheet?.palette !== undefined && this.sheet.characters !== undefined;
  }

  /** Restamp a pooled entity's bounds IN PLACE for this frame — no allocation in the per-frame pass. */
  private stampBounds(pe: PooledEntity, minX: number, minY: number, maxX: number, maxY: number): void {
    pe.bounds.minX = minX;
    pe.bounds.minY = minY;
    pe.bounds.maxX = maxX;
    pe.bounds.maxY = maxY;
    pe.boundsFrame = this.frameId;
  }

  /**
   * Resolve the ordered atlas layers an entity draws, or `null` to draw the placeholder — returns DATA
   * (source + frame + scale) instead of display objects so the caller can reuse pooled sprites.
   * Faithfully reproduces the family → kind-layer → shared-body decision (an unloaded named family falls
   * through to the default building layer; a loaded family/kind layer with a missing/empty frame returns
   * `null` → placeholder, since its id space differs).
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
        // atlasW/H ride along for the paletted mesh path (it samples the indexed sheet by UV); the plain
        // sprite path ignores them. See ResolvedLayer / updatePooled.
        layers.push({
          source: char.body.source,
          frame: bodyFrame,
          scale: 1,
          atlasW: char.body.atlas.width,
          atlasH: char.body.atlas.height,
        });
      }
      // ONE head per individual, stable by entity id (ids are monotonic, never reused), so a crowd
      // shows varied faces without per-frame flicker — the render-side analogue of the original's
      // per-individual random head pick. The head may resolve through its OWN binding (the head-borrow
      // case — a carry variant whose head bobs are empty plays the base walk's head instead).
      const heads = char.heads;
      if (heads !== undefined && heads.length > 0) {
        const head = heads[item.ref % heads.length];
        const headBob =
          char.headBinding !== undefined ? resolveSettlerBobId(char.headBinding, item, tick) : bob;
        const headFrame = head?.atlas.frames.get(headBob);
        if (head !== undefined && headFrame !== undefined && headFrame.width > 0 && headFrame.height > 0) {
          layers.push({
            source: head.source,
            frame: headFrame,
            scale: 1,
            atlasW: head.atlas.width,
            atlasH: head.atlas.height,
          });
        }
      }
      return layers.length > 0 ? layers : null;
    }

    let bobId: number | null;
    if (item.kind === 'building') {
      // An under-construction building draws its ACTIVE construction-stage stack (grey foundation →
      // stages → body, several sprites in stacking order) when the binding carries the layers; each
      // stage resolves through the same family/default-layer decision a finished body uses. A stage
      // whose frame is missing/empty is skipped; if none resolves, fall through to the body draw
      // (a partial atlas degrades to the finished look rather than drawing nothing).
      const stack = resolveConstructionDraws(sheet.bindings.building, item);
      if (stack !== null) {
        const layers: ResolvedLayer[] = [];
        for (const draw of stack) {
          const resolved = this.layeredLayerFor(sheet, 'building', draw);
          if (resolved !== null) layers.push(resolved);
        }
        if (layers.length > 0) return layers;
      }
      const draw = resolveBuildingDraw(sheet.bindings.building, item);
      // A LOADED named family resolves through the shared helper (missing/empty frame → placeholder);
      // an UNLOADED one falls through to the default building layer below (a deliberate difference
      // from the construction path, which drops the stage instead).
      if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
        const resolved = this.layeredLayerFor(sheet, 'building', draw);
        return resolved === null ? null : [resolved];
      }
      bobId = draw.bob;
    } else if (item.kind === 'resource') {
      // A resource node resolves its per-good draw the SAME way a building does: a layer-qualified ref
      // (a rock/mine `.bmd` family) draws from that family atlas; a bare ref (the default yew) falls
      // through to the `kindLayers.resource` tree layer (or the shared synthetic atlas) below. The
      // reducer only emits a layer for a LOADED family, so a layer-qualified miss is a real gap
      // (placeholder), never a wrong-bob borrow from the tree atlas.
      const draw = resolveResourceDraw(sheet.bindings.resource, item);
      if (draw.layer !== undefined && sheet.families?.[draw.layer] !== undefined) {
        const resolved = this.layeredLayerFor(sheet, 'resource', draw);
        return resolved === null ? null : [resolved];
      }
      bobId = draw.bob;
    } else if (item.kind === 'stockpile') {
      // A ground pile / flag has NO shared `kindLayers` layer of its own, so it draws ONLY from a loaded
      // named family (the `ls_goods` pile / `ls_temp` flag atlases). A bare or unloaded-family ref draws
      // the placeholder heap — never falls through to the body atlas (which would blit a settler frame).
      const binding = sheet.bindings.stockpile;
      if (binding === undefined) return null;
      const draw = resolveStockpileDraw(binding, item); // the per-fill heap when held, the flag when empty
      if (draw.layer === undefined) return null; // no family → placeholder heap
      const primary = this.layeredLayerFor(sheet, 'stockpile', draw);
      if (primary === null) return null;
      // The delivery FLAG stays planted even once wood is piled on it: when the pile HOLDS goods (`draw` is
      // the heap), plant the flag BEHIND its heap so the collection marker never vanishes under its goods.
      // An empty pile's `draw` already IS the flag, so nothing extra to add.
      if (item.goodType !== undefined && typeof binding !== 'number') {
        const flagDraw = unwrapBobRef(binding.flag);
        const flagLayer =
          flagDraw.layer !== undefined ? this.layeredLayerFor(sheet, 'stockpile', flagDraw) : null;
        if (flagLayer !== null) return [flagLayer, primary]; // flag behind, heap in front
      }
      return [primary];
    } else if (item.kind === 'grounddrop') {
      // A freshly-felled trunk on the ground draws its per-good pickup-stage LOG from a loaded named family
      // (the `landscapeToPickup` atlas), reusing the resource resolver — the same no-wrong-borrow rule as
      // the stump. A bare or unloaded-family ref draws the placeholder log, never a body-atlas frame.
      const binding = sheet.bindings.trunk;
      if (binding === undefined) return null;
      const draw = resolveResourceDraw(binding, item);
      if (draw.layer === undefined) return null; // no family → placeholder
      const resolved = this.layeredLayerFor(sheet, 'grounddrop', draw);
      return resolved === null ? null : [resolved];
    } else if (item.kind === 'stump') {
      // A stump has NO shared `kindLayers` layer of its own either — it draws its debris frame ONLY
      // from a loaded named family (`ls_trees_dead`), reusing the per-good resource resolver. A bare or
      // unloaded-family ref draws the placeholder — never falls through to the body atlas.
      const binding = sheet.bindings.stump;
      if (binding === undefined) return null;
      const draw = resolveResourceDraw(binding, item);
      if (draw.layer === undefined) return null; // no family → placeholder
      const resolved = this.layeredLayerFor(sheet, 'stump', draw);
      return resolved === null ? null : [resolved];
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

  /**
   * Resolve ONE layered draw (a finished building body / construction stage, or a per-good resource /
   * stockpile object) to its atlas layer — the family / dedicated-kind-layer decision shared by every
   * layered kind. A `draw.layer` draws from that named {@link SpriteSheet.families} atlas (at its
   * `familyScales` entry, else the kind's `kindScales`, else native); a bare draw draws from the kind's
   * own {@link SpriteSheet.kindLayers} layer. Returns null for an unloaded family, a kind with no
   * dedicated layer, or a missing/empty frame (the caller skips or falls back to the placeholder).
   */
  private layeredLayerFor(sheet: SpriteSheet, kind: SpriteKind, draw: BuildingDraw): ResolvedLayer | null {
    if (draw.layer !== undefined) {
      const family = sheet.families?.[draw.layer];
      if (family === undefined) return null; // unloaded named family — no wrong-bob borrow
      const frame = family.atlas.frames.get(draw.bob);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
      const scale = sheet.familyScales?.[draw.layer] ?? sheet.kindScales?.[kind] ?? 1;
      return { source: family.source, frame, scale };
    }
    const kindLayer = sheet.kindLayers?.[kind];
    if (kindLayer === undefined) return null;
    const frame = kindLayer.atlas.frames.get(draw.bob);
    if (frame === undefined || frame.width === 0 || frame.height === 0) return null;
    return { source: kindLayer.source, frame, scale: sheet.kindScales?.[kind] ?? 1 };
  }
}

/** A fresh, empty pooled entity (container + kind; sprites/placeholder grow lazily on first update). */
function createPooled(kind: Exclude<DrawKind, 'tile'>, paletted: boolean): PooledEntity {
  return {
    container: new Container(),
    kind,
    sprites: [],
    paletted,
    attached: false,
    lastSeen: 0,
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    boundsFrame: -1,
  };
}

/**
 * Draw a feet-anchored sprite placeholder into `g`, relative to its container origin `(0,0)`: a small
 * footprint diamond on the ground + a body box rising from it, coloured by kind — so an unbound entity
 * (or the no-atlas default) still shows depth-sortable geometry. Built ONCE per entity (kind is stable);
 * only its visibility toggles per frame.
 */
/** The feet-local body dimensions the placeholder marker is drawn at, by kind (see {@link drawPlaceholder}). */
function placeholderBody(kind: Exclude<DrawKind, 'tile'>): { bodyW: number; bodyH: number } {
  if (kind === 'building') return { bodyW: 28, bodyH: 40 };
  if (kind === 'stockpile') return { bodyW: 20, bodyH: 12 }; // a low, wide heap/flag base
  return { bodyW: 14, bodyH: 24 };
}

function drawPlaceholder(g: Graphics, kind: Exclude<DrawKind, 'tile'>): Graphics {
  const colour = KIND_COLOURS[kind];
  const { bodyW, bodyH } = placeholderBody(kind);
  g.moveTo(0, -5).lineTo(9, 0).lineTo(0, 5).lineTo(-9, 0).closePath().fill({ color: 0x000000, alpha: 0.3 });
  g.rect(-bodyW / 2, -bodyH, bodyW, bodyH)
    .fill({ color: colour })
    .stroke({ color: 0x000000, width: 1, alpha: 0.5 });
  return g;
}
