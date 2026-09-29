import { Container } from 'pixi.js';
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
import { type AtmosphereFrame, WeatherAtmosphere } from './atmosphere.js';
import { atmosphereLook, atmosphereLookScratch } from './atmosphere-look.js';
import { WeatherFieldTextures } from './field-textures.js';
import { flashingStrike, LightningBolt } from './lightning-bolt.js';
import { type PrecipitationFrame, PrecipitationLayer } from './precipitation-layer.js';

/** Paint order of the particle kinds: dust behind snow behind rain. */
const PARTICLE_ORDER: readonly WeatherKind[] = ['sand', 'snow', 'rain'];
/** Screen fraction a flash without a strike lights around: the sky above the view's middle. */
const FLASH_UNPLACED = 0.5;

/** The camera and screen the sky is framed on: the main view's camera after any device-pixel snap. */
export interface WeatherSkyView {
  readonly camera: Camera;
  readonly screenW: number;
  readonly screenH: number;
  /** World rectangle the camera frames: `cameraViewport(camera, screenW, screenH)`. */
  readonly viewport: Viewport;
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
  private readonly atmosphere: WeatherAtmosphere;
  private readonly layers: Readonly<Record<WeatherKind, PrecipitationLayer>>;
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

  constructor() {
    this.container.label = 'weather-sky';
    this.atmosphere = new WeatherAtmosphere(this.container);
    const layers = {
      rain: new PrecipitationLayer('rain', this.field),
      snow: new PrecipitationLayer('snow', this.field),
      sand: new PrecipitationLayer('sand', this.field),
    };
    for (const kind of PARTICLE_ORDER) this.container.addChild(layers[kind].mesh);
    this.layers = layers;
    this.bolt = new LightningBolt(this.container);
  }

  /** The map's weather; call on map load and whenever a script rewrites it. A change cross-fades. */
  setField(field: WeatherField | null): void {
    this.field.set(field);
    for (const kind of PARTICLE_ORDER) this.layers[kind].bindField();
    this.field.dropRetired();
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
        continue;
      }
      const amount = this.field.maxAmount(kind, viewport);
      const intensity = weatherIntensity(kind, amount);
      const count = particleCount(kind, screenW, screenH, intensity, zoom, stormOf(kind, amount));
      layer.update(frame, count, intensity);
    }
    this.bolt.update(flashing, conditions.flash, screenW, screenH, shiftX, shiftY);
  }

  destroy(): void {
    this.atmosphere.destroy();
    for (const kind of PARTICLE_ORDER) this.layers[kind].destroy();
    this.bolt.destroy();
    this.field.destroy();
    this.container.destroy({ children: true });
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
