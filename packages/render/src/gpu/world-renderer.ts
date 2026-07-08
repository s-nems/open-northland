import type { WorldSnapshot } from '@vinland/sim';
import { type Application, Container } from 'pixi.js';
import { type ElevationField, makeElevationField } from '../data/elevation.js';
import type { Camera } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene/index.js';
import { cameraViewport } from '../data/viewport.js';
import { HudLayer } from './hud-layer.js';
import type { HudFrame } from './hud-layer.js';
import { MapObjectLayer } from './map-objects/index.js';
import type { MapObjectSprite } from './map-objects/index.js';
import type { SpriteSheet, TerrainTextureSet } from './pixi-app.js';
import { type PlacementGhost, PlacementGhostLayer } from './placement-ghost.js';
import { type PlacementOverlayFrame, PlacementOverlayLayer } from './placement-overlay.js';
import { SelectionLayer } from './selection-layer.js';
import { type EntityBounds, SpritePool } from './sprite-pool/index.js';
import { TerrainLayer } from './terrain/index.js';
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
 * `ScreenMap` — that makes the QUERY O(visible) is a future seam, see `AGENTS.md`).
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
  /** The build-mode dim wash over non-buildable tiles (world-space, BELOW the sprites). */
  private readonly placementOverlay: PlacementOverlayLayer;
  /** The build-mode cursor ghost (the held building's translucent sprite, inside the sprite layer). */
  private readonly placementGhost: PlacementGhostLayer;
  /** Feet rings under the currently-selected entities (world-space, BELOW the sprites). */
  private readonly selectionLayer = new SelectionLayer();
  private readonly hud = new HudLayer();
  /** The current map's terrain-height field — lifts the ground mesh + every projected item, and its
   *  `maxLift` is the cull pad. Flat (zero lift) until {@link setTerrain} loads a map carrying `elevation`. */
  private elevation: ElevationField = makeElevationField(undefined, 0, 0);

  constructor(app: Application, opts?: { readonly sheet?: SpriteSheet | undefined }) {
    this.app = app;
    this.spriteLayer.sortableChildren = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.pool = new SpritePool(this.spriteLayer, this.textureCache, opts?.sheet);
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the DEPTH-SORTED sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(opts?.sheet, this.textureCache);
    this.spriteLayer.addChild(this.placementGhost.container);
    // Z-order within the world layer: terrain (back) → flat decor → build-placement wash → selection
    // rings → sprites + tall objects (front). The wash + rings sit under the sprites so a house/tree/unit
    // in front draws over them (the wash dims the ground, not the sprites standing on it).
    this.worldLayer.addChild(this.terrain.container);
    this.worldLayer.addChild(this.mapObjects.decorContainer);
    this.worldLayer.addChild(this.placementOverlay.container);
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
    // Build the height field ONCE per map (from the `lmhe` lane, or flat when absent). The terrain mesh
    // bakes the lift now; the sprite pool + the cull pad read it each frame in {@link update}. The
    // `terrain.brightness` lane is consumed inside {@link TerrainLayer.set} (it shades the GROUND);
    // landscape objects get their own anchor-cell multiplier upstream in the app loader (trees exempt
    // — the measured split, `data/brightness.ts`), and buildings/settlers are unmeasured + unshaded.
    this.elevation = makeElevationField(terrain.elevation, terrain.width, terrain.height);
    this.terrain.set(terrain, textures, this.elevation);
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
   * projected to feet rings; it is transient view state like the camera, never sim state. `alpha` is
   * the fixed-timestep interpolation fraction (the app loop's `FixedTimestep.advance` return): the
   * pool draws each entity `alpha` of the way from its previous tick anchor to its current one, so
   * 20 Hz sim motion reads as continuous frame-rate motion; the default 1 draws raw tick positions
   * (the static `?shot` entry).
   */
  update(
    snapshot: WorldSnapshot,
    camera: Camera,
    tick = 0,
    hud?: HudFrame,
    selection: ReadonlySet<number> = NO_SELECTION,
    alpha = 1,
  ): void {
    // Camera: the world layer's own transform (screen = world*scale + offset).
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);
    // Cull to the framed viewport (grown to cover tall sprites). Elevation lifts ground + sprites UP by
    // up to `maxLift`, but their cull ANCHORS/AABBs stay pre-lift, so grow the box by `maxLift` too or a
    // chunk/sprite baked up a hill would pop at the screen edge (the map-wide-max pad, computed once).
    // Fully zoomed out, this still passes everything through and leans on GPU batching.
    const vp = cameraViewport(
      camera,
      this.app.screen.width,
      this.app.screen.height,
      SPRITE_CULL_MARGIN + this.elevation.maxLift,
    );
    this.terrain.cull(vp);
    this.mapObjects.update(vp, tick);
    // The pool needs the camera + canvas size to place team-colour PalettedSprite meshes (screen-space,
    // they can't ride the worldLayer transform); the plain-sprite path ignores them. The elevation field
    // lets it lift each entity's DRAWN feet without disturbing its pre-lift depth key; `alpha` lerps
    // each entity between its last two tick anchors.
    this.pool.reconcile({
      snapshot,
      viewport: vp,
      tick,
      camera,
      screenW: this.app.screen.width,
      screenH: this.app.screen.height,
      elevation: this.elevation,
      alpha,
    });
    // Selection rings read the pool's just-computed per-entity bounds + drawn (lerped, lifted) anchors,
    // so a building's marker sizes to its actual sprite footprint and a moving unit's ring glides with
    // the interpolated bob (reconcile ran first, so both are this frame's); the elevation field covers
    // the culled-entity fallback.
    this.selectionLayer.draw(
      snapshot,
      selection,
      (ref) => this.pool.boundsOf(ref),
      this.elevation,
      (ref) => this.pool.anchorOf(ref),
    );
    this.hud.draw(hud);
    this.app.render();
  }

  /**
   * Set (or clear) the BUILD-PLACEMENT dim wash — the visible tile band with the cells a held building
   * can't anchor on, decided by the sim's placement probe and passed in as plain data. Called each
   * frame while build mode is active and once with `null` when it ends; the layer skips the composite
   * when the frame is unchanged. Takes effect on the next {@link update}'s single `render`.
   */
  updatePlacementOverlay(frame: PlacementOverlayFrame | null): void {
    this.placementOverlay.set(frame, this.elevation);
  }

  /**
   * Set (or clear) the BUILD-PLACEMENT cursor ghost — the held building's translucent sprite at the
   * hovered tile. The app passes `null` when not in build mode, when the cursor is off the map/HUD, or
   * when the hovered anchor is REJECTED by the placement probe (the original hides the house cursor
   * over blocked ground).
   */
  updatePlacementGhost(ghost: PlacementGhost | null): void {
    this.placementGhost.set(ghost, this.elevation);
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
    this.placementOverlay.destroy();
    this.placementGhost.destroy();
    this.worldLayer.destroy({ children: true });
    this.hud.destroy();
    this.textureCache.clear();
  }
}
