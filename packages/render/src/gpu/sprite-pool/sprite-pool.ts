import type { WorldSnapshot } from '@vinland/sim';
import { type Container, Graphics, Sprite } from 'pixi.js';
import type { ElevationField } from '../../data/elevation.js';
import { type Camera, depthKey } from '../../data/iso.js';
import {
  type DrawItem,
  FLAG_PAINT_STEP,
  SPRITE_PAINT_ORDER,
  collectSpriteScene,
} from '../../data/scene/index.js';
import type { SpriteKind } from '../../data/sprites/index.js';
import type { Viewport } from '../../data/viewport.js';
import { PalettedSprite } from '../paletted-sprite.js';
import type { SpriteSheet } from '../pixi-app.js';
import type { TextureCache } from '../texture-cache.js';
import { alphaMaskOf, maskSolidAt } from './alpha-mask.js';
import { trackMotion } from './motion.js';
import { PROJECTILE_FLIGHT_HEIGHT, drawPlaceholder, placeholderBody } from './placeholder.js';
import { type EntityBounds, type PooledEntity, createPooled } from './pooled-entity.js';
import { reconcileSprites } from './reconcile.js';
import { type ResolvedLayer, resolveLayers } from './resolve-layers.js';

/**
 * The retained per-entity sprite pool — a display object per drawable entity, keyed by its (monotonic,
 * never-reused) entity id and REUSED across frames: only the container position, the sprites'
 * textures/offsets, and their visibility change, so the steady state allocates nothing. Each frame the
 * pool is reconciled to the culled, depth-sorted draw list; an entity that scrolled off-screen is kept
 * pooled (it may scroll back), one that LEFT the snapshot (died) is destroyed. This is where the
 * frame-selection data decisions ({@link import('./resolve-layers.js').resolveLayers}, unit-tested
 * upstream) become actual bound textures — the GPU half a human judges.
 */

/**
 * Screen-px depth added per {@link SPRITE_PAINT_ORDER} step in the live painter key. Comfortably above the
 * `depthKey` x-tiebreak's max contribution (so the kind order wins at a shared feet anchor) yet far below
 * one iso row's screen-y gap (so it never lifts a sprite past one a genuine row behind/ahead of it).
 */
const SCREEN_PAINT_EPS = 0.25;

/**
 * Per-frame easing factor for the construction bottom-up reveal — the displayed reveal moves this fraction
 * of the remaining distance toward the layer's target each frame. Tuned so the rise glides continuously
 * across the sim's per-swing `built` steps (~15 ticks / swing) without a visible catch-up snap; a
 * newly-seen site initialises to its target instead of easing up from zero (see {@link SpritePool.bindLayers}).
 */
const CONSTRUCTION_REVEAL_EASE = 0.06;

/**
 * Everything one {@link SpritePool.reconcile} pass needs beyond the pool's own state — built once per
 * frame by the {@link import('../world-renderer.js').WorldRenderer} (one small object per frame, not per
 * entity). Grouping the camera + canvas size + interpolation inputs keeps the per-frame plumbing in one
 * named shape instead of a positional-parameter tail that reshuffles on every new input.
 */
export interface PoolFrame {
  readonly snapshot: WorldSnapshot;
  /** The (margin-inflated) world-space box the camera frames — the sprite cull rectangle. */
  readonly viewport: Viewport;
  /** The sim tick the snapshot belongs to — the animation clock for looping gaits. */
  readonly tick: number;
  /** The camera transform (needed to self-place screen-space {@link PalettedSprite} meshes). */
  readonly camera: Camera;
  /** Canvas size in pixels (the paletted mesh maps screen px → clip space itself). */
  readonly screenW: number;
  readonly screenH: number;
  /** The map's terrain-height field; a flat field (maxLift 0) costs nothing. */
  readonly elevation: ElevationField;
  /** Fixed-timestep interpolation fraction [0,1]: draw each entity `alpha` of the way between its last
   *  two tick anchors. `1` draws raw tick positions (the static `?shot` entry). */
  readonly alpha: number;
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
  reconcile(frame: PoolFrame): void {
    // ONE pass over the snapshot yields both the culled draw list and the pre-cull liveness set the
    // destroy step needs — classifying every entity a second time per frame would double the scan.
    const scene = collectSpriteScene(frame.snapshot, frame.viewport, frame.elevation);
    this.frameId++;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        const kind = item.kind as SpriteKind;
        pe = createPooled(kind, this.isPaletted(kind));
        this.pool.set(item.ref, pe);
      }
      this.updatePooled(pe, item, frame);
      // Depth = the feet-anchor SCREEN y (+ a small deterministic x tiebreak), the same key the tall
      // map objects use, so a settler and the tree it walks behind sort into one painter order.
      // NOTE this deliberately diverges from the headless `buildScene` oracle's row-major
      // (tileY, tileX) list order: the feet-anchor screen y (∝ row under the staggered raster) is
      // the iso-correct occlusion key once static objects interleave with entities.
      // The per-kind bias (a settler in front of the node it stands on, a flag in front of its ground
      // drops — plus a half-step so a flag out-sorts a co-located heap of its own kind) is a sub-pixel
      // epsilon — far below one row's screen-y gap — so it only breaks ties at a shared feet anchor, never
      // reordering sprites a real row apart. See SPRITE_PAINT_ORDER / FLAG_PAINT_STEP.
      // Depth reads the DRAWN (lerped) anchor restored to its PRE-LIFT y (`+ item.lift`), so occlusion
      // still sorts by map row while the sprite itself rides the hill.
      pe.container.zIndex =
        depthKey(pe.motion.drawX, pe.motion.drawY + (item.lift ?? 0)) +
        (SPRITE_PAINT_ORDER[item.kind] + (item.isFlag === true ? FLAG_PAINT_STEP : 0)) * SCREEN_PAINT_EPS;
      if (!pe.attached) {
        this.spriteLayer.addChild(pe.container);
        pe.attached = true;
      }
      pe.lastSeen = this.frameId;
    }
    this.drawn = scene.items.length;

    // Detach pooled entities not drawn this frame (culled or gone) so the layer's sort stays O(visible).
    for (const pe of this.pool.values()) {
      if (pe.lastSeen !== this.frameId && pe.attached) {
        this.spriteLayer.removeChild(pe.container);
        pe.attached = false;
      }
    }

    // Destroy sprites of entities that LEFT the snapshot (died) — not the ones merely culled off-screen.
    for (const ref of reconcileSprites(scene.liveRefs, this.pool.keys()).toDestroy) {
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
   * PIXEL-accurate refinement of the AABB hit: whether the WORLD-px point `(wx, wy)` lands on a SOLID
   * texel of the entity's sprite as drawn last frame. Returns `undefined` when the exact answer isn't
   * available — entity not drawn this frame, a paletted (settler) mesh, a placeholder marker, or an
   * atlas whose pixels can't be read — so the caller keeps the box verdict; `false` means the point is
   * inside the box but on transparent pixels only (the "clicked next to the house" case the mask
   * exists to reject). See {@link alphaMaskOf} for the source basis (a deliberate deviation from the
   * original's footprint-cell picking).
   */
  pixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    const pe = this.pool.get(ref);
    if (pe === undefined || pe.boundsFrame !== this.frameId) return undefined;
    if (pe.paletted) return undefined; // settler meshes keep the (deliberately generous) box hit
    let sampledEveryLayer = false;
    for (const spr of pe.sprites) {
      if (!(spr instanceof Sprite) || !spr.visible) continue;
      const mask = alphaMaskOf(spr.texture.source);
      if (mask === null) return undefined; // pixels unreadable → the box hit stands
      sampledEveryLayer = true;
      // World → this layer's frame-local texels: the container sits at the drawn anchor, the sprite at
      // its authored offset, scaled about the anchor (mirrors bindLayers' placement math, which only
      // ever sets a positive uniform scale). A non-positive scale would mean mirroring/degeneracy this
      // inverse can't map — fail soft to the box verdict rather than sample the wrong texels.
      const scale = spr.scale.x;
      if (!(scale > 0)) return undefined;
      const lx = Math.floor((wx - pe.motion.drawX - spr.position.x) / scale);
      const ly = Math.floor((wy - pe.motion.drawY - spr.position.y) / scale);
      const frame = spr.texture.frame;
      if (lx < 0 || ly < 0 || lx >= frame.width || ly >= frame.height) continue;
      if (maskSolidAt(mask, frame.x + lx, frame.y + ly)) return true;
    }
    // Every visible layer had a mask and none was solid under the point → a genuine miss. No visible
    // atlas layer at all (placeholder marker showing) → no exact answer, keep the box.
    return sampledEveryLayer ? false : undefined;
  }

  /**
   * The anchor an entity was DRAWN at this frame — the inter-tick LERPED feet position, not the raw
   * snapshot tile — or `undefined` when it wasn't drawn (culled / gone). The selection layer reads it
   * so a moving unit's ring glides with the interpolated bob instead of stepping at the tick rate.
   */
  anchorOf(ref: number): { x: number; y: number } | undefined {
    const pe = this.pool.get(ref);
    return pe !== undefined && pe.lastSeen === this.frameId
      ? { x: pe.motion.drawX, y: pe.motion.drawY }
      : undefined;
  }

  /**
   * Re-place every currently-drawn PALETTED settler's meshes for an ALTERNATE camera + target size. The
   * details-panel portrait "observation window" renders the world re-aimed at one unit; plain sprites +
   * terrain ride the re-aimed `worldLayer` transform, but the team-colour meshes self-place in SCREEN space
   * (they can't ride it), so they must be re-placed for the inset camera before that render and restored to
   * the main camera after. Mirrors {@link bindLayers}' placement exactly (same drawn anchor + art scale).
   * `flipY` renders the mesh upright into a bottom-up render texture (true for the inset, false to restore
   * the on-screen render). Scans the pool (O(pooled)) but only PLACES the drawn paletted meshes (skips
   * culled/non-paletted) — no re-cull, no re-lerp, and the placement work is O(on-screen paletted), so the
   * per-frame cost stays screen-bounded (rule 7); only runs while a portrait is open.
   */
  placePalettedFor(camera: Camera, resWidth: number, resHeight: number, flipY: boolean): void {
    const camScale = camera.scale ?? 1;
    for (const pe of this.pool.values()) {
      if (!pe.paletted || pe.lastSeen !== this.frameId) continue;
      const originX = camera.offsetX + camScale * pe.motion.drawX;
      const originY = camera.offsetY + camScale * pe.motion.drawY;
      for (const s of pe.sprites) {
        const spr = s as PalettedSprite;
        if (!spr.visible) continue;
        spr.place(originX, originY, camScale * spr.artScale, resWidth, resHeight);
        spr.flipY = flipY;
      }
    }
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
   * atlas layers ({@link bindLayers}) or show its placeholder geometry ({@link showPlaceholder}) —
   * reusing objects instead of re-creating them.
   */
  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    // Fixed-timestep interpolation over the LIFTED feet: the sim advances in 20 Hz ticks, so drawing
    // raw snapshot anchors steps a walking bob ~8 px every third frame (the visible judder). Track the
    // last two TICK anchors of the terrain-lifted feet (`item.y − lift`, riding the ground up a hill —
    // the lift is bilinear along the walk, so it lerps as smoothly as the motion) and draw at
    // `prev + (curr − prev)·alpha` — the frame's fractional progress into the current tick — so motion
    // is continuous at any display rate, half a tick behind the sim (an imperceptible ~25 ms). See
    // {@link trackMotion} (the pure, unit-tested half). `item.lift` is 0 on a flat map; the depth key
    // in `reconcile` restores the PRE-LIFT y, so occlusion still sorts by map row. Bounds/paletted
    // origin below use the drawn anchor too, so the picker's hit box tracks the drawn graphic.
    trackMotion(pe.motion, frame.tick, item.x, item.y - (item.lift ?? 0), frame.alpha);
    pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
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
    // The moving-state walk cycle runs on the motion-scaled gait clock (feet track ground covered —
    // a body-pressed or braking walker's legs slow instead of jogging in place); everything else
    // (idle loops, action clocks) stays on the free tick.
    const layers = resolveLayers(this.sheet, drawItem, frame.tick, Math.floor(pe.motion.gaitPhase));
    if (layers === null) {
      this.showPlaceholder(pe, item);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    this.bindLayers(pe, item, layers, frame);
  }

  /** Show (lazily building) the placeholder marker — the unbound / no-sheet fallback — and stamp the
   *  entity's bounds from the placeholder's fixed body box. Any atlas sprites are hidden. A PROJECTILE
   *  always draws this path (no decoded arrow bob exists): its arrow flies at body height and rotates
   *  to the item's flight heading each frame. */
  private showPlaceholder(pe: PooledEntity, item: DrawItem): void {
    for (const s of pe.sprites) s.visible = false;
    if (pe.placeholder === undefined) {
      pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
      if (pe.kind === 'projectile') pe.placeholder.position.y = -PROJECTILE_FLIGHT_HEIGHT;
      pe.container.addChild(pe.placeholder);
    }
    pe.placeholder.visible = true;
    // Rotation applies about the graphic's own origin (the shaft centre), so the flight-height offset
    // above is NOT rotated with it — the arrow stays level above its ground anchor and only aims.
    if (pe.kind === 'projectile') pe.placeholder.rotation = item.rotation ?? 0;
    const { bodyW, bodyH } = placeholderBody(pe.kind);
    const halfW = Math.max(9, bodyW / 2);
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    this.stampBounds(pe, drawX - halfW, drawY - bodyH, drawX + halfW, drawY + 5);
  }

  /**
   * Bind the entity's resolved atlas layers onto its pooled sprites (growing the sprite list only when a
   * frame needs MORE layers than any before), and stamp the union of the drawn rects as the entity's
   * world-space bounds. A PALETTED settler binds {@link PalettedSprite} meshes (screen-space,
   * self-placed); every other entity binds plain cached sub-textures.
   */
  private bindLayers(pe: PooledEntity, item: DrawItem, layers: ResolvedLayer[], frame: PoolFrame): void {
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    // A PALETTED settler draws team-coloured PalettedSprite meshes. A custom-shader mesh can't ride the
    // camera-transformed spriteLayer (Pixi leaves its transform UBO unbound), so it SELF-places in screen
    // space — mirror the camera the plain sprites inherit: screen feet-anchor = camera applied to this
    // entity's DRAWN (lerped) anchor. Cheap to compute once; unused on the plain-sprite path.
    const camScale = frame.camera.scale ?? 1;
    const originX = frame.camera.offsetX + camScale * drawX;
    const originY = frame.camera.offsetY + camScale * drawY;
    const playerRow = item.player ?? 0; // an unowned settler reads LUT row 0 (the base palette)
    // Accumulate the union of the drawn layers' rects (feet-local) → the entity's exact sprite bounds. The
    // bounds live in WORLD-screen space (item.x + feet-local offsets), the same for a mesh or a plain sprite,
    // so the picker/selection ring reads one consistent box regardless of how the layer was drawn.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // Ease the DISPLAYED construction reveal toward the layers' target (they share one, keyed off the
    // building's `builtPct`) so a rising building glides between the sim's per-swing steps. A first-seen
    // site initialises straight to its target (no spurious grow-from-zero when a mid-build house scrolls in).
    const revealTarget = layers.find((l) => l?.reveal !== undefined)?.reveal;
    if (revealTarget === undefined) {
      pe.reveal = undefined;
    } else {
      pe.reveal =
        pe.reveal === undefined
          ? revealTarget
          : pe.reveal + (revealTarget - pe.reveal) * CONSTRUCTION_REVEAL_EASE;
    }
    const displayReveal = pe.reveal;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // Feet-anchored: the frame's authored draw offset, scaled about the anchor (the container origin).
      const ox = layer.frame.offsetX * layer.scale;
      const oy = layer.frame.offsetY * layer.scale;
      // A reveal layer draws only its bottom `displayReveal` (cropped from the top, shifted down so its
      // base stays put) — the building rising out of the ground. Buildings never take the paletted path.
      const hiddenTop =
        layer.reveal !== undefined && displayReveal !== undefined
          ? Math.round((1 - displayReveal) * layer.frame.height)
          : 0;
      // The layer's drawn top/height in feet-local space — cropped for a reveal layer, full otherwise.
      const drawnOy = oy + hiddenTop * layer.scale;
      const drawnH = (layer.frame.height - hiddenTop) * layer.scale;
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
        spr.place(originX, originY, camScale * layer.scale, frame.screenW, frame.screenH);
        spr.artScale = layer.scale; // retained so {@link placePalettedFor} can re-place for the portrait inset
        spr.player = playerRow;
        spr.visible = true;
      } else {
        let spr = pe.sprites[i] as Sprite | undefined;
        if (spr === undefined) {
          spr = new Sprite();
          pe.sprites[i] = spr;
          pe.container.addChild(spr);
        }
        if (hiddenTop >= layer.frame.height) {
          // Nothing revealed yet (a foundation at 0%): draw nothing this frame, contribute no bounds.
          spr.visible = false;
          continue;
        }
        spr.texture =
          hiddenTop > 0
            ? this.textures.cropped(layer.source, layer.frame, hiddenTop)
            : this.textures.get(layer.source, layer.frame);
        spr.position.set(ox, drawnOy);
        spr.scale.set(layer.scale);
        spr.visible = true;
      }
      if (ox < minX) minX = ox;
      if (drawnOy < minY) minY = drawnOy;
      if (ox + layer.frame.width * layer.scale > maxX) maxX = ox + layer.frame.width * layer.scale;
      if (drawnOy + drawnH > maxY) maxY = drawnOy + drawnH;
    }
    // Hide any leftover sprites from a frame that needed more layers than this one.
    for (let i = layers.length; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
    if (minX <= maxX) {
      this.stampBounds(pe, drawX + minX, drawY + minY, drawX + maxX, drawY + maxY);
    }
  }

  /** Whether an entity of `kind` draws team-coloured {@link PalettedSprite} meshes: a settler, with BOTH the
   *  player-colour LUT ({@link SpriteSheet.palette}) and the indexed {@link SpriteSheet.characters} loaded
   *  (real graphics + the pipeline's colour stage). Fixed for the pool's life — the sheet never changes — so
   *  a pooled entity's sprite CLASS is decided once at creation. Without the LUT this is false everywhere and
   *  every entity draws plain {@link Sprite}s exactly as before. */
  private isPaletted(kind: SpriteKind): boolean {
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
}
