import type { WorldSnapshot } from '@open-northland/sim';
import { type Container, Graphics, Sprite } from 'pixi.js';
import type { ElevationField } from '../../data/elevation.js';
import { FOG_GHOST_TINT } from '../../data/fog.js';
import type { FogGhost } from '../../data/fog-ghosts.js';
import { type Camera, cameraScreenX, cameraScreenY, depthKey } from '../../data/iso.js';
import { lerp } from '../../data/math.js';
import { collectSpriteScene, type DrawItem, paintOrderBias } from '../../data/scene/index.js';
import { buildTimeThreshold, type SpriteKind } from '../../data/sprites/index.js';
import type { Viewport } from '../../data/viewport.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { trackMotion } from './motion.js';
import { anchorOf, boundsOf, pixelHit } from './pick.js';
import { drawPlaceholder, PROJECTILE_FLIGHT_HEIGHT, placeholderBody } from './placeholder.js';
import { createPooled, type EntityBounds, type PooledEntity } from './pooled-entity.js';
import { reconcileSprites } from './reconcile.js';
import { type ResolvedLayer, resolveLayers } from './resolve-layers.js';

/**
 * The retained per-entity sprite pool: one display object per drawable entity, keyed by its monotonic,
 * never-reused entity id and reused across frames — the steady state mints nothing, only the container
 * position, the sprites' textures/offsets, and their visibility change. Per-frame heap allocation is
 * O(visible) — {@link import('./resolve-layers.js').resolveLayers} builds a small layer array per drawn
 * entity — bounded by the screen, never the map (the render contract). Each frame the pool is reconciled
 * to the culled, depth-sorted draw list: an entity that scrolled off-screen stays pooled (it may scroll
 * back), one that left the snapshot (died) is destroyed.
 */

/**
 * Screen-px depth added per {@link paintOrderBias} step in the live painter key. Comfortably above the
 * `depthKey` x-tiebreak's max contribution (so the kind order wins at a shared feet anchor) yet far below
 * one iso row's screen-y gap (so it never lifts a sprite past one a genuine row behind/ahead of it).
 */
const SCREEN_PAINT_EPS = 0.25;

/**
 * Per-frame easing factor for the construction bottom-up reveal — the displayed reveal moves this fraction
 * of the remaining distance toward the layer's target each frame. Tuned so the rise glides across the
 * sim's per-swing `built` steps (~15 ticks / swing) without a catch-up snap; a newly-seen site initialises
 * to its target instead of easing up from zero (see {@link SpritePool.bindLayers}).
 */
const CONSTRUCTION_REVEAL_EASE = 0.06;

/** Whether a resolved layer carries a construction reveal fraction — module-scoped so the per-entity
 *  {@link SpritePool.bindLayers} scan for the stage stack's shared target allocates no predicate. */
const layerHasReveal = (layer: ResolvedLayer): boolean => layer.reveal !== undefined;

/**
 * Everything one {@link SpritePool.reconcile} pass needs beyond the pool's own state — built once per
 * frame by the {@link import('../world-renderer.js').WorldRenderer} (one small object per frame, not per
 * entity).
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
  /** Entities the retained static map-object layer draws instead (a decoded map's virgin resource
   *  nodes) — skipped by the scene build, so the pool never touches them. */
  readonly staticRefs?: ReadonlySet<number>;
  /** The fog-of-war cull (`data/fog.ts`): entities on tiles this rejects stay pooled but undrawn.
   *  Absent = no fog (every pre-fog view). */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** The viewer's remembered statics (`data/fog-ghosts.ts`) — drawn dimmed on explored ground in
   *  place of their fog-culled (or dead) entities. Absent = no fog or nothing remembered. */
  readonly ghosts?: readonly FogGhost[];
}

export class SpritePool {
  private readonly pool = new Map<number, PooledEntity>();
  private frameId = 0;
  private drawn = 0;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer (also holds the tall map
   *   objects) — pooled entities attach here.
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
   * this frame (culled or gone), and destroy the ones that left the snapshot (died). No allocation in
   * the steady state — only a first-seen entity or a growing layer set mints a new object.
   */
  reconcile(frame: PoolFrame): void {
    // One pass over the snapshot yields both the culled draw list and the pre-cull liveness set the
    // destroy step needs — classifying every entity a second time per frame would double the scan.
    const scene = collectSpriteScene(frame.snapshot, {
      viewport: frame.viewport,
      elevation: frame.elevation,
      staticRefs: frame.staticRefs,
      fogVisible: frame.fogVisible,
      ghosts: frame.ghosts,
    });
    this.frameId++;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      // The sprite scene never emits terrain tiles (they draw in the terrain layer); asserting it here
      // narrows item.kind to SpriteKind for the rest of the loop instead of casting.
      if (item.kind === 'tile') continue;
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        pe = createPooled(item.kind, this.isPaletted(item.kind));
        this.pool.set(item.ref, pe);
      }
      this.updatePooled(pe, item, frame);
      // Depth = the feet-anchor screen y (+ a small deterministic x tiebreak), the same key the tall map
      // objects use, so a settler and the tree it walks behind sort into one painter order. This
      // deliberately diverges from the headless `buildScene` oracle's row-major (tileY, tileX) list order:
      // the feet-anchor screen y (∝ row under the staggered raster) is the iso-correct occlusion key once
      // static objects interleave with entities. The per-kind bias (see SPRITE_PAINT_ORDER /
      // FLAG_PAINT_STEP) is a sub-pixel epsilon, so it only breaks ties at a shared feet anchor, never
      // reordering sprites a real row apart. Depth reads the drawn (lerped) anchor restored to its pre-lift
      // y (`+ item.lift`), so occlusion still sorts by map row while the sprite itself rides the hill.
      pe.container.zIndex =
        depthKey(pe.motion.drawX, pe.motion.drawY + (item.lift ?? 0)) +
        paintOrderBias(item.kind, item.isFlag === true) * SCREEN_PAINT_EPS;
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

    // Destroy sprites of entities that left the snapshot (died) — not the ones merely culled off-screen.
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

  /** The entity's world-space sprite box as drawn this frame — the picker's hit box + the selection
   *  ring's footprint sizer. See {@link import('./pick.js').boundsOf}. */
  boundsOf(ref: number): EntityBounds | undefined {
    return boundsOf(this.pool.get(ref), this.frameId);
  }

  /** Pixel-accurate refinement of the AABB hit against the drawn sprite's alpha mask.
   *  See {@link import('./pick.js').pixelHit}. */
  pixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return pixelHit(this.pool.get(ref), this.frameId, wx, wy);
  }

  /** The inter-tick lerped feet anchor an entity was drawn at this frame — the selection ring glides on
   *  it. See {@link import('./pick.js').anchorOf}. */
  anchorOf(ref: number): { x: number; y: number } | undefined {
    return anchorOf(this.pool.get(ref), this.frameId);
  }

  /**
   * Re-place every currently-drawn paletted settler's meshes for an alternate camera + target size. The
   * details-panel portrait renders the world re-aimed at one unit; plain sprites + terrain ride the re-aimed
   * `worldLayer` transform, but the team-colour meshes self-place in screen space, so they must be re-placed
   * for the inset camera before that render and restored to the main camera after. Mirrors {@link bindLayers}'
   * placement exactly (same drawn anchor + art scale). `flipY` renders the mesh upright into a bottom-up
   * render texture (true for the inset, false to restore the on-screen render). Scans the pool (O(pooled))
   * but only places the drawn paletted meshes, so the placement work stays O(on-screen paletted); only runs
   * while a portrait is open.
   */
  placePalettedFor(camera: Camera, resWidth: number, resHeight: number, flipY: boolean): void {
    const camScale = camera.scale ?? 1;
    for (const pe of this.pool.values()) {
      if (!pe.paletted || pe.lastSeen !== this.frameId) continue;
      const originX = cameraScreenX(camera, pe.motion.drawX);
      const originY = cameraScreenY(camera, pe.motion.drawY);
      for (const s of pe.sprites) {
        const spr = s as PalettedSprite;
        if (!spr.visible) continue;
        spr.place(originX, originY, camScale * spr.artScale, resWidth, resHeight);
        spr.flipY = flipY;
      }
    }
  }

  /**
   * Destroy every pooled entity — including ones currently detached (culled off-screen), which a
   * scene-graph walk from the sprite layer can't reach because they were removed from it. Called on the
   * renderer's dispose.
   */
  destroy(): void {
    for (const pe of this.pool.values()) pe.container.destroy({ children: true });
    this.pool.clear();
  }

  /**
   * Update one pooled entity for this frame: move its container to the feet anchor, then either bind its
   * atlas layers ({@link bindLayers}) or show its placeholder geometry ({@link showPlaceholder}).
   */
  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    // Fixed-timestep interpolation over the lifted feet: the sim advances in 20 Hz ticks, so drawing raw
    // snapshot anchors steps a walking bob ~8 px every third frame. Track the last two tick anchors of the
    // terrain-lifted feet (`item.y − lift`, riding the ground up a hill — the lift is bilinear along the
    // walk, so it lerps as smoothly as the motion) and draw at `prev + (curr − prev)·alpha`, the frame's
    // fractional progress into the current tick, so motion is continuous at any display rate, half a tick
    // behind the sim (~25 ms). See {@link trackMotion} for the pure half. `item.lift` is 0 on a flat map.
    // Bounds/paletted origin below use the drawn anchor too, so the picker's hit box tracks the graphic.
    trackMotion(pe.motion, frame.tick, item.x, item.y - (item.lift ?? 0), frame.alpha);
    pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
    // Sticky facing: a moving settler that dropped its PathFollow for a tick (the repath gap — state stays
    // `moving` via MoveGoal/PathRequest but there is no heading to read) reuses its last real heading so the
    // walk doesn't flip to DEFAULT_FACING for a frame each tile (the pool half of what `readSpriteState`
    // smooths). Gating on `state === 'moving'` keeps the per-frame copy to that gap frame: an idle settler
    // also has no facing but must draw the default idle facing rather than allocate every frame.
    if (item.facing !== undefined) pe.lastFacing = item.facing;
    const drawItem =
      pe.kind === 'settler' &&
      item.state === 'moving' &&
      item.facing === undefined &&
      pe.lastFacing !== undefined
        ? { ...item, facing: pe.lastFacing }
        : item;
    // The moving-state walk cycle runs on the motion-scaled gait clock (feet track ground covered — a
    // body-pressed or braking walker's legs slow instead of jogging in place); everything else (idle loops,
    // action clocks) stays on the free tick. A ghost binds at a frozen clock: an animating ghost (a mill's
    // turning sails under the fog) would leak that the fogged building is still manned.
    const animTick = item.ghost === true ? 0 : frame.tick;
    const layers = resolveLayers(this.sheet, drawItem, animTick, Math.floor(pe.motion.gaitPhase));
    if (layers === null) {
      this.showPlaceholder(pe, item);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    this.bindLayers(pe, item, layers, frame);
  }

  /** Show (lazily building) the placeholder marker — the unbound / no-sheet fallback — and stamp the
   *  entity's bounds from the placeholder's fixed body box. Any atlas sprites are hidden. A projectile
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
    // The ghost dim + no-hit-bounds contract holds on the placeholder path too (see bindLayers).
    pe.placeholder.tint = item.ghost === true ? FOG_GHOST_TINT : 0xffffff;
    // Rotation applies about the graphic's own origin (the shaft centre), so the flight-height offset
    // above is not rotated with it — the arrow stays level above its ground anchor and only aims.
    if (pe.kind === 'projectile') pe.placeholder.rotation = item.rotation ?? 0;
    if (item.ghost === true) return;
    const { bodyW, bodyH } = placeholderBody(pe.kind);
    const halfW = Math.max(9, bodyW / 2);
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    this.stampBounds(pe, drawX - halfW, drawY - bodyH, drawX + halfW, drawY + 5);
  }

  /**
   * Bind the entity's resolved atlas layers onto its pooled sprites (growing the sprite list only when a
   * frame needs more layers than any before), and stamp the union of the drawn rects as the entity's
   * world-space bounds. A paletted settler binds {@link PalettedSprite} meshes (screen-space,
   * self-placed); every other entity binds plain cached sub-textures.
   */
  private bindLayers(pe: PooledEntity, item: DrawItem, layers: ResolvedLayer[], frame: PoolFrame): void {
    const drawX = pe.motion.drawX;
    const drawY = pe.motion.drawY;
    // A paletted settler draws team-coloured PalettedSprite meshes. A custom-shader mesh can't ride the
    // camera-transformed spriteLayer (Pixi leaves its transform UBO unbound), so it self-places in screen
    // space — mirror the camera the plain sprites inherit: screen feet-anchor = camera applied to this
    // entity's drawn (lerped) anchor. Unused on the plain-sprite path.
    const camScale = frame.camera.scale ?? 1;
    const originX = cameraScreenX(frame.camera, drawX);
    const originY = cameraScreenY(frame.camera, drawY);
    const playerRow = item.player ?? 0; // an unowned settler reads LUT row 0 (the base palette)
    // Accumulate the union of the drawn layers' rects (feet-local) → the entity's exact sprite bounds, in
    // world-screen space (item.x + feet-local offsets) for a mesh or a plain sprite alike, so the
    // picker/selection ring reads one consistent box regardless of how the layer was drawn.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // Ease the displayed construction reveal toward the layers' target (they share one, keyed off the
    // building's `builtPct`) so a rising building glides between the sim's per-swing steps. A first-seen
    // site initialises straight to its target (no grow-from-zero when a mid-build house scrolls in).
    const revealTarget = layers.find(layerHasReveal)?.reveal;
    if (revealTarget === undefined) {
      pe.reveal = undefined;
    } else {
      pe.reveal =
        pe.reveal === undefined ? revealTarget : lerp(pe.reveal, revealTarget, CONSTRUCTION_REVEAL_EASE);
    }
    const displayReveal = pe.reveal;
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (layer === undefined) continue;
      // Feet-anchored: the frame's authored draw offset, scaled about the anchor (the container origin).
      const ox = layer.frame.offsetX * layer.scale;
      const oy = layer.frame.offsetY * layer.scale;
      // A reveal layer with time data draws per-pixel: each pixel appears in place once the eased
      // progress, mapped into the stage's own [fromPct,toPct] window, reaches its baked TimeMask
      // threshold (the original's PrintBob_UsingTimeMask construction blit). `null` — no time data or
      // no bake (headless, unreadable atlas pixels) — draws the bottom-up crop below instead. Buildings
      // never take the paletted path.
      const revealTexture =
        layer.reveal !== undefined &&
        displayReveal !== undefined &&
        layer.times !== undefined &&
        layer.revealWindow !== undefined
          ? this.textures.revealed(
              layer.source,
              layer.frame,
              layer.times,
              buildTimeThreshold(displayReveal, layer.revealWindow[0], layer.revealWindow[1]),
              this.frameId,
            )
          : null;
      // The crop fallback draws only the layer's bottom `displayReveal` (cropped from the top, shifted
      // down so its base stays put) — the building rising out of the ground.
      const hiddenTop =
        revealTexture === null && layer.reveal !== undefined && displayReveal !== undefined
          ? Math.round((1 - displayReveal) * layer.frame.height)
          : 0;
      // The layer's drawn top/height in feet-local space — cropped for a crop-reveal layer, full otherwise.
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
        // The mesh samples the indexed atlas by UV, so it needs the sheet size; the frame's own draw offset
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
        if (revealTexture === null && hiddenTop >= layer.frame.height) {
          // Nothing revealed yet (a foundation at 0%): draw nothing this frame — but still stamp
          // bounds below, so the flat site stays clickable over its plot.
          spr.visible = false;
        } else {
          spr.texture =
            revealTexture ??
            (hiddenTop > 0
              ? this.textures.cropped(layer.source, layer.frame, hiddenTop)
              : this.textures.get(layer.source, layer.frame));
          spr.position.set(ox, drawnOy);
          spr.scale.set(layer.scale);
          // A fog ghost dims to the explored-grey grading; assigned unconditionally so a sprite reused
          // across the live↔ghost transition always carries the right tint (tint is a cheap batch
          // attribute — ghosts are never paletted, statics don't take the mesh path).
          spr.tint = item.ghost === true ? FOG_GHOST_TINT : 0xffffff;
          spr.visible = true;
        }
      }
      // An animated state overlay (the mill's rotor) draws but never moves the entity's box — its spin
      // frames breathe in size/offset, and the box feeds the selection ring + portrait framing.
      if (layer.boundsExempt === true) continue;
      // A reveal layer stamps its full frame rect (not just the risen part): a construction site is
      // picked over the final building's whole box, so a barely-started foundation is still clickable.
      const boundsOy = layer.reveal !== undefined ? oy : drawnOy;
      const boundsH = layer.reveal !== undefined ? layer.frame.height * layer.scale : drawnH;
      if (ox < minX) minX = ox;
      if (boundsOy < minY) minY = boundsOy;
      if (ox + layer.frame.width * layer.scale > maxX) maxX = ox + layer.frame.width * layer.scale;
      if (boundsOy + boundsH > maxY) maxY = boundsOy + boundsH;
    }
    // Hide any leftover sprites from a frame that needed more layers than this one.
    for (let i = layers.length; i < pe.sprites.length; i++) {
      const s = pe.sprites[i];
      if (s !== undefined) s.visible = false;
    }
    // A fog ghost stamps no bounds: it must not be pickable — the ref may be a dead entity, and
    // click-selecting a live one through the fog would leak its current state into the details panel.
    if (minX <= maxX && item.ghost !== true) {
      this.stampBounds(pe, drawX + minX, drawY + minY, drawX + maxX, drawY + maxY);
    }
  }

  /** Whether an entity of `kind` draws team-coloured {@link PalettedSprite} meshes: a settler, with both the
   *  player-colour LUT ({@link SpriteSheet.palette}) and the indexed {@link SpriteSheet.characters} loaded
   *  (real graphics + the pipeline's colour stage). Fixed for the pool's life — the sheet never changes — so
   *  a pooled entity's sprite class is decided once at creation. Without the LUT this is false everywhere and
   *  every entity draws plain {@link Sprite}s. */
  private isPaletted(kind: SpriteKind): boolean {
    return kind === 'settler' && this.sheet?.palette !== undefined && this.sheet.characters !== undefined;
  }

  /** Restamp a pooled entity's bounds in place for this frame — no allocation in the per-frame pass. */
  private stampBounds(pe: PooledEntity, minX: number, minY: number, maxX: number, maxY: number): void {
    pe.bounds.minX = minX;
    pe.bounds.minY = minY;
    pe.bounds.maxX = maxX;
    pe.bounds.maxY = maxY;
    pe.boundsFrame = this.frameId;
  }
}
