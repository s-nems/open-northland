import type { WorldSnapshot } from '@open-northland/sim';
import { type Container, Graphics, Sprite } from 'pixi.js';
import { FOG_GHOST_TINT, type FogGhost } from '../../data/fog/index.js';
import { lerp } from '../../data/math.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  depthKey,
  type Viewport,
} from '../../data/projection/index.js';
import { collectSpriteScene, type DrawItem, paintOrderBias } from '../../data/scene/index.js';
import { buildTimeThreshold, type SpriteKind } from '../../data/sprites/index.js';
import { type BrightnessField, type ElevationField, scaleColour } from '../../data/terrain/index.js';
import { PalettedSprite } from '../paletted-sprite/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { trackMotion } from './motion.js';
import { anchorOf, boundsOf, pixelHit } from './pick.js';
import { drawPlaceholder, PROJECTILE_FLIGHT_HEIGHT, placeholderBody } from './placeholder.js';
import { createPooled, type EntityBounds, type PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { reconcileSprites } from './reconcile.js';
import { type ResolvedLayer, resolveLayers } from './resolve-layers.js';

/**
 * The retained per-entity sprite pool: one display object per drawable entity, keyed by its monotonic,
 * never-reused entity id and reused across frames — the steady state mints nothing. Each frame the pool
 * is reconciled to the culled, depth-sorted draw list: an entity that scrolled off-screen stays pooled
 * (it may scroll back), one that left the snapshot (died) is destroyed. Per-frame heap allocation is
 * O(visible), bounded by the screen and never the map (the render contract).
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
 * How often (in reconciled frames) the pool is swept for entities that left the snapshot (died) so their
 * display objects can be freed. A death detaches immediately — invisible that same frame — so destroying
 * it only reclaims memory; this whole-pool diff against the live set therefore runs on an interval, not
 * every frame, keeping the per-frame reconcile bounded by the screen. 30 ≈ twice a second at 60 fps.
 */
const POOL_REAP_INTERVAL_FRAMES = 30;

/**
 * Everything one {@link SpritePool.reconcile} pass needs beyond the pool's own state — built once per
 * frame by the {@link import('../world-renderer/index.js').WorldRenderer} (one small object per frame, not per
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
  /** The composed terrain-shading field the ground drew with — sampled at each entity's feet so a
   *  sprite sits in the scene lighting ({@link DrawItem.shade}). Absent = no entity shading. */
  readonly brightness?: BrightnessField;
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
  /** The workplace-assignment highlight: building id → assignable (green) / not (red). A building in this
   *  map draws with a faint green/red tint on its sprite (the assign-mode "lekko zielony/czerwony" look);
   *  absent/empty = no tint. Transient view state like the selection, never sim state. */
  readonly highlight?: ReadonlyMap<number, boolean>;
  /** The details-panel portrait's subject: force-drawn through the cull so its live cutout survives
   *  off-screen / inside a building, but hidden on the main map (see {@link DrawItem.portraitOnly}).
   *  Absent = no portrait open. */
  readonly portraitRef?: number;
}

/** The faint tints an assign-mode candidate building draws with — a light green when the settler can be
 *  assigned there, a light red when not. Pale (near-white) so it reads as a wash over the building art
 *  rather than repainting it. */
const HIGHLIGHT_OK_TINT = 0x88ff88;
const HIGHLIGHT_NO_TINT = 0xff8888;

/** The tint a drawn entity takes this frame: the fog-ghost grey when ghosted, else the assign-mode
 *  green/red when it is a highlighted candidate building, else none (white). */
function entityTint(ref: number, ghost: boolean, highlight?: ReadonlyMap<number, boolean>): number {
  if (ghost) return FOG_GHOST_TINT;
  const ok = highlight?.get(ref);
  if (ok === undefined) return 0xffffff;
  return ok ? HIGHLIGHT_OK_TINT : HIGHLIGHT_NO_TINT;
}

export class SpritePool {
  private readonly pool = new Map<number, PooledEntity>();
  /** The pooled entities currently attached to {@link spriteLayer} (drawn this frame). The detach and
   *  paletted-placement passes iterate this instead of the whole pool so their per-frame cost tracks the
   *  screen (O(visible)), never every entity ever seen — the pool only shrinks on death. Kept in sync with
   *  each entity's `attached` flag: added on attach, removed on detach. */
  private readonly attached = new Set<PooledEntity>();
  private frameId = 0;
  private drawn = 0;
  /** The details-panel portrait's force-hide/solo bookkeeping — everything the pool holds for the
   *  {@link import('../overlays/portrait-inset.js').PortraitInsetLayer} collaborator alone. */
  private readonly portrait: PortraitSubject;

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
    /** Owner slot → team-colour slot for every built scene (a map roster's colour choice); absent = identity. */
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.portrait = new PortraitSubject(spriteLayer);
  }

  /**
   * Reconcile the pool to one frame: get-or-create a display object per drawn (culled, depth-sorted)
   * entity, update it in place, order it by its feet-anchor {@link depthKey}, detach entities not drawn
   * this frame (culled or gone), and reap the ones that left the snapshot (died). Only the death reap
   * must diff the whole pool against the live set, so it runs on an interval
   * ({@link POOL_REAP_INTERVAL_FRAMES}); every other pass is O(visible).
   */
  reconcile(frame: PoolFrame): void {
    // One pass over the snapshot yields both the culled draw list and the pre-cull liveness set the
    // destroy step needs — classifying every entity a second time per frame would double the scan.
    const scene = collectSpriteScene(frame.snapshot, {
      viewport: frame.viewport,
      elevation: frame.elevation,
      brightness: frame.brightness,
      staticRefs: frame.staticRefs,
      fogVisible: frame.fogVisible,
      ghosts: frame.ghosts,
      ...(frame.portraitRef !== undefined ? { portraitRef: frame.portraitRef } : {}),
      ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
    });
    this.frameId++;
    this.portrait.release();
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
      // An entity absent from last frame's draw list still holds the motion track from whenever it was
      // last drawn, so resuming the lerp would glide it in from that stale anchor. Reset to first-sighting
      // and let trackMotion snap (its own SNAP_DISTANCE only catches gaps over 128 px). Worst on a fog
      // reveal — the entity walks on unseen, then appears mid-screen anywhere under that threshold from
      // where it vanished; a viewport-culled one re-enters 512 px off-canvas (SPRITE_CULL_MARGIN) and an
      // indoor one is frozen on its door cell, so those snap invisibly. Reads `lastSeen` before the stamp
      // below overwrites it.
      if (pe.lastSeen !== this.frameId - 1) pe.motion.tick = -1;
      this.updatePooled(pe, item, frame);
      // Depth = the feet-anchor screen y (+ a small deterministic x tiebreak), the same key the tall map
      // objects use, so a settler and the tree it walks behind sort into one painter order. This
      // deliberately diverges from the headless `buildScene` oracle's row-major (tileY, tileX) list order:
      // the feet-anchor screen y (∝ row under the staggered raster) is the iso-correct occlusion key once
      // static objects interleave with entities. Depth reads the drawn (lerped) anchor restored to its
      // pre-lift y (`+ item.lift`), so occlusion still sorts by map row while the sprite rides the hill.
      pe.container.zIndex =
        depthKey(pe.motion.drawX, pe.motion.drawY + (item.lift ?? 0)) +
        paintOrderBias(item.kind, item.isFlag === true) * SCREEN_PAINT_EPS;
      if (!pe.attached) {
        this.spriteLayer.addChild(pe.container);
        pe.attached = true;
        this.attached.add(pe);
      }
      pe.lastSeen = this.frameId;
      // A portrait-only subject (drawn solely for the panel cutout) is hidden on the main map. It stays
      // reconciled/attached (so `anchorOf` + `placePalettedFor` still serve the portrait) — the portrait's
      // second render reveals it, then hides it again before the main stage render.
      if (item.portraitOnly === true) this.portrait.capture(pe, item.frozen === true);
    }
    this.drawn = scene.items.length;

    // Detach entities not drawn this frame (culled or gone); iterating `attached` instead of the whole
    // pool keeps this scan bounded by the screen. Deleting the current entry mid-iteration is well-defined
    // for a Set.
    for (const pe of this.attached) {
      if (pe.lastSeen === this.frameId) continue; // still drawn this frame — keep attached
      this.spriteLayer.removeChild(pe.container);
      pe.attached = false;
      this.attached.delete(pe);
    }

    // Reap entities that left the snapshot (died), freeing their display objects — a merely culled one
    // stays pooled to scroll back. Interval-gated; see POOL_REAP_INTERVAL_FRAMES. `reconcileSprites` is
    // the pure, tested decision (a pooled ref absent from the pre-cull live set has died).
    if (this.frameId % POOL_REAP_INTERVAL_FRAMES === 0) {
      for (const ref of reconcileSprites(scene.liveRefs, this.pool.keys()).toDestroy) {
        const pe = this.pool.get(ref);
        if (pe !== undefined) {
          pe.container.destroy({ children: true });
          this.pool.delete(ref);
        }
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
   * render texture (true for the inset, false to restore the on-screen render).
   */
  placePalettedFor(camera: Camera, resWidth: number, resHeight: number, flipY: boolean): void {
    const camScale = camera.scale ?? 1;
    for (const pe of this.attached) {
      if (!pe.paletted) continue;
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

  /** See {@link PortraitSubject.show}. */
  showPortraitSubject(): void {
    this.portrait.show();
  }

  /** See {@link PortraitSubject.hide}. */
  hidePortraitSubject(): void {
    this.portrait.hide();
  }

  /** See {@link PortraitSubject.container}. */
  portraitSubjectContainer(): Container | null {
    return this.portrait.container();
  }

  /** See {@link PortraitSubject.isIndoor}. */
  portraitSubjectIsIndoor(): boolean {
    return this.portrait.isIndoor();
  }

  /** See {@link PortraitSubject.beginSolo}. */
  beginPortraitSolo(): void {
    this.portrait.beginSolo();
  }

  /** See {@link PortraitSubject.endSolo}. */
  endPortraitSolo(): void {
    this.portrait.endSolo();
  }

  /**
   * Destroy every pooled entity — including ones currently detached (culled off-screen), which a
   * scene-graph walk from the sprite layer can't reach because they were removed from it. Called on the
   * renderer's dispose.
   */
  destroy(): void {
    for (const pe of this.pool.values()) pe.container.destroy({ children: true });
    this.pool.clear();
    this.attached.clear();
  }

  /** Update one pooled entity for this frame: place it at its interpolated feet anchor, then bind its
   *  atlas layers ({@link bindLayers}) or fall back to placeholder geometry ({@link showPlaceholder}). */
  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    // Fixed-timestep interpolation over the lifted feet: the sim advances in 12 Hz ticks, so drawing raw
    // snapshot anchors steps a walking bob ~4 px every fifth frame. Track the last two tick anchors of the
    // terrain-lifted feet (`item.y − lift`, riding the ground up a hill — the lift is bilinear along the
    // walk, so it lerps as smoothly as the motion) and draw at `prev + (curr − prev)·alpha`, the frame's
    // fractional progress into the current tick, so motion is continuous at any display rate, half a tick
    // behind the sim (~42 ms). See {@link trackMotion} for the pure half. `item.lift` is 0 on a flat map.
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
    // action clocks) stays on the free tick. A frozen clock (0) holds a still frame for two cases: a ghost
    // (an animating mill's sails under the fog would leak that the building is still manned) and the
    // portrait subject inside a building (a motionless standing pose, not the breathing idle loop).
    const animTick = item.ghost === true || item.frozen === true ? 0 : frame.tick;
    const layers = resolveLayers(this.sheet, drawItem, animTick, Math.floor(pe.motion.gaitPhase));
    if (layers === null) {
      this.showPlaceholder(pe, item, frame);
      return;
    }
    if (pe.placeholder !== undefined) pe.placeholder.visible = false;
    this.bindLayers(pe, item, layers, frame);
  }

  /** Show (lazily building) the placeholder marker — the unbound / no-sheet fallback — and stamp the
   *  entity's bounds from the placeholder's fixed body box. Any atlas sprites are hidden. A projectile
   *  always draws this path (no decoded arrow bob exists): its arrow flies at body height and rotates
   *  to the item's flight heading each frame. */
  private showPlaceholder(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    for (const s of pe.sprites) s.visible = false;
    if (pe.placeholder === undefined) {
      pe.placeholder = drawPlaceholder(new Graphics(), pe.kind);
      if (pe.kind === 'projectile') pe.placeholder.position.y = -PROJECTILE_FLIGHT_HEIGHT;
      pe.container.addChild(pe.placeholder);
    }
    pe.placeholder.visible = true;
    // The ghost dim + no-hit-bounds contract holds on the placeholder path too (see bindLayers); a
    // highlighted candidate building's placeholder takes the same green/red assign-mode tint.
    pe.placeholder.tint = entityTint(item.ref, item.ghost === true, frame.highlight);
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
      // Restamped per frame beside the sprite itself: the pixel hit test must skip a cast-shadow layer
      // (clicking darkened ground beside a caster is not clicking the caster).
      pe.shadowFlags[i] = layer.shadow === true;
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
        // Feet-anchor terrain shading (DrawItem.shade) — in-shader, so it can brighten past ×1 like the ground.
        spr.brightness = item.shade ?? 1;
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
          // attribute — ghosts are never paletted, statics don't take the mesh path). The feet-anchor
          // terrain shade (DrawItem.shade) rides the same tint — clamped at ×1, a batch tint cannot
          // brighten (the named approximation shared with the tall map objects).
          spr.tint = scaleColour(
            entityTint(item.ref, item.ghost === true, frame.highlight),
            Math.min(1, item.shade ?? 1),
          );
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
    // Hide any leftover sprites from a frame that needed more layers than this one, and drop their
    // stale shadow flags with them (pixelHit skips hidden sprites, but the flag array must not
    // outlive the layers it described).
    pe.shadowFlags.length = layers.length;
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
   *  a pooled entity's sprite class is decided once at creation. */
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
