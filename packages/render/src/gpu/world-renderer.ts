import type { WorldSnapshot } from '@vinland/sim';
import { type Application, Container } from 'pixi.js';
import type { Camera } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene.js';
import { cameraViewport } from '../data/viewport.js';
import { HudLayer } from './hud-layer.js';
import type { HudFrame } from './hud-layer.js';
import { MapObjectLayer } from './map-object-layer.js';
import type { MapObjectSprite } from './map-object-layer.js';
import type { SpriteSheet, TerrainTextureSet } from './pixi-app.js';
import { SelectionLayer } from './selection-layer.js';
import { type EntityBounds, SpritePool } from './sprite-pool.js';
import { TerrainLayer } from './terrain-layer.js';
import { TextureCache } from './texture-cache.js';

/** Shared empty selection so the common no-selection `update` allocates nothing. */
const NO_SELECTION: ReadonlySet<number> = new Set();

/**
 * The RETAINED-mode world renderer — the scalable replacement for the old immediate-mode `renderScene`,
 * and the thin ORCHESTRATOR over the retained sub-layers it composes.
 *
 * The old path cleared the whole stage and re-allocated one Pixi object per tile + per entity **every
 * frame**, so the object churn — not the draw-call count — exhausted GC/GPU and crashed the tab once a
 * grid grew past a couple thousand tiles. This owns a **persistent scene graph** instead, split across
 * four cooperating sub-layers, each owning its slice of state:
 *  - {@link TerrainLayer} — the ground, meshed once and drawn per visible block;
 *  - {@link MapObjectLayer} — the decoded map's decor (batched meshes) + tall objects (pooled sprites);
 *  - {@link SpritePool} — a display object per entity, keyed by id and reused across frames;
 *  - {@link HudLayer} — the pinned overlay.
 * A shared {@link TextureCache} memoizes frame→texture across them, and the tall objects + pooled
 * entities share ONE depth-sorted `spriteLayer` so they interleave in a single painter order. Per frame
 * the *drawn* work is O(visible) with near-zero allocation, so a 256×256 map with thousands of animated
 * bobs holds up; the cull itself is still an O(entities) visibility pass (a true spatial index — OpenRA's
 * `ScreenMap` — that makes the QUERY O(visible) is a future seam, see `CLAUDE.md`).
 *
 * Still the GPU half an agent cannot self-verify (pixels need a human). The load-bearing DATA decisions
 * it consumes stay upstream + unit-tested: the depth-sorted draw list (`buildSpriteScene`), the frame
 * selection (`resolveSpriteBobId`/`resolveBuildingDraw`), and the cull math (`viewport.ts`). Floats are
 * fine — this is `render`, never read back into the deterministic sim.
 */

/**
 * World-space slack (px) the sprite cull box is grown by on every side, so a TALL sprite whose feet are
 * just off-screen but whose body pokes into view still draws (culling is by the feet anchor). Generous
 * enough to cover the tallest scaled building or map object (trees/palisades share this box); small
 * next to a real map (≈8 tiles), so culling still bites. Tunable.
 */
const SPRITE_CULL_MARGIN = 512;

export class WorldRenderer {
  private readonly app: Application;
  /** Camera transform lives here; terrain + decor + sprites are its children so one transform pans/zooms all. */
  private readonly worldLayer = new Container();
  /** The shared, depth-ordered entity layer — holds BOTH pooled entities and tall map objects. */
  private readonly spriteLayer = new Container();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly mapObjects: MapObjectLayer;
  private readonly pool: SpritePool;
  /** Feet rings under the currently-selected entities (world-space, BELOW the sprites). */
  private readonly selectionLayer = new SelectionLayer();
  private readonly hud = new HudLayer();

  constructor(app: Application, opts?: { readonly sheet?: SpriteSheet | undefined }) {
    this.app = app;
    this.spriteLayer.sortableChildren = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.pool = new SpritePool(this.spriteLayer, this.textureCache, opts?.sheet);
    // Z-order within the world layer: terrain (back) → flat decor → selection rings → sprites + tall
    // objects (front). The rings sit under the sprites so a unit in front occludes a ring behind it.
    this.worldLayer.addChild(this.terrain.container);
    this.worldLayer.addChild(this.mapObjects.decorContainer);
    this.worldLayer.addChild(this.selectionLayer.container);
    this.worldLayer.addChild(this.spriteLayer);
    app.stage.addChild(this.worldLayer);
    // The HUD is pinned (NOT under the camera), so it's a direct child of the stage.
    app.stage.addChild(this.hud.container);
  }

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it draws textured diamonds; without them the flat placeholder ground. See {@link TerrainLayer}.
   */
  setTerrain(terrain: SceneTerrain, textures?: TerrainTextureSet): void {
    this.terrain.set(terrain, textures);
  }

  /**
   * (Re)build the retained landscape-object layers from a decoded map's placements — call ONCE per map,
   * like {@link setTerrain}. See {@link MapObjectLayer}.
   */
  setMapObjects(objects: readonly MapObjectSprite[]): void {
    this.mapObjects.set(objects);
  }

  /**
   * Draw ONE frame: apply the camera, cull the terrain, advance the map objects, reconcile the sprite
   * pool to the (culled, depth-sorted) list, draw the selection rings, repaint the HUD, and render once.
   * No allocation in the steady state — the sub-layers update in place; only a first-seen entity or a
   * growing layer set mints. `selection` is the app's currently-selected entity ids (empty by default),
   * projected to feet rings; it is transient view state like the camera, never sim state.
   */
  update(
    snapshot: WorldSnapshot,
    camera: Camera,
    tick = 0,
    hud?: HudFrame,
    selection: ReadonlySet<number> = NO_SELECTION,
  ): void {
    // Camera: the world layer's own transform (screen = world*scale + offset).
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);
    // Cull to the framed viewport (grown to cover tall sprites). Fully zoomed out, this passes
    // everything through and the shared-atlas sprites lean on GPU batching instead.
    const vp = cameraViewport(camera, this.app.screen.width, this.app.screen.height, SPRITE_CULL_MARGIN);
    this.terrain.cull(vp);
    this.mapObjects.update(vp, tick);
    // The pool needs the camera + canvas size to place team-colour PalettedSprite meshes (screen-space,
    // they can't ride the worldLayer transform); the plain-sprite path ignores them.
    this.pool.reconcile(snapshot, vp, tick, camera, this.app.screen.width, this.app.screen.height);
    // Selection rings read the pool's just-computed per-entity bounds, so a building's marker sizes to its
    // actual sprite footprint (reconcile ran first, so the bounds are this frame's).
    this.selectionLayer.draw(snapshot, selection, (ref) => this.pool.boundsOf(ref));
    this.hud.draw(hud);
    this.app.render();
  }

  /** Entities drawn last frame + sprites currently pooled — for the perf overlay's on-screen readout. */
  stats(): { drawn: number; pooled: number } {
    return this.pool.stats();
  }

  /**
   * The WORLD-space bounding box of an entity's sprite as drawn last frame, or `undefined` if it wasn't
   * on screen. The app's picking uses it for an exact "click the graphic" hit test (a big building gets a
   * big box, a small one a small box) — see {@link EntityBounds}.
   */
  entityBounds(ref: number): EntityBounds | undefined {
    return this.pool.boundsOf(ref);
  }

  /** Tear down the whole retained graph + caches. */
  dispose(): void {
    this.terrain.destroy(); // frees mesh geometry the layer.destroy below would otherwise orphan
    this.mapObjects.destroy();
    this.pool.destroy(); // destroys detached (culled) entities the scene-graph walk can't reach
    this.worldLayer.destroy({ children: true });
    this.hud.destroy();
    this.textureCache.clear();
  }
}
