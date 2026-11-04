import { Container, Filter, Rectangle, type Renderer } from 'pixi.js';
import type { Camera } from '../../data/projection/iso.js';
import type { Viewport } from '../../data/projection/viewport.js';
import { WEATHER_SNAP_SECONDS } from '../../data/weather/climate.js';
import type { WeatherField } from '../../data/weather/field.js';
import {
  PrecipitationTravel,
  particleCount,
  stormOf,
  weatherIntensity,
  zoomSize,
} from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherConditions, type WeatherKind } from '../../data/weather/types.js';
import type { FogWashMask } from '../overlays/index.js';
import { glProgramFor } from '../shaders/program-source.js';
import { type AtmosphereFrame, WeatherAtmosphere } from './atmosphere.js';
import { atmosphereLook, atmosphereLookScratch } from './atmosphere-look.js';
import { WeatherFieldTextures } from './field-textures.js';
import { flashingStrike, LightningBolt } from './lightning-bolt.js';
import { type PrecipitationFrame, PrecipitationLayer } from './precipitation-layer.js';
import { WISP_UPSCALE_SOURCE } from './precipitation-shader.js';
import { WeatherReach } from './weather-reach.js';

/** Paint order of the particle kinds: dust behind snow behind rain, the sand's wisps behind its dashes. */
const PARTICLE_ORDER: readonly WeatherKind[] = ['sand', 'snow', 'rain'];
/** The sand's large soft wisps draw into a target at this share of the world's draw resolution and are
 *  scaled up bilinearly. At full size they blend several screens of fill per frame in a sandstorm, the
 *  dearest part of the weather on a weak GPU; their edges fade over tens of px, so the coarser target
 *  stays within a few levels of the full-size picture. */
const WISP_RESOLUTION_SHARE = 0.5;
/** Screen fraction a flash without a strike lights around: the sky above the view's middle. */
const FLASH_UNPLACED = 0.5;

/** The camera and screen the sky is framed on: the main view's camera after any device-pixel snap. */
export interface WeatherSkyView {
  readonly camera: Camera;
  readonly screenW: number;
  readonly screenH: number;
  /** World rectangle the camera frames: `cameraViewport(camera, screenW, screenH)`. */
  readonly viewport: Viewport;
  /** Device px per screen px the world and its sky draw at. */
  readonly resolution: number;
}

type SkyFrame = {
  -readonly [K in keyof (PrecipitationFrame & AtmosphereFrame)]: (PrecipitationFrame & AtmosphereFrame)[K];
};

/** True when the view holds no weather at all: no amount left fading and no flash. */
function stillAir(conditions: WeatherConditions): boolean {
  if (conditions.flash > 0) return false;
  for (const kind of WEATHER_KINDS) if (conditions.amounts[kind] > 0) return false;
  return true;
}

/**
 * The weather in the air: atmosphere grade and veil, then precipitation particles, then the lightning
 * bolt, in one container that belongs above the world layer and below the HUD and screen chrome. On a
 * dry view or with the setting off it draws nothing, and per frame it costs uniform writes plus a
 * sector scan of the visible field.
 */
export class WeatherSky {
  readonly container = new Container();
  private readonly field = new WeatherFieldTextures();
  private readonly reach = new WeatherReach();
  private readonly atmosphere: WeatherAtmosphere;
  private readonly layers: Readonly<Record<WeatherKind, PrecipitationLayer>>;
  /** The sand's wisps, apart from its dashes, in {@link wispAir}. */
  private readonly sandWisps: PrecipitationLayer;
  private readonly wispAir = new Container();
  /** Pixi takes a filter's resolution as absolute, so it follows the view's on every frame. */
  private readonly wispUpscale: Filter;
  private readonly wispArea = new Rectangle();
  private readonly bolt: LightningBolt;
  private enabled = true;
  private readonly travel = new PrecipitationTravel();
  private lastSeconds: number | null = null;
  private readonly look = atmosphereLookScratch();
  private readonly frame: SkyFrame = {
    screenW: 0,
    screenH: 0,
    offsetX: 0,
    offsetY: 0,
    zoom: 1,
    gameSeconds: 0,
    travel: this.travel,
    windX: 0,
    windY: 0,
    storm: 0,
    gust: 0,
    sizeScale: 1,
    flashX: FLASH_UNPLACED,
    flashY: FLASH_UNPLACED,
  };
  /** The flashing strike's ground point in world px, fixed when it struck so a pan does not slide it. */
  private anchorId: number | null = null;
  private anchorWorldX = 0;
  private anchorWorldY = 0;

  /** `renderer` bakes the atmosphere's noise here, as the map loads. */
  constructor(renderer: Renderer) {
    this.container.label = 'weather-sky';
    this.atmosphere = new WeatherAtmosphere(this.container, this.reach, renderer);
    const layers = {
      rain: new PrecipitationLayer('rain', this.field, this.reach),
      snow: new PrecipitationLayer('snow', this.field, this.reach),
      sand: new PrecipitationLayer('sand', this.field, this.reach),
    };
    this.sandWisps = new PrecipitationLayer('sand', this.field, this.reach, true);
    this.wispUpscale = new Filter({
      glProgram: glProgramFor(WISP_UPSCALE_SOURCE),
      resources: {},
      resolution: WISP_RESOLUTION_SHARE,
    });
    this.wispAir.filters = [this.wispUpscale];
    this.wispAir.filterArea = this.wispArea;
    this.wispAir.addChild(this.sandWisps.mesh);
    this.container.addChild(this.wispAir);
    for (const kind of PARTICLE_ORDER) this.container.addChild(layers[kind].mesh);
    this.layers = layers;
    this.bolt = new LightningBolt(this.container);
  }

  /** The map's weather; call on map load and whenever a script rewrites it. A change cross-fades. */
  setField(field: WeatherField | null): void {
    this.field.set(field);
    for (const layer of this.particleLayers()) layer.bindField();
    this.field.dropRetired();
  }

  /** The map's size in cells; weather fades out over its outermost sector. */
  setMapSize(cellsWide: number, cellsHigh: number): void {
    this.reach.setMap(cellsWide, cellsHigh);
  }

  /** The fog wash the weather keeps off the unexplored parts of; read on every {@link update}. */
  watchFog(mask: FogWashMask): void {
    this.reach.watchFog(mask);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.hide();
  }

  /** Once per rendered frame, after the climate stepped `conditions` on the same `gameSeconds`. */
  update(conditions: WeatherConditions, view: WeatherSkyView, gameSeconds: number): void {
    const { camera, screenW, screenH, viewport } = view;
    const zoom = camera.scale ?? 1;
    const sizeScale = zoomSize(zoom);
    this.advanceTravel(conditions, gameSeconds, sizeScale);
    this.field.advance(gameSeconds);
    if (!this.enabled || (!this.field.any && stillAir(conditions))) {
      this.hide();
      return;
    }
    const look = atmosphereLook(conditions.amounts, conditions.flash, this.look);
    if (!look.visible && !this.field.any) {
      this.hide();
      return;
    }
    this.container.visible = true;
    if (this.reach.update()) {
      this.atmosphere.bindReach();
      for (const layer of this.particleLayers()) layer.bindReach();
    }
    const frame = this.frame;
    frame.screenW = screenW;
    frame.screenH = screenH;
    frame.offsetX = camera.offsetX;
    frame.offsetY = camera.offsetY;
    frame.zoom = zoom;
    frame.gameSeconds = gameSeconds;
    frame.windX = conditions.windX;
    frame.windY = conditions.windY;
    frame.storm = conditions.storm;
    frame.gust = conditions.gust;
    frame.sizeScale = sizeScale;
    const flashing = flashingStrike(conditions.strikes, gameSeconds);
    let shiftX = 0;
    let shiftY = 0;
    if (flashing === null) {
      frame.flashX = FLASH_UNPLACED;
      frame.flashY = FLASH_UNPLACED;
    } else {
      const struckX = flashing.screenX * screenW;
      const struckY = flashing.screenY * screenH;
      if (flashing.id !== this.anchorId) {
        this.anchorId = flashing.id;
        this.anchorWorldX = (struckX - camera.offsetX) / zoom;
        this.anchorWorldY = (struckY - camera.offsetY) / zoom;
      }
      shiftX = this.anchorWorldX * zoom + camera.offsetX - struckX;
      shiftY = this.anchorWorldY * zoom + camera.offsetY - struckY;
      frame.flashX = (struckX + shiftX) / screenW;
      frame.flashY = (struckY + shiftY) / screenH;
    }
    this.atmosphere.update(look, frame);
    for (const kind of PARTICLE_ORDER) {
      const layer = this.layers[kind];
      if (!this.field.any) {
        layer.hide();
        if (kind === 'sand') this.sandWisps.hide();
        continue;
      }
      const amount = this.field.maxAmount(kind, viewport);
      const intensity = weatherIntensity(kind, amount);
      const count = particleCount(kind, screenW, screenH, intensity, zoom, stormOf(kind, amount));
      layer.update(frame, count, intensity);
      if (kind === 'sand') this.sandWisps.update(frame, count, intensity);
    }
    this.fitWispAir(screenW, screenH, view.resolution);
    this.bolt.update(flashing, conditions.flash, screenW, screenH, shiftX, shiftY);
  }

  destroy(): void {
    this.atmosphere.destroy();
    for (const layer of this.particleLayers()) layer.destroy();
    this.bolt.destroy();
    this.field.destroy();
    this.container.destroy({ children: true });
  }

  private particleLayers(): PrecipitationLayer[] {
    return [...PARTICLE_ORDER.map((kind) => this.layers[kind]), this.sandWisps];
  }

  /** The wisp pass runs only while wisps show, over the whole screen. */
  private fitWispAir(screenW: number, screenH: number, resolution: number): void {
    this.wispAir.visible = this.sandWisps.mesh.visible;
    this.wispArea.set(0, 0, screenW, screenH);
    this.wispUpscale.resolution = resolution * WISP_RESOLUTION_SHARE;
  }

  private hide(): void {
    this.container.visible = false;
  }

  /** Integrates the particle travel on game seconds: a pause holds it, a jump skips it. */
  private advanceTravel(conditions: WeatherConditions, gameSeconds: number, sizeScale: number): void {
    const last = this.lastSeconds;
    this.lastSeconds = gameSeconds;
    if (last === null) return;
    const dt = gameSeconds - last;
    if (dt <= 0 || dt > WEATHER_SNAP_SECONDS) return;
    this.travel.advance(dt, conditions.windX, conditions.windY, sizeScale);
  }
}
