import type { FogView, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { cameraViewport, snapCameraToDevicePixels } from '../../data/projection/index.js';
import { type DrawItem, palisadeLayoutOf, type SceneTerrain } from '../../data/scene/index.js';
import { type BrightnessField, type ElevationField, makeElevationField } from '../../data/terrain/index.js';
import { type GroundWave, GroundWaveLayer } from '../ground-waves/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../map-objects/index.js';
import {
  type BuildingSignGfx,
  type ConstructionPlotFrame,
  ConstructionPlotLayer,
  type GeometryDebugItem,
  HudLayer,
  type MapViewFrame,
  MapViewLayer,
  type PlacementGhost,
  PlacementGhostLayer,
  type PlacementOverlayFrame,
  PlacementOverlayLayer,
  type PortraitInsetFrame,
  PortraitInsetLayer,
  type SettlerBubbleGfx,
} from '../overlays/index.js';
import { setPixelArtMagnification, setWorldShadowStyle } from '../pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE } from '../shadow-style.js';
import { type EntityBounds, SpritePool } from '../sprite-pool/index.js';
import { TerrainLayer } from '../terrain/index.js';
import type { TerrainVertexColor } from '../terrain/vertex-colors.js';
import type { TerrainTextureSet } from '../terrain-textures.js';
import { TextureCache } from '../texture-cache.js';
import { installWorldBatcher } from '../world-batcher.js';
import {
  BASELINE_ENHANCEMENTS,
  type BuildingHighlightItem,
  type CombatBonesGfx,
  EMPTY_HIGHLIGHT,
  NO_BADGES,
  NO_BUBBLES,
  NO_HEARTS,
  NO_REFS,
  NO_SIGNS,
  NO_WORK_AREAS,
  SPRITE_CULL_MARGIN,
  type WorldEnhancements,
  type WorldFrame,
  type WorldRendererOptions,
} from './frame.js';
import { mountPainterOrder } from './painter-order.js';
import { WorldChrome } from './world-chrome.js';
import { WorldFog } from './world-fog.js';
import { WorldMarks } from './world-marks.js';

export class WorldRenderer {
  private readonly app: Application;
  private readonly worldLayer = new Container();
  /** The one depth-sorted layer: anything that must occlude like a sprite joins it instead of taking a
   *  painter-order slot. */
  private readonly spriteLayer = new Container();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly mapObjects: MapObjectLayer;
  private readonly groundWaves: GroundWaveLayer;
  private readonly pool: SpritePool;
  private readonly fog = new WorldFog();
  private readonly placementOverlay: PlacementOverlayLayer;
  private readonly constructionPlots = new ConstructionPlotLayer();
  private readonly placementGhost: PlacementGhostLayer;
  private readonly marks: WorldMarks;
  private highlight: ReadonlyMap<number, boolean> = EMPTY_HIGHLIGHT;
  private highlightItems: readonly BuildingHighlightItem[] | null = null;
  private readonly hud = new HudLayer();
  private readonly chrome: WorldChrome;
  /** The current map's height field; flat until `setTerrain` loads a map carrying an elevation lane. */
  private elevation: ElevationField = makeElevationField(undefined, 0, 0);
  private readonly portrait: PortraitInsetLayer;
  private readonly mapViews: MapViewLayer;

  private readonly viewSmoothing: boolean;
  private readonly playerColourOf: ((player: number) => number) | undefined;
  private enhancements: WorldEnhancements = BASELINE_ENHANCEMENTS;

  constructor(app: Application, opts?: WorldRendererOptions) {
    installWorldBatcher(); // before the sprite layer's render group builds its first batch
    this.app = app;
    this.viewSmoothing = opts?.viewSmoothing === true;
    this.playerColourOf = opts?.playerColourOf;
    this.spriteLayer.sortableChildren = true;
    // Own Pixi render group: moving sprites re-write zIndex every frame, and that must re-sort and
    // re-build only this layer's instruction set, not the whole stage's.
    this.spriteLayer.isRenderGroup = true;
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.groundWaves = new GroundWaveLayer(app.renderer, this.terrain.container);
    this.pool = new SpritePool(
      this.spriteLayer,
      this.textureCache,
      opts?.sheet,
      opts?.playerColourOf,
      opts?.planStakes,
    );
    this.marks = new WorldMarks(this.spriteLayer, this.textureCache, opts?.sheet, opts?.playerColourOf);
    this.portrait = new PortraitInsetLayer(app, this.worldLayer, this.pool);
    this.mapViews = new MapViewLayer(app, this.worldLayer, this.pool);
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the depth-sorted sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(opts?.sheet, this.textureCache, opts?.planStakes);
    this.spriteLayer.addChild(this.placementGhost.container);
    mountPainterOrder(this.worldLayer, {
      terrain: this.terrain.container,
      decorShadows: this.mapObjects.decorShadowContainer,
      decor: this.mapObjects.decorContainer,
      fog: this.fog.container,
      constructionPlots: this.constructionPlots.container,
      placementWash: this.placementOverlay.container,
      sprites: this.spriteLayer,
      ...this.marks.slots,
    });
    app.stage.addChild(this.worldLayer);
    this.chrome = new WorldChrome(this.textureCache, opts?.postFx === true, opts?.spriteSmoothing);
    this.chrome.attach(app.stage);
    app.stage.addChild(this.hud.container);
    // Always routed, never only assigned: the magnification mode and shadow style are page globals a
    // previous renderer may have left set, so the baseline has to claim them back.
    this.setGraphicsEnhancements(opts?.enhancements ?? BASELINE_ENHANCEMENTS);
  }

  setGraphicsEnhancements(next: WorldEnhancements): void {
    this.enhancements = { ...next };
    this.textureCache.setSoftShadows(next.softShadows);
    setWorldShadowStyle(next.softShadows ? DEFAULT_SHADOW_STYLE : null);
    setPixelArtMagnification(next.enhancedSampling ? next.pixelArtScaler : 'off');
    this.terrain.setEnhancedSampling(next.enhancedSampling);
    this.terrain.setEnhancedWater(next.enhancedWater);
    this.mapObjects.setEnvironmentMotion(next.environmentMotion);
  }

  setPaused(paused: boolean): void {
    this.chrome.setPaused(paused);
  }

  /** The viewer's fog view (`Simulation.fogView`); call each frame. */
  updateFog(view: FogView | null): void {
    this.fog.setView(view);
  }

  /** Call once per map, and again after a terrain edit. */
  setTerrain(terrain: SceneTerrain, textures?: TerrainTextureSet): void {
    this.elevation = makeElevationField(terrain.elevation, terrain.width, terrain.height);
    this.terrain.set(terrain, textures, this.elevation);
  }

  applyTerrainVertexColors(updates: readonly TerrainVertexColor[], palette?: readonly number[]): void {
    this.terrain.applyVertexColors(updates, palette);
  }

  brightnessField(): BrightnessField {
    return this.terrain.brightnessField();
  }

  /** Call once per map. */
  setMapObjects(objects: readonly MapObjectSprite[]): void {
    this.mapObjects.set(objects);
  }

  /** Call once per map. The waves run only while environment motion is on. */
  setGroundWaves(waves: readonly GroundWave[]): void {
    this.groundWaves.set(waves);
  }

  removeGroundWave(wave: GroundWave): void {
    this.groundWaves.remove(wave);
  }

  addMapObjects(objects: readonly MapObjectSprite[]): void {
    this.mapObjects.add(objects);
  }

  /** Feed this frame's sim events (accumulated across every fixed-timestep sub-step) to the marks that
   *  spawn from them; call before `update` each frame. */
  ingestCombatEffects(events: readonly SimEvent[], tick: number): void {
    this.marks.ingest(events, tick);
  }

  setCombatBonesGfx(gfx: CombatBonesGfx | null): void {
    this.marks.setBonesGfx(gfx);
  }

  setWreckGfx(gfx: CombatBonesGfx | null): void {
    this.marks.setWreckGfx(gfx);
  }

  setSettlerBubbleGfx(gfx: SettlerBubbleGfx | null): void {
    this.marks.setBubbleGfx(gfx);
  }

  setBuildingSignGfx(gfx: BuildingSignGfx | null): void {
    this.marks.setSignGfx(gfx);
  }

  /**
   * Remove one placed landscape object from the retained static layer - the handover seam where a
   * first-worked resource node stops being a built-once static and becomes a pooled entity sprite.
   */
  removeMapObject(obj: MapObjectSprite): void {
    this.mapObjects.remove(obj);
  }

  /** The other half of the `removeMapObject` handover: keep drawing `ref` as a remembered static once it
   *  leaves the retained layer. */
  adoptFogGhost(ref: number): void {
    this.fog.adoptGhost(ref);
  }

  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.fog.setStaticallyDrawnRefs(refs);
  }

  update(frame: WorldFrame): void {
    this.textureCache.beginFrame();
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
      workAreas = NO_WORK_AREAS,
    } = frame;
    // Filtered sprites can move continuously; pixel snapping would reintroduce one-pixel pan/feet
    // jumps. Keep the old alignment only for the baseline nearest-sampled presentation.
    const snapResolution =
      this.viewSmoothing && !this.enhancements.enhancedSampling ? this.app.renderer.resolution : undefined;
    const camera =
      snapResolution === undefined ? frame.camera : snapCameraToDevicePixels(frame.camera, snapResolution);
    this.chrome.applyWorldSampling(
      this.viewSmoothing ? (camera.scale ?? 1) : 1,
      this.enhancements.enhancedSampling,
    );
    this.worldLayer.scale.set(camera.scale ?? 1);
    this.worldLayer.position.set(camera.offsetX, camera.offsetY);
    // Cull anchors and AABBs stay pre-lift, so without the extra `maxLift` a chunk or sprite baked up a
    // hill pops at the screen edge.
    const vp = cameraViewport(
      camera,
      this.app.screen.width,
      this.app.screen.height,
      SPRITE_CULL_MARGIN + this.elevation.maxLift,
    );
    this.terrain.cull(vp);
    this.terrain.animate(tick + alpha);
    const fogFrame = this.fog.update(snapshot, vp, this.elevation);
    this.mapObjects.update(vp, tick, this.fog.cellStateAt, fogFrame.fogEpoch, tick + alpha);
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
      snapResolution,
      enhancedSampling: this.enhancements.enhancedSampling,
      pixelArtScaler: this.enhancements.pixelArtScaler,
      environmentMotion: this.enhancements.environmentMotion,
      shadowStyle: this.enhancements.softShadows ? DEFAULT_SHADOW_STYLE : undefined,
      ...fogFrame,
      ...(this.highlight.size > 0 ? { highlight: this.highlight } : {}),
      ...(portraitRef !== null ? { portraitRef } : {}),
    });
    this.marks.draw({
      snapshot,
      drawn: this.pool,
      elevation: this.elevation,
      viewport: vp,
      renderTime: tick + alpha,
      damaged: this.pool.damagedBuildings(),
      selection,
      flagged,
      workAreas,
      doorBadges,
      constructionSigns: signItems,
      settlerBubbles,
      lifeHearts,
    });
    this.chrome.resize(this.app.screen.width, this.app.screen.height);
    this.hud.draw(hud);
    this.groundWaves.update(
      vp,
      camera,
      this.app.screen.width,
      this.app.screen.height,
      tick,
      this.enhancements.environmentMotion,
    );
    this.app.render();
    this.groundWaves.suspend(true);
    this.portrait.draw(camera, {
      toInset: (cam, iw, ih) => this.terrain.cull(cameraViewport(cam, iw, ih, this.elevation.maxLift)),
      restore: () => this.terrain.cull(vp),
      backdrop: this.terrain.groundColour(),
    });
    this.mapViews.draw(
      {
        snapshot,
        tick,
        alpha,
        elevation: this.elevation,
        ...(fogFrame.staticRefs !== undefined ? { staticRefs: fogFrame.staticRefs } : {}),
        main: { camera, width: this.app.screen.width, height: this.app.screen.height },
        spriteMargin: SPRITE_CULL_MARGIN + this.elevation.maxLift,
      },
      {
        cullTo: (cam, iw, ih) => {
          const viewVp = cameraViewport(cam, iw, ih, SPRITE_CULL_MARGIN + this.elevation.maxLift);
          this.terrain.cull(cameraViewport(cam, iw, ih, this.elevation.maxLift));
          this.mapObjects.update(viewVp, tick);
          this.fog.container.visible = false;
        },
        restore: () => {
          this.terrain.cull(vp);
          this.mapObjects.update(vp, tick, this.fog.cellStateAt, fogFrame.fogEpoch);
          this.fog.container.visible = true;
        },
        backdrop: this.terrain.groundColour(),
      },
    );
    this.groundWaves.suspend(false);
  }

  /** The views a window shows this frame (the briefing's map pictures), drawn after the main render;
   *  an empty list draws none. */
  setMapViews(views: readonly MapViewFrame[]): void {
    this.mapViews.set(views);
  }

  setPortraitInset(frame: PortraitInsetFrame | null): void {
    this.portrait.set(frame);
  }

  updatePlacementOverlay(frame: PlacementOverlayFrame | null): void {
    this.placementOverlay.set(frame, this.elevation);
  }

  updateConstructionPlots(plots: readonly ConstructionPlotFrame[]): void {
    this.constructionPlots.set(plots, this.elevation);
  }

  /**
   * A signpost ghost's `player` is the owner slot, mapped to the session colour here - the same boundary
   * pooled sprites are mapped at. A wall line staggers with the walls of `snapshot`.
   */
  updatePlacementGhost(ghost: PlacementGhost | null, snapshot?: WorldSnapshot): void {
    const mapped =
      ghost !== null && ghost.kind === 'signpost' && this.playerColourOf !== undefined
        ? { ...ghost, player: this.playerColourOf(ghost.player) }
        : ghost;
    const walls =
      mapped?.kind === 'line' && snapshot !== undefined
        ? palisadeLayoutOf(snapshot, this.elevation)
        : undefined;
    this.placementGhost.set(mapped, this.elevation, walls);
  }

  stats(): { drawn: number; pooled: number } {
    return this.pool.stats();
  }

  /** Valid until the next update. */
  drawnItems(): readonly DrawItem[] {
    return this.pool.drawnItems();
  }

  entityBounds(ref: number): EntityBounds | undefined {
    return this.pool.boundsOf(ref);
  }

  entityPixelHit(ref: number, wx: number, wy: number): boolean | undefined {
    return this.pool.pixelHit(ref, wx, wy);
  }

  /** The `?debug=geometry` overlay of every placed building's logic geometry. */
  setGeometryDebug(items: readonly GeometryDebugItem[] | null): void {
    this.marks.setGeometryDebug(items, this.elevation);
  }

  /** The tint rides the building sprite from the next update on. */
  setBuildingHighlight(items: readonly BuildingHighlightItem[] | null): void {
    // Callers hand over a memoized list, so an unchanged one rebuilds nothing.
    if (items === this.highlightItems) return;
    this.highlightItems = items;
    this.highlight = items === null ? EMPTY_HIGHLIGHT : new Map(items.map((i) => [i.id, i.ok]));
  }

  /** Every sub-layer is destroyed explicitly so its retained pool or Map is cleared, not just its
   *  container tree-walked away below. */
  dispose(): void {
    this.groundWaves.destroy();
    this.terrain.destroy();
    this.mapObjects.destroy();
    this.pool.destroy();
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
