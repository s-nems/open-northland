import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import { type Application, Container, RenderTexture, Sprite, Texture } from 'pixi.js';
import { type ElevationField, makeElevationField } from '../data/elevation.js';
import type { Camera } from '../data/iso.js';
import type { SceneTerrain } from '../data/scene/index.js';
import { cameraViewport } from '../data/viewport.js';
import { BadgeLayer, type DoorBadge } from './badge-layer.js';
import { type ConstructionPlotFrame, ConstructionPlotLayer } from './construction-plot.js';
import { CombatEffectsLayer } from './effects-layer.js';
import { type GeometryDebugItem, GeometryDebugLayer } from './geometry-debug.js';
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
const NO_BADGES: readonly DoorBadge[] = [];

/**
 * The details-panel portrait "observation window": a live cutout of the world centred on the selected
 * entity, drawn into the panel's Ogólne/preview box each frame. `rect` is the box in SCREEN px (the
 * panel's on-screen preview area, bevel-inset); `entityRef` is the entity to centre on. `kind` picks the
 * framing: a `building` FITS its (static) drawn bounds in the box — a big ship zooms out, a small hut in;
 * a `settler` frames a FIXED feet-anchored window, so the cutout tracks only the unit's POSITION and never
 * jitters with the swaying idle "look-around" animation (whose drawn bounds breathe every frame).
 */
export interface PortraitInsetFrame {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly entityRef: number;
  readonly kind: 'settler' | 'building';
}

/** A BUILDING's drawn bounds fill this fraction of the portrait box (the rest is surrounding-world margin). */
const PORTRAIT_FILL = 0.72;
/** Zoom-out floor — a huge building still can't shrink past this (keeps the cutout legible). */
const PORTRAIT_MIN_SCALE = 0.2;
/** Zoom-in ceiling — a tiny building can't blow up past this (avoids a pixel-mush close-up). */
const PORTRAIT_MAX_SCALE = 2.5;
/**
 * World-space height framed for a SETTLER portrait. A viking body is ~32 world units tall; the extra is
 * head/foot margin (and clearance for the raised-arm "look-around" wait frame). A NAMED approximation,
 * eye-calibrated — the settler window is a fixed feet-anchored frame (not a fit to the breathing bounds),
 * so it stays rock-steady while the unit stands and only pans as the unit's feet actually move.
 */
const SETTLER_VIEW_HEIGHT = 46;
/** Where the feet anchor sits down the settler portrait (body rises into the upper part, a little ground below). */
const SETTLER_FEET_FRACTION = 0.84;

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
  private readonly pool: SpritePool;
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
  /**
   * The details-panel portrait "observation window" — a live cutout of the world centred on the selected
   * entity. Owned here because it needs a SECOND render of {@link worldLayer} each frame (re-aimed at the
   * unit), just before the main stage render. The sprite is a stage child raised over the (later-mounted,
   * frequently-rebuilt) details panel each frame it shows. Null/hidden when nothing is selected.
   */
  private portraitFrame: PortraitInsetFrame | null = null;
  private portraitTexture: RenderTexture | null = null;
  private readonly portraitSprite = new Sprite();
  /** The main camera from the last {@link update}, so the portrait inset can restore the screen-space
   *  team-colour meshes it re-places for its own re-aimed render. */
  private lastCamera: Camera = { offsetX: 0, offsetY: 0, scale: 1 };

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
    // rings → bones (ground litter) → sprites + tall objects → blood spurts → door badges (front). The
    // wash + rings + bones sit under the sprites so a house/tree/unit in front draws over them (the wash
    // dims the ground, bones are litter under a fighter's feet); blood + door badges sit OVER the sprites
    // so a hit spurt shows on the struck body and a worker marker floats above its building.
    this.worldLayer.addChild(this.terrain.container);
    this.worldLayer.addChild(this.mapObjects.decorContainer);
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
    // The portrait observation window sits over everything (it fills the details panel's box hole); it is
    // re-raised above the frequently-rebuilt panel each frame it shows — see drawPortraitInset.
    this.portraitSprite.visible = false;
    app.stage.addChild(this.portraitSprite);
  }

  /** Show/hide the paused-game wash — the app's loop control drives this alongside the sim pause. */
  setPaused(paused: boolean): void {
    this.pauseWash.visible = paused;
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
    this.lastCamera = camera;
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
      flagged,
    );
    // Combat ground marks: reposition + fade the blood/bones fed by `ingestCombatEffects`, culled to the
    // same viewport as the sprites so a battlefield's litter cost tracks the screen, not the casualty count.
    this.effects.draw(this.elevation, vp, tick);
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
    this.drawPortraitInset();
    this.app.render();
  }

  /**
   * Set (or clear) the details-panel portrait "observation window" — a live cutout of the world centred on
   * the selected entity, rendered into the panel's box each frame. The app passes the box rect + entity ref
   * each frame (null when the selection has no portrait — multi-select, a building-less pick, nothing); the
   * actual second render happens in {@link update}, just before the main stage render.
   */
  setPortraitInset(frame: PortraitInsetFrame | null): void {
    this.portraitFrame = frame;
  }

  /**
   * The inset camera framing (world centre + px-per-world scale) for the portrait's entity, or `null` when
   * it wasn't drawn this frame (off-screen / culled). A BUILDING fits its static drawn bounds in the box; a
   * SETTLER frames a FIXED window off its stable feet anchor (never the swaying animation bounds), so a
   * standing unit's cutout holds still and only pans when its feet actually move.
   */
  private portraitFraming(
    f: PortraitInsetFrame,
    w: number,
    h: number,
  ): { cx: number; cy: number; scale: number } | null {
    if (f.kind === 'settler') {
      const anchor = this.pool.anchorOf(f.entityRef);
      if (anchor === undefined) return null;
      // Scale a nominal body height to the box height, centre on the feet (raised so the body fills the
      // upper part). Position-only: no bounds term, so the idle sway can't move or resize the cutout.
      return {
        cx: anchor.x,
        cy: anchor.y - SETTLER_VIEW_HEIGHT * (SETTLER_FEET_FRACTION - 0.5),
        scale: h / SETTLER_VIEW_HEIGHT,
      };
    }
    const bounds = this.pool.boundsOf(f.entityRef);
    if (bounds === undefined) return null;
    // Centre on the bounds and scale to FIT them in the box (a big building zooms out, a small one in).
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const boundsW = Math.max(1, bounds.maxX - bounds.minX);
    const boundsH = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.max(
      PORTRAIT_MIN_SCALE,
      Math.min(PORTRAIT_MAX_SCALE, Math.min(w / boundsW, h / boundsH) * PORTRAIT_FILL),
    );
    return { cx, cy, scale };
  }

  /**
   * Render the portrait observation window: re-aim {@link worldLayer} onto the selected entity, render it to
   * the inset texture, then restore the main camera (the main stage render draws with the restored transform).
   * The framing ({@link portraitFraming}) is building-fit or settler-fixed; if the entity wasn't drawn this
   * frame (off-screen/culled) the inset hides and the panel placeholder shows.
   */
  private drawPortraitInset(): void {
    const f = this.portraitFrame;
    if (f === null || f.rect.w < 1 || f.rect.h < 1) {
      this.portraitSprite.visible = false;
      return;
    }
    const w = Math.round(f.rect.w);
    const h = Math.round(f.rect.h);
    const framing = this.portraitFraming(f, w, h);
    if (framing === null) {
      this.portraitSprite.visible = false;
      return;
    }
    if (
      this.portraitTexture === null ||
      this.portraitTexture.width !== w ||
      this.portraitTexture.height !== h
    ) {
      this.portraitTexture?.destroy(true);
      this.portraitTexture = RenderTexture.create({
        width: w,
        height: h,
        resolution: this.app.renderer.resolution,
      });
      this.portraitSprite.texture = this.portraitTexture;
    }
    const { cx, cy, scale } = framing;
    const insetCamera: Camera = { offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale, scale };
    const savedScale = this.worldLayer.scale.x;
    const savedX = this.worldLayer.position.x;
    const savedY = this.worldLayer.position.y;
    // Plain sprites + terrain ride the worldLayer transform; the screen-space team-colour character meshes
    // must be re-placed for the inset camera (they can't ride it) AND flipped upright for the bottom-up
    // render texture, then restored (main camera, no flip) after.
    this.pool.placePalettedFor(insetCamera, w, h, true);
    this.worldLayer.scale.set(scale);
    this.worldLayer.position.set(insetCamera.offsetX, insetCamera.offsetY);
    this.app.renderer.render({ container: this.worldLayer, target: this.portraitTexture, clear: true });
    this.worldLayer.scale.set(savedScale);
    this.worldLayer.position.set(savedX, savedY);
    this.pool.placePalettedFor(this.lastCamera, this.app.screen.width, this.app.screen.height, false);

    this.portraitSprite.position.set(f.rect.x, f.rect.y);
    this.portraitSprite.width = w;
    this.portraitSprite.height = h;
    this.portraitSprite.visible = true;
    // The details panel mounts AFTER this renderer and re-adds its root to the stage top on every rebuild
    // (≈4 Hz), so raise the inset above it EVERY shown frame — otherwise the baked panel covers the cutout.
    this.app.stage.addChild(this.portraitSprite);
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
    this.placementOverlay.destroy();
    this.constructionPlots.destroy();
    this.placementGhost.destroy();
    this.geometryDebug.destroy();
    this.worldLayer.destroy({ children: true });
    this.pauseWash.destroy(); // the shared Texture.WHITE itself is left alone
    this.hud.destroy();
    this.portraitSprite.destroy();
    this.portraitTexture?.destroy(true);
    this.textureCache.clear();
  }
}
