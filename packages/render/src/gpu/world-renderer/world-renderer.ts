import type { FogView, SimEvent } from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { cameraViewport, snapCameraToDevicePixels } from '../../data/projection/index.js';
import type { DrawItem, SceneTerrain } from '../../data/scene/index.js';
import { type BrightnessField, type ElevationField, makeElevationField } from '../../data/terrain/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../map-objects/index.js';
import {
  type BuildingSignGfx,
  type ConstructionPlotFrame,
  ConstructionPlotLayer,
  type GeometryDebugItem,
  HudLayer,
  type PlacementGhost,
  PlacementGhostLayer,
  type PlacementOverlayFrame,
  PlacementOverlayLayer,
  type PortraitInsetFrame,
  PortraitInsetLayer,
  type SettlerBubbleGfx,
} from '../overlays/index.js';
import { type EntityBounds, SpritePool } from '../sprite-pool/index.js';
import { TerrainLayer } from '../terrain/index.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { TextureCache } from '../texture-cache.js';
import {
  type BuildingHighlightItem,
  type CombatBonesGfx,
  EMPTY_HIGHLIGHT,
  NO_BADGES,
  NO_BUBBLES,
  NO_HEARTS,
  NO_REFS,
  NO_SIGNS,
  SPRITE_CULL_MARGIN,
  type WorldFrame,
  type WorldRendererOptions,
} from './frame.js';
import { mountPainterOrder } from './painter-order.js';
import { WorldChrome } from './world-chrome.js';
import { WorldFog } from './world-fog.js';
import { WorldMarks } from './world-marks.js';

export class WorldRenderer {
  private readonly app: Application;
  /** Carries the camera transform; terrain, decor and sprites are its children, so one transform pans all. */
  private readonly worldLayer = new Container();
  /** The shared, depth-ordered entity layer - holds both pooled entities and tall map objects. */
  private readonly spriteLayer = new Container();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly mapObjects: MapObjectLayer;
  private readonly pool: SpritePool;
  private readonly fog = new WorldFog();
  /** The build-mode dim wash over non-buildable tiles. */
  private readonly placementOverlay: PlacementOverlayLayer;
  /** Grey ground plots under placed construction sites. */
  private readonly constructionPlots = new ConstructionPlotLayer();
  private readonly placementGhost: PlacementGhostLayer;
  private readonly marks: WorldMarks;
  /** Candidate building id → assignable, while the player picks a workplace for the selected settler. */
  private highlight: ReadonlyMap<number, boolean> = EMPTY_HIGHLIGHT;
  private readonly hud = new HudLayer();
  private readonly chrome: WorldChrome;
  /** The current map's height field; flat until `setTerrain` loads a map carrying an elevation lane. */
  private elevation: ElevationField = makeElevationField(undefined, 0, 0);
  private readonly portrait: PortraitInsetLayer;

  private readonly viewSmoothing: boolean;
  private readonly playerColourOf: ((player: number) => number) | undefined;

  constructor(app: Application, opts?: WorldRendererOptions) {
    this.app = app;
    this.viewSmoothing = opts?.viewSmoothing === true;
    this.playerColourOf = opts?.playerColourOf;
    this.spriteLayer.sortableChildren = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.pool = new SpritePool(this.spriteLayer, this.textureCache, opts?.sheet, opts?.playerColourOf);
    this.marks = new WorldMarks(this.spriteLayer, this.textureCache, opts?.sheet, opts?.playerColourOf);
    this.portrait = new PortraitInsetLayer(app, this.worldLayer, this.pool);
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the depth-sorted sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(opts?.sheet, this.textureCache);
    this.spriteLayer.addChild(this.placementGhost.container);
    mountPainterOrder(this.worldLayer, {
      terrain: this.terrain.container,
      decor: this.mapObjects.decorContainer,
      fog: this.fog.container,
      constructionPlots: this.constructionPlots.container,
      placementWash: this.placementOverlay.container,
      sprites: this.spriteLayer,
      ...this.marks.slots,
    });
    app.stage.addChild(this.worldLayer);
    // Stage child order is the z-order: world, then the chrome quads, then the pinned HUD.
    this.chrome = new WorldChrome(this.textureCache, opts?.postFx === true);
    this.chrome.attach(app.stage);
    app.stage.addChild(this.hud.container);
  }

  setPaused(paused: boolean): void {
    this.chrome.setPaused(paused);
  }

  /** Set (or clear with `null`) the viewer's fog view (`Simulation.fogView`); call each frame. */
  updateFog(view: FogView | null): void {
    this.fog.setView(view);
  }

  /**
   * (Re)build the cached terrain from a grid - call once per map, and again after a terrain edit.
   * Without `textures` it draws the flat placeholder ground.
   */
  setTerrain(terrain: SceneTerrain, textures?: TerrainTextureSet): void {
    this.elevation = makeElevationField(terrain.elevation, terrain.width, terrain.height);
    this.terrain.set(terrain, textures, this.elevation);
  }

  /**
   * The composed shading field the ground drew with - the one source for anchor-shading landscape
   * objects, so an object cannot disagree with the ground under it.
   */
  brightnessField(): BrightnessField {
    return this.terrain.brightnessField();
  }

  /** (Re)build the retained landscape-object layers from a decoded map's placements - call once per map. */
  setMapObjects(objects: readonly MapObjectSprite[]): void {
    this.mapObjects.set(objects);
  }

  /** Feed this frame's sim events (accumulated across every fixed-timestep sub-step) to the marks that
   *  spawn from them; call before `update` each frame. */
  ingestCombatEffects(events: readonly SimEvent[], tick: number): void {
    this.marks.ingest(events, tick);
  }

  /** Provide (or clear) the decoded bone-pile art so a death draws the `cadaver human bones` sprite
   *  instead of the procedural pile. */
  setCombatBonesGfx(gfx: CombatBonesGfx | null): void {
    this.marks.setBonesGfx(gfx);
  }

  /** Provide (or clear) the decoded settler-bubble art (the `ls_gui_bubbles` page and per-kind frames). */
  setSettlerBubbleGfx(gfx: SettlerBubbleGfx | null): void {
    this.marks.setBubbleGfx(gfx);
  }

  /** Provide (or clear) the decoded building-sign art (the per-player `ls_temp` pages and per-kind
   *  frames); without it the badge layer stays on its placeholder squares. */
  setBuildingSignGfx(gfx: BuildingSignGfx | null): void {
    this.marks.setSignGfx(gfx);
  }

  /**
   * Remove one placed landscape object from the retained static layer - the handover seam where a
   * first-worked resource node stops being a built-once static and becomes a pooled entity sprite.
   * A no-op for an object the layer does not hold.
   */
  removeMapObject(obj: MapObjectSprite): void {
    this.mapObjects.remove(obj);
  }

  /** The other half of the `removeMapObject` handover: keep drawing `ref` as a remembered static once it
   *  leaves the retained layer. */
  adoptFogGhost(ref: number): void {
    this.fog.adoptGhost(ref);
  }

  /** Name the entities the retained static map-object layer draws instead of the sprite pool (a decoded
   *  map's virgin resource nodes). */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.fog.setStaticallyDrawnRefs(refs);
  }

  update(frame: WorldFrame): void {
    const {
      snapshot,
      tick = 0,
      hud,
      selection = NO_REFS,
      alpha = 1,
      doorBadges = NO_BADGES,
      constructionSigns: signItems = NO_SIGNS,
      settlerBubbles = NO_BUBBLES,
      lifeHearts = NO_HEARTS,
      flagged = NO_REFS,
    } = frame;
    const camera = this.viewSmoothing
      ? snapCameraToDevicePixels(frame.camera, this.app.renderer.resolution)
      : frame.camera;
    if (this.viewSmoothing) this.chrome.applyWorldSampling(camera.scale ?? 1);
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);
    // Cull anchors and AABBs stay pre-lift, so the box grows by the map-wide `maxLift` as well; without
    // it a chunk or sprite baked up a hill pops at the screen edge.
    const vp = cameraViewport(
      camera,
      this.app.screen.width,
      this.app.screen.height,
      SPRITE_CULL_MARGIN + this.elevation.maxLift,
    );
    this.terrain.cull(vp);
    // The water surface animates on the interpolated sim clock, so a `?shot` at a fixed tick reproduces
    // byte-identically.
    this.terrain.animate(tick + alpha);
    const fogFrame = this.fog.update(snapshot, vp);
    // `stateAt` is a bound arrow-function property on the view, so passing it detached is safe.
    this.mapObjects.update(vp, tick, this.fog.cellStateAt);
    // `setPortraitInset` runs before this update, so the subject ref is this frame's.
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
      ...fogFrame,
      ...(this.highlight.size > 0 ? { highlight: this.highlight } : {}),
      ...(portraitRef !== null ? { portraitRef } : {}),
    });
    // The marks read the geometry the reconcile above stamped this frame, so they must follow it.
    this.marks.draw({
      snapshot,
      drawn: this.pool,
      elevation: this.elevation,
      viewport: vp,
      renderTime: tick + alpha,
      damaged: this.pool.damagedBuildings(),
      selection,
      flagged,
      doorBadges,
      constructionSigns: signItems,
      settlerBubbles,
      lifeHearts,
    });
    this.chrome.resize(this.app.screen.width, this.app.screen.height);
    this.hud.draw(hud);
    this.app.render();
    // A second screen render of the re-aimed world, after the main one so it overpaints the details
    // panel's preview box as the frame's last pass.
    this.portrait.draw(camera, {
      toInset: (cam, iw, ih) => this.terrain.cull(cameraViewport(cam, iw, ih, this.elevation.maxLift)),
      restore: () => this.terrain.cull(vp),
      backdrop: this.terrain.groundColour(),
    });
  }

  /** Set (or clear) the details-panel portrait window; its render happens at the end of the next update. */
  setPortraitInset(frame: PortraitInsetFrame | null): void {
    this.portrait.set(frame);
  }

  /**
   * Set (or clear) the build-placement dim wash - the visible cells a held building cannot anchor on,
   * decided by the sim's placement probe and passed in as plain data. Takes effect on the next update.
   */
  updatePlacementOverlay(frame: PlacementOverlayFrame | null): void {
    this.placementOverlay.set(frame, this.elevation);
  }

  /**
   * Set the grey ground plots under placed construction sites (`Simulation.constructionPlots`); an empty
   * list clears them. Takes effect on the next update.
   */
  updateConstructionPlots(plots: readonly ConstructionPlotFrame[]): void {
    this.constructionPlots.set(plots, this.elevation);
  }

  /**
   * Set (or clear) the build-placement cursor ghost at the hovered tile. A signpost ghost's `player` is
   * the owner slot, mapped to the session colour here - the boundary pooled sprites get it at too.
   */
  updatePlacementGhost(ghost: PlacementGhost | null): void {
    const mapped =
      ghost !== null && ghost.kind === 'signpost' && this.playerColourOf !== undefined
        ? { ...ghost, player: this.playerColourOf(ghost.player) }
        : ghost;
    this.placementGhost.set(mapped, this.elevation);
  }

  stats(): { drawn: number; pooled: number } {
    return this.pool.stats();
  }

  /** The last update's culled, depth-sorted entity draw list, valid until the next update. */
  drawnItems(): readonly DrawItem[] {
    return this.pool.drawnItems();
  }

  /** The world-space bounding box of an entity's sprite as drawn last frame, `undefined` if it was not
   *  on screen. */
  entityBounds(ref: number): EntityBounds | undefined {
    return this.pool.boundsOf(ref);
  }

  /**
   * Whether the world-px point lands on a solid texel of the entity's drawn sprite. `undefined` when no
   * exact answer exists (not drawn, paletted mesh, unreadable atlas) and the caller keeps the box verdict.
   */
  entityPixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return this.pool.pixelHit(ref, wx, wy);
  }

  /**
   * Set (or clear) the `?debug=geometry` overlay of every placed building's logic geometry. Rebuilt only
   * when the building set changes, never per frame.
   */
  setGeometryDebug(items: readonly GeometryDebugItem[] | null): void {
    this.marks.setGeometryDebug(items, this.elevation);
  }

  /**
   * Set (or clear) the workplace-assignment highlight; the tint rides the building sprite from the next
   * update on, so the whole building reads faintly green (assignable) or red (not).
   */
  setBuildingHighlight(items: readonly BuildingHighlightItem[] | null): void {
    this.highlight = items === null ? EMPTY_HIGHLIGHT : new Map(items.map((i) => [i.id, i.ok]));
  }

  /** Tear down the retained graph and caches. Every sub-layer is destroyed explicitly so its retained
   *  pool or Map is cleared, not just its container tree-walked away below. */
  dispose(): void {
    this.terrain.destroy(); // frees mesh geometry the layer.destroy below would otherwise orphan
    this.mapObjects.destroy();
    this.pool.destroy(); // destroys detached (culled) entities the scene-graph walk can't reach
    this.marks.destroy();
    this.fog.destroy();
    this.placementOverlay.destroy();
    this.constructionPlots.destroy();
    this.placementGhost.destroy();
    this.worldLayer.destroy({ children: true });
    this.hud.destroy();
    this.chrome.destroy();
    this.textureCache.clear();
  }
}
