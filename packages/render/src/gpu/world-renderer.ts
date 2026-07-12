import type { FogView, SimEvent, WorldSnapshot } from '@vinland/sim';
import { type Application, Container, Sprite, Texture, type TextureSource } from 'pixi.js';
import { type ElevationField, makeElevationField } from '../data/elevation.js';
import { fogTileVisible } from '../data/fog.js';
import { type FogGhost, FogGhostStore } from '../data/fog-ghosts.js';
import type { Camera } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene/index.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { cameraViewport } from '../data/viewport.js';
import { BadgeLayer, type DoorBadge } from './badge-layer.js';
import { type ConstructionPlotFrame, ConstructionPlotLayer } from './construction-plot.js';
import { CombatEffectsLayer } from './effects-layer.js';
import { FogLayer } from './fog-layer.js';
import { type GeometryDebugItem, GeometryDebugLayer } from './geometry-debug.js';
import type { HudFrame } from './hud-layer.js';
import { HudLayer } from './hud-layer.js';
import type { MapObjectSprite } from './map-objects/index.js';
import { MapObjectLayer } from './map-objects/index.js';
import type { SpriteSheet, TerrainTextureSet } from './pixi-app.js';
import { type PlacementGhost, PlacementGhostLayer } from './placement-ghost.js';
import { type PlacementOverlayFrame, PlacementOverlayLayer } from './placement-overlay.js';
import { type PortraitInsetFrame, PortraitInsetLayer } from './portrait-inset.js';
import { SelectionLayer } from './selection-layer.js';
import { type EntityBounds, SpritePool } from './sprite-pool/index.js';
import { TerrainLayer } from './terrain/index.js';
import { TextureCache } from './texture-cache.js';

/** Shared empty selection so the common no-selection `update` allocates nothing. */
const NO_SELECTION: ReadonlySet<number> = new Set();
const NO_BADGES: readonly DoorBadge[] = [];

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
export const SPRITE_CULL_MARGIN = 512;

/**
 * The paused-game wash: one screen-sized multiply quad over the WORLD (not the HUD). The original's
 * effect IS pinned (OpenVikings `CWorldDisplayElement.XGui_BE_Element_Draw` + `CBitmap.Tool_Darken`):
 * while the speed global reads 0 (paused), the WORLD DISPLAY ELEMENT's clip rect gets every channel
 * halved (`value >> 1 & 0x7F7F7F`) — a neutral 50% darken, world element only (the HUD is a separate
 * element, untinted; a faithful multiply would be `0x808080`). This warmer, lighter tint is a
 * DELIBERATE deviation from that pinned grade — the user asked for a slightly BROWN paused map and
 * signed it off. One plain sprite: its distinct blend mode flushes the batcher, but it sits at the
 * world→HUD layer boundary which flushes anyway, so the cost is one extra draw call, only while
 * paused — no filter, no per-sprite work.
 */
const PAUSE_WASH_TINT = 0xc9a87c;

export class WorldRenderer {
  private readonly app: Application;
  /** Camera transform lives here; terrain + decor + sprites are its children so one transform pans/zooms all. */
  private readonly worldLayer = new Container();
  /** The shared, depth-ordered entity layer — holds BOTH pooled entities and tall map objects. */
  private readonly spriteLayer = new Container();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly mapObjects: MapObjectLayer;
  /** Entities the static map-object layer draws instead of the pool (see {@link setStaticallyDrawnRefs}). */
  private staticDrawnRefs?: ReadonlySet<number>;
  private readonly pool: SpritePool;
  /** The fog-of-war wash (world-space, over terrain + flat decor, BELOW the sprites) + the viewer's
   *  fog view it composites from ({@link updateFog}; null = fog off, the wash clears). */
  private readonly fog: FogLayer;
  private fogView: FogView | null = null;
  /** The viewer's remembered statics (buildings/resources once seen, drawn dimmed on explored
   *  ground) — refreshed on the fog view's mask generations inside {@link update}. */
  private readonly fogGhosts = new FogGhostStore();
  /** The build-mode dim wash over non-buildable tiles (world-space, BELOW the sprites). */
  private readonly placementOverlay: PlacementOverlayLayer;
  /** Grey ground plots under placed construction sites (world-space, BELOW the sprites). */
  private readonly constructionPlots = new ConstructionPlotLayer();
  /** The build-mode cursor ghost (the held building's translucent sprite, inside the sprite layer). */
  private readonly placementGhost: PlacementGhostLayer;
  /** Feet rings under the currently-selected entities (world-space, BELOW the sprites). */
  private readonly selectionLayer = new SelectionLayer();
  /** Transient combat ground marks — blood on hits, bones on deaths (world-space, BELOW the sprites so a
   *  surviving fighter draws over what it stands on). Fed by {@link ingestCombatEffects}. */
  private readonly effects = new CombatEffectsLayer();
  /** Stacked worker badges beside each staffed building's door (world-space, ABOVE the sprites). */
  private readonly badgeLayer = new BadgeLayer();
  /** The `?debug=geometry` footprint overlay (world-space, ABOVE the sprites — it annotates them). */
  private readonly geometryDebug = new GeometryDebugLayer();
  private readonly hud = new HudLayer();
  /** The paused-game sepia wash (screen-space, over the world, under the HUD). See {@link setPaused}. */
  private readonly pauseWash = new Sprite(Texture.WHITE);
  /** The current map's terrain-height field — lifts the ground mesh + every projected item, and its
   *  `maxLift` is the cull pad. Flat (zero lift) until {@link setTerrain} loads a map carrying `elevation`. */
  private elevation: ElevationField = makeElevationField(undefined, 0, 0);
  /** The details-panel portrait "observation window" — a live cutout of the world re-aimed at the selected
   *  entity, rendered into the panel's box each frame (its own second {@link worldLayer} render). See
   *  {@link PortraitInsetLayer}. */
  private readonly portrait: PortraitInsetLayer;

  constructor(app: Application, opts?: { readonly sheet?: SpriteSheet | undefined }) {
    this.app = app;
    this.spriteLayer.sortableChildren = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.pool = new SpritePool(this.spriteLayer, this.textureCache, opts?.sheet);
    this.portrait = new PortraitInsetLayer(app, this.worldLayer, this.pool);
    this.fog = new FogLayer();
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the DEPTH-SORTED sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(opts?.sheet, this.textureCache);
    this.spriteLayer.addChild(this.placementGhost.container);
    // Z-order within the world layer: terrain (back) → flat decor → build-placement wash → selection
    // rings → bones (ground litter) → sprites + tall objects → blood spurts → door badges (front). The
    // wash + rings + bones sit under the sprites so a house/tree/unit in front draws over them (the wash
    // dims the ground, bones are litter under a fighter's feet); blood + door badges sit OVER the sprites
    // so a hit spurt shows on the struck body and a worker marker floats above its building.
    this.worldLayer.addChild(this.terrain.container);
    this.worldLayer.addChild(this.mapObjects.decorContainer);
    // The fog wash covers the ground + flat decor and sits UNDER everything gameplay-drawn: entities
    // on fogged ground are individually fog-culled (pool + tall objects), so nothing legitimate draws
    // above the wash inside the fog.
    this.worldLayer.addChild(this.fog.container);
    this.worldLayer.addChild(this.constructionPlots.container);
    this.worldLayer.addChild(this.placementOverlay.container);
    this.worldLayer.addChild(this.selectionLayer.container);
    // Bones sit UNDER the sprites (ground litter a surviving unit walks over); blood sits OVER them (the
    // spurt shows ON the struck body). Two containers straddling the sprite layer, one effects layer.
    this.worldLayer.addChild(this.effects.groundContainer);
    this.worldLayer.addChild(this.spriteLayer);
    this.worldLayer.addChild(this.effects.overlayContainer);
    this.worldLayer.addChild(this.badgeLayer.container);
    this.worldLayer.addChild(this.geometryDebug.container);
    app.stage.addChild(this.worldLayer);
    // The pause wash sits ABOVE the world and BELOW the HUD (stage order), so pausing browns the map
    // but never the always-on HUD or the tool panel (both are later stage children).
    this.pauseWash.tint = PAUSE_WASH_TINT;
    this.pauseWash.blendMode = 'multiply';
    this.pauseWash.visible = false;
    app.stage.addChild(this.pauseWash);
    // The HUD is pinned (NOT under the camera), so it's a direct child of the stage.
    app.stage.addChild(this.hud.container);
    // The portrait observation window sits over everything (it fills the details panel's box hole); the
    // layer mounts its own stage-child sprite and re-raises it above the frequently-rebuilt panel each
    // frame it shows — see {@link PortraitInsetLayer}.
  }

  /** Show/hide the paused-game wash — the app's loop control drives this alongside the sim pause. */
  setPaused(paused: boolean): void {
    this.pauseWash.visible = paused;
  }

  /**
   * Set (or clear) the fog-of-war view for THIS frame — the viewer player's per-cell visibility mask
   * (`Simulation.fogView`, plain data + one pure accessor). Drives three things inside the next
   * {@link update}: the fog wash over the ground ({@link FogLayer}), the sprite pool's fog cull
   * (entities on non-visible ground don't draw), and the tall map-object gate (trees/stones in fog
   * vanish). `null` = fog off — every layer reverts to its pre-fog behaviour. Call each frame like
   * {@link updatePlacementOverlay}; the wash itself re-composites only when band/generation move.
   */
  updateFog(view: FogView | null): void {
    this.fogView = view;
  }

  /**
   * (Re)build the cached terrain from a grid — call ONCE per map (a terrain edit re-invalidates). With
   * `textures` it draws the textured ground mesh; without them the flat placeholder ground. See {@link TerrainLayer}.
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
   * Feed this frame's sim events (accumulated across every fixed-timestep sub-step) into the combat-marks
   * layer: a landed blow leaves blood, a death leaves bones. Call BEFORE {@link update} each frame (the
   * marks are drawn inside it). `tick` is the current sim tick — marks decay against it, so a paused game
   * or a `?shot` capture reproduces exactly. A frame with no combat events is nearly free.
   */
  ingestCombatEffects(events: readonly SimEvent[], tick: number): void {
    this.effects.ingest(events, tick);
  }

  /**
   * Provide (or clear) the decoded bone-pile art so a death draws the REAL `cadaver human bones` sprite
   * instead of the procedural pile — the app resolves the atlas `source` + interchangeable `frames`
   * (`ls_skeletons.bmd`), the renderer supplies its shared frame→texture cache. `null` reverts to procedural
   * (a checkout without `content/`). `scale` defaults to the native landscape-object scale (1).
   */
  setCombatBonesGfx(
    gfx: {
      readonly source: TextureSource;
      readonly frames: readonly AtlasFrame[];
      readonly scale?: number;
    } | null,
  ): void {
    this.effects.setBonesGfx(
      gfx === null ? undefined : { ...gfx, scale: gfx.scale ?? 1, textures: this.textureCache },
    );
  }

  /**
   * Remove ONE placed landscape object from the retained static layer — the `?map=` entry's handover
   * seam: the moment a virgin resource node is first worked (felled/mined/picked), its built-once
   * static quad/sprite comes out and the live sprite pool draws the entity from then on (shrinking
   * levels, vanishing on destroy). A no-op for an object the layer doesn't hold.
   */
  removeMapObject(obj: MapObjectSprite): void {
    this.mapObjects.remove(obj);
  }

  /**
   * Remember entity `ref` as a fog ghost even if its ground is not currently visible — the other half
   * of the {@link removeMapObject} handover: a virgin node first worked UNDER the viewer's fog leaves
   * the static layer (which was its de-facto ghost) for the fog-culled sprite pool, so without this
   * adoption its remembered look would vanish from explored ground. Queued until the next mask
   * rebuild; harmless while fog is off (a fresh fog start re-explores from scratch anyway).
   */
  adoptFogGhost(ref: number): void {
    this.fogGhosts.adopt(ref);
  }

  /**
   * Name the entities the retained static map-object layer draws instead of the sprite pool (a decoded
   * map's virgin resource nodes). The pool's per-frame scene build skips them entirely. LIVE-VIEW
   * contract: the renderer holds the REFERENCE and reads it each frame — the caller mutates the same
   * set in place as nodes are first worked (its event handler runs before the frame's draw, so a
   * mid-frame mutation cannot be observed) and never needs to re-pass it.
   */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticDrawnRefs = refs;
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
    doorBadges: readonly DoorBadge[] = NO_BADGES,
    flagged: ReadonlySet<number> = NO_SELECTION,
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
    // Fog-of-war: recomposite the wash (band/generation-keyed — usually a no-op) and build this
    // frame's cull predicates for the tall objects + the sprite pool below. Both close over the same
    // FogView, so the wash, the trees and the entities can never disagree about a cell.
    const fogView = this.fogView;
    this.fog.update(fogView, vp);
    // The ghost memory refreshes on the fog view's mask generations (cheap per frame otherwise);
    // fog OFF clears it — the sim resets exploration history the same way.
    let ghosts: readonly FogGhost[] | undefined;
    if (fogView === null) {
      this.fogGhosts.clear();
    } else {
      ghosts = this.fogGhosts.update(snapshot, fogView, this.staticDrawnRefs);
    }
    this.mapObjects.update(
      vp,
      tick,
      fogView === null ? undefined : (cellX, cellY) => fogView.stateAt(cellX, cellY),
    );
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
      ...(this.staticDrawnRefs !== undefined ? { staticRefs: this.staticDrawnRefs } : {}),
      ...(fogView !== null
        ? { fogVisible: (tx: number, ty: number) => fogTileVisible(fogView, tx, ty) }
        : {}),
      ...(ghosts !== undefined && ghosts.length > 0 ? { ghosts } : {}),
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
      flagged,
    );
    // Combat ground marks: reposition + fade the blood/bones fed by `ingestCombatEffects`, culled to the
    // same viewport as the sprites so a battlefield's litter cost tracks the screen, not the casualty count.
    // Fed INTERPOLATED render time (`tick + alpha`) so the blood-fall animation and fades are smooth at any
    // frame rate; the fold's decay membership uses the integer sim tick from `ingest`, so this stays render-only.
    this.effects.draw(this.elevation, vp, tick + alpha);
    // Door badges float over the buildings: the app tallies each building's bound workers + projects its
    // door node, this layer stacks one placeholder square per worker (craftsman / carrier / gatherer,
    // colour-coded) above the door. Culled to the same viewport as the sprites so the per-frame cost of a
    // map full of staffed buildings tracks the screen.
    this.badgeLayer.draw(doorBadges, this.elevation, vp);
    if (this.pauseWash.visible) {
      this.pauseWash.width = this.app.screen.width;
      this.pauseWash.height = this.app.screen.height;
    }
    this.hud.draw(hud);
    // The portrait inset is a SECOND render of the world (re-aimed at the selected unit) into the panel's
    // box texture — must run after the pool reconcile above (so it uses this frame's positions) and before
    // the main stage render below (so the on-stage inset sprite shows this frame's cutout).
    this.portrait.draw(camera);
    this.app.render();
  }

  /**
   * Set (or clear) the details-panel portrait "observation window" — a live cutout of the world centred on
   * the selected entity, rendered into the panel's box each frame. The app passes the box rect + entity ref
   * each frame (null when the selection has no portrait — multi-select, a building-less pick, nothing); the
   * actual second render happens in {@link update} (via {@link PortraitInsetLayer.draw}), just before the
   * main stage render.
   */
  setPortraitInset(frame: PortraitInsetFrame | null): void {
    this.portrait.set(frame);
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
   * Set the grey ground plots under placed construction sites (the "plac budowy" decal) — the app passes
   * every under-construction building's footprint cells (`Simulation.constructionPlots`) each frame; an
   * empty list clears them. The layer skips the redraw when the plot set is unchanged. Takes effect on the
   * next {@link update}'s single `render`.
   */
  updateConstructionPlots(plots: readonly ConstructionPlotFrame[]): void {
    this.constructionPlots.set(plots, this.elevation);
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

  /**
   * Pixel-accurate refinement of {@link entityBounds}: whether the WORLD-px point lands on a SOLID
   * texel of the entity's drawn sprite, `undefined` when no exact answer exists (not drawn, paletted
   * mesh, unreadable atlas) — the caller then keeps the box verdict. See `SpritePool.pixelHit`.
   */
  entityPixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return this.pool.pixelHit(ref, wx, wy);
  }

  /**
   * Set (or clear) the `?debug=geometry` overlay — every placed building's logic geometry (collision
   * cells, build-exclusion zone, door node, worker-icon anchor) drawn over the world as plain data
   * the app computed from sim content. Rebuilt only when the building set changes, never per frame.
   */
  setGeometryDebug(items: readonly GeometryDebugItem[] | null): void {
    this.geometryDebug.set(items, this.elevation);
  }

  /** Tear down the whole retained graph + caches. */
  dispose(): void {
    this.terrain.destroy(); // frees mesh geometry the layer.destroy below would otherwise orphan
    this.mapObjects.destroy();
    this.pool.destroy(); // destroys detached (culled) entities the scene-graph walk can't reach
    this.fog.destroy();
    this.placementOverlay.destroy();
    this.constructionPlots.destroy();
    this.placementGhost.destroy();
    this.geometryDebug.destroy();
    this.worldLayer.destroy({ children: true });
    this.pauseWash.destroy(); // the shared Texture.WHITE itself is left alone
    this.hud.destroy();
    this.portrait.destroy();
    this.textureCache.clear();
  }
}
