import { type FogView, type SimEvent, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import type { LightGrade } from '../../data/lighting/types.js';
import { cameraViewport, snapCameraToDevicePixels } from '../../data/projection/index.js';
import {
  type DrawItem,
  palisadeLayoutOf,
  RoadShardTracker,
  type SceneTerrain,
} from '../../data/scene/index.js';
import { type BrightnessField, type ElevationField, makeElevationField } from '../../data/terrain/index.js';
import {
  CALM_WIND_SWAY,
  sameWindSway,
  WeatherClimate,
  type WindSway,
  windSway,
} from '../../data/weather/climate.js';
import type { WeatherField } from '../../data/weather/field.js';
import type { WeatherConditions } from '../../data/weather/types.js';
import { DepthSortedLayer } from '../depth-sorted-layer.js';
import { GroundTone } from '../ground-foot/index.js';
import { type GroundWave, GroundWaveLayer } from '../ground-waves/index.js';
import { SceneLight } from '../lighting/scene-light.js';
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
import type { TerrainTextureSet } from '../terrain-textures.js';
import { TextureCache } from '../texture-cache.js';
import { WeatherGround } from '../weather/ground-weather.js';
import { WeatherSky } from '../weather/weather-sky.js';
import { installWorldBatcher, routeWorldBatches } from '../world-batcher.js';
import {
  BASELINE_ENHANCEMENTS,
  type BuildingHighlightItem,
  type CombatBonesGfx,
  EMPTY_HIGHLIGHT,
  NO_BADGES,
  NO_BUBBLES,
  NO_HEARTS,
  NO_ORDER_MARKERS,
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
  private readonly spriteLayer = new DepthSortedLayer();
  private readonly textureCache = new TextureCache();
  private readonly terrain = new TerrainLayer();
  private readonly weatherSky = new WeatherSky();
  private readonly sceneLight = new SceneLight();
  private climate = new WeatherClimate();
  private weatherField: WeatherField | null = null;
  private weatherEnabled = true;
  private weather: WeatherConditions | null = null;
  /** This frame's weather wind for the swaying world; kept as the same object while it holds still, so
   *  its consumers skip a rebind. */
  private wind: WindSway = CALM_WIND_SWAY;
  private readonly mapObjects: MapObjectLayer;
  private readonly weatherGround: WeatherGround;
  private readonly groundWaves: GroundWaveLayer;
  private readonly pool: SpritePool;
  private groundTone: GroundTone | null = null;
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
  /** What the ground last drew of the road network. */
  private readonly roadShards = new RoadShardTracker();
  private readonly playerColourOf: ((player: number) => number) | undefined;
  private enhancements: WorldEnhancements = BASELINE_ENHANCEMENTS;
  private withheldRefs: ReadonlySet<number> | undefined;

  constructor(app: Application, opts?: WorldRendererOptions) {
    installWorldBatcher(); // before the sprite layer's render group builds its first batch
    routeWorldBatches(app.renderer);
    this.app = app;
    const gl = 'gl' in app.renderer ? app.renderer.gl : undefined;
    if (gl !== undefined) opts?.sheet?.palette?.fitTo(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.viewSmoothing = opts?.viewSmoothing === true;
    this.playerColourOf = opts?.playerColourOf;
    // Own Pixi render group over its depth bands' groups: a band appearing or retiring rebuilds only
    // this layer's short instruction list, not the whole stage's.
    this.spriteLayer.isRenderGroup = true;
    for (const art of [opts?.planStakes, opts?.planRoads]) {
      if (art !== undefined) for (const texture of Object.values(art)) this.textureCache.adopt(texture);
    }
    this.mapObjects = new MapObjectLayer(this.spriteLayer, this.textureCache);
    this.weatherGround = new WeatherGround([this.terrain, this.mapObjects]);
    this.groundWaves = new GroundWaveLayer(app.renderer, this.terrain.container);
    this.pool = new SpritePool(
      this.spriteLayer,
      this.textureCache,
      opts?.sheet,
      opts?.playerColourOf,
      opts?.planStakes,
      opts?.planRoads,
    );
    this.marks = new WorldMarks(this.spriteLayer, this.textureCache, opts?.sheet, opts?.playerColourOf);
    this.portrait = new PortraitInsetLayer(app, this.worldLayer, this.pool);
    this.mapViews = new MapViewLayer(app, this.worldLayer, this.pool);
    this.placementOverlay = new PlacementOverlayLayer(app.renderer);
    // The ghost joins the depth-sorted sprite layer so it occludes like the real house would.
    this.placementGhost = new PlacementGhostLayer(
      opts?.sheet,
      this.textureCache,
      opts?.planStakes,
      opts?.planRoads,
    );
    this.spriteLayer.addChild(this.placementGhost.container);
    mountPainterOrder(this.worldLayer, {
      terrain: this.terrain.container,
      decorShadows: this.mapObjects.decorShadowContainer,
      decor: this.mapObjects.decorContainer,
      weatherGround: this.weatherGround.container,
      fog: this.fog.container,
      constructionPlots: this.constructionPlots.container,
      placementWash: this.placementOverlay.container,
      sprites: this.spriteLayer,
      ...this.marks.slots,
    });
    app.stage.addChild(this.worldLayer);
    // Screen-space like the chrome, but under its vignette and pause wash.
    app.stage.addChild(this.weatherSky.container);
    this.weatherSky.watchFog(this.fog.washMask);
    // Over the world and the weather, so rain takes the grade; framed world renders never include it.
    app.stage.addChild(this.sceneLight.container);
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
    this.textureCache.setGroundColours(next.groundedBuildings ? this.groundTone : null);
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
    this.weatherGround.setTerrain({
      width: terrain.width,
      height: terrain.height,
      water: this.terrain.waterField(),
      elevation: this.elevation,
    });
    this.weatherSky.setMapSize(terrain.width, terrain.height);
  }

  /** The map's weather field, after {@link setTerrain} and again after every change; null for none. */
  setWeatherField(field: WeatherField | null): void {
    this.weatherField = field;
    this.weatherGround.setField(field);
    this.weatherSky.setField(field);
  }

  /** The match seed the wind and lightning draw from; the same on every seat and after a load. */
  setWeatherSeed(seed: number): void {
    this.climate = new WeatherClimate(seed);
  }

  /** The weather setting: off draws a clear sky over ground without weather. */
  setWeatherEnabled(enabled: boolean): void {
    this.weatherEnabled = enabled;
    this.weatherGround.setEnabled(enabled);
    this.weatherSky.setEnabled(enabled);
  }

  /** The weather the last {@link update} drew, for the soundscape; null before the first frame. */
  weatherConditions(): WeatherConditions | null {
    return this.weather;
  }

  /** Hand the terrain the roads laid since the last frame: one compare per frame, a diff per changed shard. */
  private syncRoads(snapshot: WorldSnapshot): void {
    const changes = this.roadShards.update(snapshot);
    if (changes !== null) this.terrain.updateRoads(changes);
  }

  /** The script's local ground tints: RGB multipliers per half-cell node id, 3 per node. */
  applyTerrainVertexColors(colors: Float32Array): void {
    this.terrain.applyVertexColors(colors);
  }

  /** The script's whole-map tint, faded toward on game time over everything drawn, or taken at once
   *  with `snap`; null is daylight. */
  setSceneLight(target: LightGrade | null, snap = false): void {
    this.sceneLight.setTarget(target, snap);
  }

  brightnessField(): BrightnessField {
    return this.terrain.brightnessField();
  }

  /** The map's per-cell ground colours (`0xRRGGBB`, or the minimap's unresolved sentinel), which the
   *  feet of buildings and walls take on; null sets nothing into the ground. Call after {@link setTerrain}. */
  setGroundColours(cells: Uint32Array | null, width: number, height: number): void {
    this.groundTone =
      cells === null
        ? null
        : new GroundTone(cells, width, height, this.terrain.brightnessField(), this.elevation);
    this.textureCache.setGroundColours(this.enhancements.groundedBuildings ? this.groundTone : null);
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

  /** Entities the sprite pool holds back until a presentation over them ends (a felled tree's trunk pile
   *  and stump under its falling clip). Pass a new set on every change; an empty one holds nothing. */
  setWithheldRefs(refs: ReadonlySet<number>): void {
    this.withheldRefs = refs.size > 0 ? refs : undefined;
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
      focused = NO_REFS,
      workAreas = NO_WORK_AREAS,
      orderMarkers = NO_ORDER_MARKERS,
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
    this.syncRoads(snapshot);
    this.terrain.cull(vp);
    this.terrain.animate(tick + alpha);
    // Game seconds, so a pause freezes the weather with the world.
    const gameSeconds = (tick + alpha) / TICKS_PER_SECOND;
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    const weatherView = { camera, screenW, screenH, viewport: cameraViewport(camera, screenW, screenH) };
    this.weather = this.climate.step({
      field: this.weatherField,
      viewport: weatherView.viewport,
      gameSeconds,
      enabled: this.weatherEnabled,
    });
    const wind = windSway(this.weather);
    if (!sameWindSway(wind, this.wind)) this.wind = wind;
    this.weatherGround.update(this.weather, weatherView, gameSeconds);
    // The fog first: the sky reads the band it just drew.
    const fogFrame = this.fog.update(snapshot, vp, this.elevation);
    this.weatherSky.update(this.weather, weatherView, gameSeconds);
    this.sceneLight.update({ screenW, screenH, gameSeconds });
    this.mapObjects.update(vp, tick, this.fog.cellStateAt, fogFrame.fogEpoch, tick + alpha, this.wind);
    const portrait = this.portrait.subjects();
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
      wind: this.wind,
      shadowStyle: this.enhancements.softShadows ? DEFAULT_SHADOW_STYLE : undefined,
      ...fogFrame,
      ...(this.withheldRefs !== undefined ? { withheldRefs: this.withheldRefs } : {}),
      ...(this.highlight.size > 0 ? { highlight: this.highlight } : {}),
      ...(portrait.ref !== null ? { portraitRef: portrait.ref } : {}),
      ...(portrait.house !== null ? { portraitHouse: portrait.house } : {}),
      ...(portrait.others.length > 0 ? { insetRefs: portrait.others } : {}),
    });
    this.marks.draw({
      snapshot,
      drawn: this.pool,
      elevation: this.elevation,
      viewport: vp,
      renderTime: tick + alpha,
      damaged: this.pool.damagedBuildings(),
      wind: this.wind,
      ships: this.pool.shipsAfloat(),
      water: this.terrain.waterField(),
      selection,
      flagged,
      focused,
      workAreas,
      orderMarkers,
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

  /** The portrait insets drawn after the main render this frame (the details panel's, a window's
   *  houses); an empty list draws none. */
  setPortraitInsets(frames: readonly PortraitInsetFrame[]): void {
    this.portrait.set(frames);
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
    this.weatherGround.destroy();
    this.weatherSky.destroy();
    this.sceneLight.destroy();
    this.terrain.destroy();
    this.mapObjects.dispose();
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
