import type { FogView, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Sprite, Texture, type TextureSource } from 'pixi.js';
import type { BrightnessField } from '../data/brightness.js';
import { type ElevationField, makeElevationField } from '../data/elevation.js';
import { fogTileVisible } from '../data/fog.js';
import { type FogGhost, FogGhostStore } from '../data/fog-ghosts.js';
import { type Camera, snapCameraToDevicePixels } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene/index.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { cameraViewport } from '../data/viewport.js';
import type { MapObjectSprite } from './map-objects/index.js';
import { MapObjectLayer } from './map-objects/index.js';
import {
  BadgeLayer,
  CombatEffectsLayer,
  type ConstructionPlotFrame,
  ConstructionPlotLayer,
  type DoorBadge,
  FogLayer,
  type GeometryDebugItem,
  GeometryDebugLayer,
  type HudFrame,
  HudLayer,
  type PlacementGhost,
  PlacementGhostLayer,
  type PlacementOverlayFrame,
  PlacementOverlayLayer,
  type PortraitInsetFrame,
  PortraitInsetLayer,
  SelectionLayer,
} from './overlays/index.js';
import { type EntityBounds, SpritePool } from './sprite-pool/index.js';
import type { SpriteSheet } from './sprite-sheet.js';
import { TerrainLayer } from './terrain/index.js';
import type { TerrainTextureSet } from './terrain-textures.js';
import { TextureCache } from './texture-cache.js';

/** One candidate building's workplace-assignment verdict: its entity id and whether the selected settler
 *  can be assigned there (green) or not (red). Fed to {@link WorldRenderer.setBuildingHighlight}. */
export interface BuildingHighlightItem {
  readonly id: number;
  readonly ok: boolean;
}

/** Construction options of a {@link WorldRenderer}. */
export interface WorldRendererOptions {
  /** The loaded bob atlas + bindings; `undefined` draws placeholder geometry for every entity. */
  readonly sheet?: SpriteSheet | undefined;
  /**
   * Interactive view smoothing: snap the camera pan to whole device pixels (nearest-sampled art
   * shimmer-crawls on fractional-pixel pans) and switch the world atlases to linear minification while
   * zoomed out below 1 (nearest minification sparkles). For the live entries only — the deterministic
   * `?shot` capture must stay byte-stable, so it never enables this.
   */
  readonly viewSmoothing?: boolean | undefined;
}

/** Shared empty highlight so clearing the assign-mode tint allocates nothing. */
const EMPTY_HIGHLIGHT: ReadonlyMap<number, boolean> = new Map();

/** Shared empty selection so the common no-selection `update` allocates nothing. */
const NO_SELECTION: ReadonlySet<number> = new Set();
const NO_BADGES: readonly DoorBadge[] = [];

/**
 * The per-frame inputs of {@link WorldRenderer.update}, named rather than positional so the
 * same-typed `selection`/`flagged` sets cannot be swapped silently. Mirrors the
 * {@link import('./sprite-pool/index.js').SpritePool}'s `PoolFrame`: only `snapshot` + `camera` are
 * required, everything else falls back to its transient-view default.
 */
export interface WorldFrame {
  readonly snapshot: WorldSnapshot;
  /** The world layer's own transform (screen = world*scale + offset). */
  readonly camera: Camera;
  /** The integer sim tick the snapshot is at — the animation clock for gaits/rotors/decor (default 0). */
  readonly tick?: number | undefined;
  /** The HUD text frame to repaint, or absent to leave the HUD unchanged. */
  readonly hud?: HudFrame | undefined;
  /** The app's currently-selected entity ids, projected to feet rings (default none). Transient view state. */
  readonly selection?: ReadonlySet<number> | undefined;
  /** The fixed-timestep interpolation fraction (the loop's `FixedTimestep.advance` return): each entity
   *  draws `alpha` of the way from its previous tick anchor to its current one (default 1 = raw tick). */
  readonly alpha?: number | undefined;
  /** Per-building door-badge tallies to stack over each door (default none). */
  readonly doorBadges?: readonly DoorBadge[] | undefined;
  /** The work-flagged gatherer ids whose feet rings read as flagged (default none). */
  readonly flagged?: ReadonlySet<number> | undefined;
}

/**
 * The retained-mode world renderer — a thin orchestrator over the sub-layers it composes. It owns a
 * persistent scene graph (never immediate mode; see the package `AGENTS.md`), split across four
 * sub-layers each owning its slice of state:
 *  - {@link TerrainLayer} — the ground, meshed once and drawn per visible block;
 *  - {@link MapObjectLayer} — the decoded map's decor (batched meshes) + tall objects (pooled sprites);
 *  - {@link SpritePool} — a display object per entity, keyed by id and reused across frames;
 *  - {@link HudLayer} — the pinned overlay.
 * A shared {@link TextureCache} memoizes frame→texture across them, and the tall objects + pooled
 * entities share one depth-sorted `spriteLayer` so they interleave in a single painter order. Per frame
 * the *drawn* work is O(visible) with near-zero allocation; the cull itself is still an O(entities)
 * visibility pass (a spatial index making the query O(visible) is a future seam, see `AGENTS.md`).
 *
 * Pixels need a human. The data decisions it consumes are unit-tested upstream: the depth-sorted draw
 * list (`buildSpriteScene`), the frame selection (`resolveSpriteBobId`/`resolveBuildingDraw`), and the
 * cull math (`viewport.ts`).
 */

/**
 * World-space slack (px) the sprite cull box is grown by on every side, so a tall sprite whose feet are
 * just off-screen but whose body pokes into view still draws (culling is by the feet anchor). Covers the
 * tallest scaled building or map object; still small next to a real map (≈8 tiles), so culling bites.
 */
export const SPRITE_CULL_MARGIN = 512;

/**
 * The paused-game wash: one screen-sized multiply quad over the world, not the HUD. The original's
 * observed pause treatment is a neutral 50% darken; this warmer brown is an intentional visual
 * deviation. It costs one extra draw call while paused, but it sits at the
 * world→HUD boundary, which flushes anyway.
 */
const PAUSE_WASH_TINT = 0xc9a87c;

export class WorldRenderer {
  private readonly app: Application;
  /** Camera transform lives here; terrain + decor + sprites are its children so one transform pans/zooms all. */
  private readonly worldLayer = new Container();
  /** The shared, depth-ordered entity layer — holds both pooled entities and tall map objects. */
  private readonly spriteLayer = new Container();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly mapObjects: MapObjectLayer;
  /** Entities the static map-object layer draws instead of the pool (see {@link setStaticallyDrawnRefs}). */
  private staticDrawnRefs?: ReadonlySet<number>;
  private readonly pool: SpritePool;
  /** The fog-of-war wash (world-space, over terrain + flat decor, below the sprites) + the viewer's
   *  fog view it composites from ({@link updateFog}; null = fog off, the wash clears). */
  private readonly fog: FogLayer;
  private fogView: FogView | null = null;
  /** The viewer's remembered statics (buildings/resources once seen, drawn dimmed on explored
   *  ground) — refreshed on the fog view's mask generations inside {@link update}. */
  private readonly fogGhosts = new FogGhostStore();
  /** The build-mode dim wash over non-buildable tiles (world-space, below the sprites). */
  private readonly placementOverlay: PlacementOverlayLayer;
  /** Grey ground plots under placed construction sites (world-space, below the sprites). */
  private readonly constructionPlots = new ConstructionPlotLayer();
  /** The build-mode cursor ghost (the held building's translucent sprite, inside the sprite layer). */
  private readonly placementGhost: PlacementGhostLayer;
  /** Feet rings under the currently-selected entities (world-space, below the sprites). */
  private readonly selectionLayer = new SelectionLayer();
  /** Transient combat ground marks — blood on hits, bones on deaths (world-space, below the sprites so a
   *  surviving fighter draws over what it stands on). Fed by {@link ingestCombatEffects}. */
  private readonly effects = new CombatEffectsLayer();
  /** Stacked worker badges beside each staffed building's door (world-space, above the sprites). */
  private readonly badgeLayer = new BadgeLayer();
  /** The `?debug=geometry` footprint overlay (world-space, above the sprites — it annotates them). */
  private readonly geometryDebug = new GeometryDebugLayer();
  /** The workplace-assignment highlight: candidate building id → assignable (green) / not (red), while the
   *  player is choosing a workplace for the selected settler. Applied as a soft tint on the building sprite
   *  itself (not a cell wash), so the building reads "lekko zielony / lekko czerwony". See {@link setBuildingHighlight}. */
  private highlight: ReadonlyMap<number, boolean> = new Map();
  private readonly hud = new HudLayer();
  /** The paused-game sepia wash (screen-space, over the world, under the HUD). See {@link setPaused}. */
  private readonly pauseWash = new Sprite(Texture.WHITE);
  /** The current map's terrain-height field — lifts the ground mesh + every projected item, and its
   *  `maxLift` is the cull pad. Flat (zero lift) until {@link setTerrain} loads a map carrying `elevation`. */
  private elevation: ElevationField = makeElevationField(undefined, 0, 0);
  /** The composed terrain-shading field the ground drew with ({@link TerrainLayer.brightnessField}) —
   *  handed to the sprite pool so entities sit in the same light. Neutral until {@link setTerrain}. */
  private brightness: BrightnessField | undefined;
  /** The details-panel portrait "observation window" — a live cutout of the world re-aimed at the selected
   *  entity, rendered into the panel's box each frame (its own second {@link worldLayer} render). See
   *  {@link PortraitInsetLayer}. */
  private readonly portrait: PortraitInsetLayer;

  /** Interactive view smoothing ({@link WorldRendererOptions.viewSmoothing}). */
  private readonly viewSmoothing: boolean;
  /** Atlas pages currently flipped to linear minification by {@link applyWorldSampling} — exactly the
   *  set to restore to nearest when the camera zooms back in. */
  private readonly linearPages = new Set<TextureSource>();

  constructor(app: Application, opts?: WorldRendererOptions) {
    this.app = app;
    this.viewSmoothing = opts?.viewSmoothing === true;
    this.spriteLayer.sortableChildren = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.pool = new SpritePool(this.spriteLayer, this.textureCache, opts?.sheet);
    this.portrait = new PortraitInsetLayer(app, this.worldLayer, this.pool);
    this.fog = new FogLayer();
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the depth-sorted sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(opts?.sheet, this.textureCache);
    this.spriteLayer.addChild(this.placementGhost.container);
    // Z-order within the world layer: terrain (back) → flat decor → build-placement wash → selection
    // rings → bones (ground litter) → sprites + tall objects → blood spurts → door badges (front).
    // Ground-level marks sit under the sprites so a house/tree/unit in front draws over them; blood and
    // door badges sit over them so a spurt shows on the struck body and a marker floats above its building.
    this.worldLayer.addChild(this.terrain.container);
    this.worldLayer.addChild(this.mapObjects.decorContainer);
    // The fog wash covers the ground + flat decor and sits under everything gameplay-drawn: entities
    // on fogged ground are individually fog-culled (pool + tall objects), so nothing legitimate draws
    // above the wash inside the fog.
    this.worldLayer.addChild(this.fog.container);
    this.worldLayer.addChild(this.constructionPlots.container);
    this.worldLayer.addChild(this.placementOverlay.container);
    this.worldLayer.addChild(this.selectionLayer.container);
    // Two containers straddling the sprite layer, one effects layer: bones below, blood above.
    this.worldLayer.addChild(this.effects.groundContainer);
    this.worldLayer.addChild(this.spriteLayer);
    this.worldLayer.addChild(this.effects.overlayContainer);
    this.worldLayer.addChild(this.badgeLayer.container);
    this.worldLayer.addChild(this.geometryDebug.container);
    app.stage.addChild(this.worldLayer);
    // The pause wash sits above the world and below the HUD (stage order), so pausing browns the map
    // but never the always-on HUD or the tool panel (both are later stage children).
    this.pauseWash.tint = PAUSE_WASH_TINT;
    this.pauseWash.blendMode = 'multiply';
    this.pauseWash.visible = false;
    app.stage.addChild(this.pauseWash);
    // The HUD is pinned (not under the camera), so it's a direct child of the stage.
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
   * Match the world atlases' minification to the zoom: below scale 1 nearest sampling drops texels and
   * the zoomed-out world sparkles while panning, so the texture-cache pages (RGB bob + shadow atlases —
   * never the indexed character sheets, which don't pass through the cache) flip to linear; at scale ≥ 1
   * exactly the flipped set restores to nearest, keeping magnified pixel art crisp. O(new pages) per
   * frame — already-flipped pages are skipped via {@link linearPages}.
   */
  private applyWorldSampling(scale: number): void {
    if (scale < 1) {
      for (const source of this.textureCache.pageSources()) {
        if (this.linearPages.has(source)) continue;
        if (source.scaleMode !== 'nearest') continue; // a page someone loaded linear stays theirs
        source.scaleMode = 'linear';
        this.linearPages.add(source);
      }
    } else if (this.linearPages.size > 0) {
      for (const source of this.linearPages) source.scaleMode = 'nearest';
      this.linearPages.clear();
    }
  }

  /**
   * Set (or clear) this frame's fog-of-war view — the viewer player's per-cell visibility mask
   * (`Simulation.fogView`). Drives three things inside the next {@link update}: the fog wash over the
   * ground ({@link FogLayer}), the sprite pool's fog cull, and the tall map-object gate. `null` = fog
   * off, every layer reverts to its pre-fog behaviour. Call each frame; the wash itself re-composites
   * only when band/generation move.
   */
  updateFog(view: FogView | null): void {
    this.fogView = view;
  }

  /**
   * (Re)build the cached terrain from a grid — call once per map (a terrain edit re-invalidates). With
   * `textures` it draws the textured ground mesh; without them the flat placeholder ground. See {@link TerrainLayer}.
   */
  setTerrain(terrain: SceneTerrain, textures?: TerrainTextureSet): void {
    // Build the height field once per map (from the `lmhe` lane, or flat when absent). The terrain mesh
    // bakes the lift now; the sprite pool + the cull pad read it each frame in {@link update}. The
    // composed shading lane (`embr` + hillshade) shades the ground inside {@link TerrainLayer.set};
    // landscape objects get their own anchor-cell multiplier upstream in the app loader (trees exempt —
    // the measured split, `data/brightness.ts`), and entity sprites read the same composed field at
    // their feet through the pool (`DrawItem.shade`).
    this.elevation = makeElevationField(terrain.elevation, terrain.width, terrain.height);
    this.terrain.set(terrain, textures, this.elevation);
    const field = this.terrain.brightnessField();
    this.brightness = field.shaded ? field : undefined;
  }

  /**
   * (Re)build the retained landscape-object layers from a decoded map's placements — call once per map,
   * like {@link setTerrain}. See {@link MapObjectLayer}.
   */
  setMapObjects(objects: readonly MapObjectSprite[]): void {
    this.mapObjects.set(objects);
  }

  /**
   * Feed this frame's sim events (accumulated across every fixed-timestep sub-step) into the combat-marks
   * layer: a landed blow leaves blood, a death leaves bones. Call before {@link update} each frame, which
   * draws the marks. `tick` is the current sim tick — marks decay against it, so a paused game or a
   * `?shot` capture reproduces exactly.
   */
  ingestCombatEffects(events: readonly SimEvent[], tick: number): void {
    this.effects.ingest(events, tick);
  }

  /**
   * Provide (or clear) the decoded bone-pile art so a death draws the `cadaver human bones` sprite
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
   * Remove one placed landscape object from the retained static layer — the handover seam: the moment a
   * virgin resource node is first worked (felled/mined/picked), its built-once static quad/sprite comes
   * out and the live sprite pool draws the entity from then on (shrinking levels, vanishing on destroy).
   * A no-op for an object the layer doesn't hold.
   */
  removeMapObject(obj: MapObjectSprite): void {
    this.mapObjects.remove(obj);
  }

  /**
   * Remember entity `ref` as a fog ghost even if its ground is not currently visible — the other half
   * of the {@link removeMapObject} handover: a virgin node first worked under the viewer's fog leaves
   * the static layer (its de-facto ghost) for the fog-culled sprite pool, so without this adoption its
   * remembered look would vanish from explored ground. Queued until the next mask rebuild; harmless
   * while fog is off (a fresh fog start re-explores from scratch anyway).
   */
  adoptFogGhost(ref: number): void {
    this.fogGhosts.adopt(ref);
  }

  /**
   * Name the entities the retained static map-object layer draws instead of the sprite pool (a decoded
   * map's virgin resource nodes). The pool's per-frame scene build skips them entirely. Live-view
   * contract: the renderer holds the reference and reads it each frame — the caller mutates the same
   * set in place as nodes are first worked (its event handler runs before the frame's draw, so a
   * mid-frame mutation cannot be observed) and never needs to re-pass it.
   */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticDrawnRefs = refs;
  }

  /**
   * Draw one frame: apply the camera, cull the terrain, advance the map objects, reconcile the sprite
   * pool to the (culled, depth-sorted) list, draw the selection rings, repaint the HUD, and render once.
   * No allocation in the steady state — the sub-layers update in place; only a first-seen entity or a
   * growing layer set mints. `selection` is transient view state like the camera, never sim state.
   * `alpha` is the fixed-timestep interpolation fraction (the app loop's `FixedTimestep.advance`
   * return): the pool draws each entity `alpha` of the way from its previous tick anchor to its current
   * one, so 12 Hz sim motion reads as continuous frame-rate motion; the default 1 draws raw tick
   * positions (the static `?shot` entry).
   */
  update(frame: WorldFrame): void {
    const {
      snapshot,
      tick = 0,
      hud,
      selection = NO_SELECTION,
      alpha = 1,
      doorBadges = NO_BADGES,
      flagged = NO_SELECTION,
    } = frame;
    // View smoothing: pin the pan to whole device pixels (kills nearest-sampling shimmer-crawl) and
    // linear-minify the world atlases when zoomed out (below). The deterministic `?shot` renderer is
    // constructed without it, so its bytes never move.
    const camera = this.viewSmoothing
      ? snapCameraToDevicePixels(frame.camera, this.app.renderer.resolution)
      : frame.camera;
    if (this.viewSmoothing) this.applyWorldSampling(camera.scale ?? 1);
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);
    // Cull to the framed viewport (grown to cover tall sprites). Elevation lifts ground + sprites up by
    // up to `maxLift`, but their cull anchors/AABBs stay pre-lift, so grow the box by `maxLift` too or a
    // chunk/sprite baked up a hill would pop at the screen edge (the map-wide-max pad, computed once).
    const vp = cameraViewport(
      camera,
      this.app.screen.width,
      this.app.screen.height,
      SPRITE_CULL_MARGIN + this.elevation.maxLift,
    );
    this.terrain.cull(vp);
    // Recomposite the fog wash (band/generation-keyed — usually a no-op) and build this frame's cull
    // predicates for the tall objects + the sprite pool below. Both close over the same FogView, so the
    // wash, the trees and the entities can never disagree about a cell.
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
    // lets it lift each entity's drawn feet without disturbing its pre-lift depth key; `alpha` lerps
    // each entity between its last two tick anchors.
    // The portrait's subject is force-drawn through the cull so its cutout survives off-screen / inside a
    // building; setPortraitInset ran before this update, so the ref is this frame's.
    const portraitRef = this.portrait.subjectRef();
    this.pool.reconcile({
      snapshot,
      viewport: vp,
      tick,
      camera,
      screenW: this.app.screen.width,
      screenH: this.app.screen.height,
      elevation: this.elevation,
      alpha,
      ...(this.brightness !== undefined ? { brightness: this.brightness } : {}),
      ...(this.highlight.size > 0 ? { highlight: this.highlight } : {}),
      ...(this.staticDrawnRefs !== undefined ? { staticRefs: this.staticDrawnRefs } : {}),
      ...(fogView !== null
        ? { fogVisible: (tx: number, ty: number) => fogTileVisible(fogView, tx, ty) }
        : {}),
      ...(ghosts !== undefined && ghosts.length > 0 ? { ghosts } : {}),
      ...(portraitRef !== null ? { portraitRef } : {}),
    });
    // Selection rings read the pool's just-computed per-entity bounds + drawn (lerped, lifted) anchors,
    // so a building's marker sizes to its actual sprite footprint and a moving unit's ring glides with
    // the interpolated bob (reconcile ran first, so both are this frame's); the elevation field covers
    // the culled-entity fallback.
    this.selectionLayer.draw(
      {
        snapshot,
        boundsOf: (ref) => this.pool.boundsOf(ref),
        elevation: this.elevation,
        anchorOf: (ref) => this.pool.anchorOf(ref),
      },
      selection,
      flagged,
    );
    // Combat ground marks: reposition + fade the blood/bones fed by `ingestCombatEffects`, culled to the
    // same viewport as the sprites so a battlefield's litter cost tracks the screen, not the casualty count.
    // Fed interpolated render time (`tick + alpha`) so the blood-fall animation and fades are smooth at any
    // frame rate; the fold's decay membership uses the integer sim tick from `ingest`, so this stays render-only.
    this.effects.draw(this.elevation, vp, tick + alpha);
    // Door badges float over the buildings: the app tallies each building's bound workers + projects its
    // door node, this layer stacks one placeholder square per worker (craftsman / carrier / gatherer,
    // colour-coded) above the door. Culled to the sprite viewport, so the cost tracks the screen.
    this.badgeLayer.draw(doorBadges, this.elevation, vp);
    if (this.pauseWash.visible) {
      this.pauseWash.width = this.app.screen.width;
      this.pauseWash.height = this.app.screen.height;
    }
    this.hud.draw(hud);
    // The portrait inset is a second render of the world (re-aimed at the selected unit) into the panel's
    // box texture — must run after the pool reconcile above (so it uses this frame's positions) and before
    // the main stage render below (so the on-stage inset sprite shows this frame's cutout).
    this.portrait.draw(camera);
    this.app.render();
  }

  /**
   * Set (or clear) the details-panel portrait "observation window". The app passes the box rect + entity
   * ref each frame, `null` when the selection has no portrait (multi-select, a building-less pick,
   * nothing); the second render happens in {@link update}, just before the main stage render.
   */
  setPortraitInset(frame: PortraitInsetFrame | null): void {
    this.portrait.set(frame);
  }

  /**
   * Set (or clear) the build-placement dim wash — the visible tile band with the cells a held building
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
   * Set (or clear) the build-placement cursor ghost — the held building's translucent sprite at the
   * hovered tile. The app passes `null` when not in build mode, when the cursor is off the map/HUD, or
   * when the hovered anchor is rejected by the placement probe (the original hides the house cursor
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
   * The world-space bounding box of an entity's sprite as drawn last frame, or `undefined` if it wasn't
   * on screen. The app's picking uses it for a "click the graphic" hit test — see {@link EntityBounds}.
   */
  entityBounds(ref: number): EntityBounds | undefined {
    return this.pool.boundsOf(ref);
  }

  /**
   * Pixel-accurate refinement of {@link entityBounds}: whether the world-px point lands on a solid
   * texel of the entity's drawn sprite, `undefined` when no exact answer exists (not drawn, paletted
   * mesh, unreadable atlas) — the caller then keeps the box verdict. See `SpritePool.pixelHit`.
   */
  entityPixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return this.pool.pixelHit(ref, wx, wy);
  }

  /**
   * Set (or clear) the `?debug=geometry` overlay — every placed building's logic geometry (collision
   * cells, build-exclusion zone, door node, worker-icon anchor) drawn over the world as plain data the
   * app computed from sim content. Rebuilt only when the building set changes, never per frame.
   */
  setGeometryDebug(items: readonly GeometryDebugItem[] | null): void {
    this.geometryDebug.set(items, this.elevation);
  }

  /**
   * Set (or clear) the workplace-assignment highlight — the candidate buildings tinted green (a slot the
   * selected settler can take is open) or red (it cannot) while the player is picking a workplace. The app
   * computes the verdict from the snapshot; the tint rides the building sprite in the next
   * {@link update} (see the sprite pool), so the whole building reads faintly green/red.
   */
  setBuildingHighlight(items: readonly BuildingHighlightItem[] | null): void {
    this.highlight = items === null ? EMPTY_HIGHLIGHT : new Map(items.map((i) => [i.id, i.ok]));
  }

  /** Tear down the whole retained graph + caches. Every sub-layer is destroyed explicitly (uniform
   *  ownership) so its retained pool/Map is cleared, not just its container tree-walked away below. */
  dispose(): void {
    this.terrain.destroy(); // frees mesh geometry the layer.destroy below would otherwise orphan
    this.mapObjects.destroy();
    this.pool.destroy(); // destroys detached (culled) entities the scene-graph walk can't reach
    this.fog.destroy();
    this.placementOverlay.destroy();
    this.constructionPlots.destroy();
    this.placementGhost.destroy();
    this.selectionLayer.destroy();
    this.effects.destroy();
    this.badgeLayer.destroy();
    this.geometryDebug.destroy();
    this.worldLayer.destroy({ children: true });
    this.pauseWash.destroy(); // the shared Texture.WHITE itself is left alone
    this.hud.destroy();
    this.portrait.destroy();
    this.textureCache.clear();
  }
}
