import type { WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import type { FogGhost } from '../../data/fog/index.js';
import {
  type Camera,
  cameraScreenX,
  cameraScreenY,
  depthKey,
  type Viewport,
} from '../../data/projection/index.js';
import { collectSpriteScene, type DrawItem, paintOrderBias } from '../../data/scene/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import type { SpriteSheet } from '../sprite-sheet.js';
import type { TextureCache } from '../texture-cache.js';
import { LayerBinder } from './bind-layers.js';
import { trackMotion } from './motion.js';
import { anchorOf, boundsOf, pixelHit } from './pick.js';
import type { EntityBounds, PooledEntity } from './pooled-entity.js';
import { PortraitSubject } from './portrait-subject.js';
import { animationClock, easeReveal, revealedItem, walkPose } from './presentation.js';
import { reconcileSprites } from './reconcile.js';
import { resolveLayers } from './resolve-layers.js';

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
export const SCREEN_PAINT_EPS = 0.25;

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
  /** The camera transform (needed to self-place the screen-space paletted settler meshes). */
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
  /** The fog-of-war cull (`data/fog/mask.ts`): entities on tiles this rejects stay pooled but undrawn.
   *  Absent = no fog (every pre-fog view). */
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  /** The viewer's remembered statics (`data/fog/ghosts.ts`) — drawn dimmed on explored ground in
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

/** One camera framing of a {@link SpritePool.portraitPass} render: the camera plus the render target's
 *  logical px size (the paletted meshes map screen px → clip space themselves). */
export interface PortraitView {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
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
  /** This frame's drawn (culled) damaged finished buildings — {@link DrawItem.hpFrac} carriers, rebuilt
   *  each {@link reconcile} for the damage-smoke overlay ({@link damagedBuildings}). */
  private readonly damaged: { ref: number; hpFrac: number }[] = [];
  /** The details-panel portrait's force-hide/solo bookkeeping — everything the pool holds for the
   *  {@link import('../overlays/portrait-inset.js').PortraitInsetLayer} collaborator alone. */
  private readonly portrait: PortraitSubject;
  private readonly binder: LayerBinder;

  /**
   * @param spriteLayer the renderer's shared, depth-sorted entity layer (also holds the tall map
   *   objects) — pooled entities attach here.
   * @param textures the renderer's shared frame→texture cache.
   * @param sheet the loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity.
   */
  constructor(
    private readonly spriteLayer: Container,
    textures: TextureCache,
    private readonly sheet: SpriteSheet | undefined,
    /** Owner slot → team-colour slot for every built scene (a map roster's colour choice); absent = identity. */
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.portrait = new PortraitSubject(spriteLayer);
    this.binder = new LayerBinder(textures, sheet);
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
      staticRefs: frame.staticRefs,
      fogVisible: frame.fogVisible,
      ghosts: frame.ghosts,
      ...(frame.portraitRef !== undefined ? { portraitRef: frame.portraitRef } : {}),
      ...(this.playerColourOf !== undefined ? { playerColourOf: this.playerColourOf } : {}),
    });
    this.frameId++;
    this.portrait.release();
    this.damaged.length = 0;
    for (let i = 0; i < scene.items.length; i++) {
      const item = scene.items[i];
      if (item === undefined) continue;
      // A live damaged building (never a fog ghost) joins the frame's smoke list — collected here, off
      // the already-culled draw list, so the overlay's cost tracks the screen.
      if (item.kind === 'building' && item.hpFrac !== undefined && item.ghost !== true) {
        this.damaged.push({ ref: item.ref, hpFrac: item.hpFrac });
      }
      // The sprite scene never emits terrain tiles (they draw in the terrain layer); asserting it here
      // narrows item.kind to SpriteKind for the rest of the loop instead of casting.
      if (item.kind === 'tile') continue;
      let pe = this.pool.get(item.ref);
      if (pe === undefined) {
        pe = this.binder.create(item.kind);
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
      // reconciled/attached (so `anchorOf` + the portrait pass still serve it) — the portrait's
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

  /** This frame's drawn damaged finished buildings (ref + remaining HP fraction) — the damage-smoke
   *  overlay's input, valid until the next {@link reconcile}. */
  damagedBuildings(): readonly { ref: number; hpFrac: number }[] {
    return this.damaged;
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
   * Scope the details-panel portrait's second render — the pool's half of the inset borrow. Re-places
   * the screen-space team-colour meshes for the inset camera (plain sprites + terrain ride the re-aimed
   * `worldLayer` transform; the paletted meshes self-place, so they can't), reveals the force-hidden
   * subject, solos an indoor one, runs `render`, then restores all of it even if the render throws — so
   * a failed cutout can't leave a real unit hidden on the main map, its siblings blanked, or the meshes
   * placed for the wrong camera. `render` receives the sprite layer to keep visible while blanking the
   * rest of the world for an indoor solo, or null when the subject renders with the world around it.
   */
  portraitPass(inset: PortraitView, main: PortraitView, render: (soloKeep: Container | null) => void): void {
    this.placePaletted(inset.camera, inset.width, inset.height);
    this.portrait.show();
    const soloKeep = this.portrait.beginSoloIfIndoor();
    try {
      render(soloKeep);
    } finally {
      this.portrait.endSolo();
      this.portrait.hide();
      this.placePaletted(main.camera, main.width, main.height);
    }
  }

  /** Re-place every currently-drawn paletted settler's meshes for a camera + target size (in logical px).
   *  Mirrors the {@link LayerBinder}'s placement exactly (same drawn anchor + art scale). */
  private placePaletted(camera: Camera, resWidth: number, resHeight: number): void {
    const camScale = camera.scale ?? 1;
    for (const pe of this.attached) {
      if (!pe.paletted) continue;
      const originX = cameraScreenX(camera, pe.motion.drawX);
      const originY = cameraScreenY(camera, pe.motion.drawY);
      for (const spr of pe.sprites) {
        if (!spr.visible) continue;
        spr.place(originX, originY, camScale * spr.artScale, resWidth, resHeight);
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
    this.attached.clear();
  }

  /** Update one pooled entity for this frame: place it at its interpolated feet anchor, resolve its
   *  atlas layers, then hand the binding (or the placeholder fallback) to the {@link LayerBinder}. */
  private updatePooled(pe: PooledEntity, item: DrawItem, frame: PoolFrame): void {
    // Fixed-timestep interpolation over the lifted feet: the sim advances in 12 Hz ticks, so drawing raw
    // snapshot anchors steps a walking bob ~4 px every fifth frame. Track the last two tick anchors of the
    // terrain-lifted feet (`item.y − lift`, riding the ground up a hill — the lift is bilinear along the
    // walk, so it lerps as smoothly as the motion) and draw at `prev + (curr − prev)·alpha`, the frame's
    // fractional progress into the current tick, so motion is continuous at any display rate, half a tick
    // behind the sim (~42 ms). See {@link trackMotion} for the pure half. `item.lift` is 0 on a flat map.
    // The binder's bounds/paletted origin use the drawn anchor too, so the hit box tracks the graphic.
    trackMotion(pe.motion, frame.tick, item.x, item.y - (item.lift ?? 0), frame.alpha);
    pe.container.position.set(pe.motion.drawX, pe.motion.drawY);
    if (item.facing !== undefined) pe.lastFacing = item.facing;
    // An upgrade site rides the same eased reveal as a from-scratch one: its progress arrives as
    // `upgradePct`, mutually exclusive with `builtPct` by construction (see readBuiltPct/readUpgradePct).
    pe.reveal = easeReveal(pe.reveal, item.builtPct ?? item.upgradePct);
    const layers = resolveLayers(
      this.sheet,
      revealedItem(walkPose(item, pe.kind, pe.motion, pe.lastFacing), pe.reveal),
      animationClock(item, frame.tick),
      // The walk cycle rides the motion-scaled gait phase, not the tick: a body-pressed or braking
      // walker's legs slow with the ground actually covered instead of jogging in place.
      Math.floor(pe.motion.gaitPhase),
    );
    this.binder.bind(pe, item, layers, frame, this.frameId);
  }
}
