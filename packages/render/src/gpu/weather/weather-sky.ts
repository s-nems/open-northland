import { Container } from 'pixi.js';
import type { Camera } from '../../data/projection/iso.js';
import { cameraViewport } from '../../data/projection/viewport.js';
import { WEATHER_SNAP_SECONDS } from '../../data/weather/climate.js';
import type { WeatherField } from '../../data/weather/field.js';
import { particleCount, stormOf, weatherIntensity, zoomSize } from '../../data/weather/precipitation.js';
import type { WeatherConditions, WeatherKind } from '../../data/weather/types.js';
import { type AtmosphereFrame, WeatherAtmosphere } from './atmosphere.js';
import { atmosphereLook } from './atmosphere-look.js';
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
  private windTravelX = 0;
  private windTravelY = 0;
  private lastSeconds: number | null = null;

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
    this.advanceWind(conditions, gameSeconds);
    this.field.advance(gameSeconds);
    if (!this.enabled) {
      this.hide();
      return;
    }
    const { camera, screenW, screenH } = view;
    const zoom = camera.scale ?? 1;
    const look = atmosphereLook(conditions.amounts, conditions.flash);
    if (!look.visible && !this.field.any) {
      this.hide();
      return;
    }
    this.container.visible = true;
    const flashing = flashingStrike(conditions.strikes, gameSeconds);
    const frame: PrecipitationFrame & AtmosphereFrame = {
      screenW,
      screenH,
      offsetX: camera.offsetX,
      offsetY: camera.offsetY,
      zoom,
      gameSeconds,
      windTravelX: this.windTravelX,
      windTravelY: this.windTravelY,
      windX: conditions.windX,
      windY: conditions.windY,
      storm: conditions.storm,
      sizeScale: zoomSize(zoom),
      flashX: flashing?.screenX ?? FLASH_UNPLACED,
      flashY: flashing?.screenY ?? FLASH_UNPLACED,
    };
    this.atmosphere.update(look, frame);
    const viewport = cameraViewport(camera, screenW, screenH);
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
    this.bolt.update(conditions, gameSeconds, screenW, screenH);
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

  /** Integrates the wind on game seconds: a pause holds it, a jump skips it. */
  private advanceWind(conditions: WeatherConditions, gameSeconds: number): void {
    const last = this.lastSeconds;
    this.lastSeconds = gameSeconds;
    if (last === null) return;
    const dt = gameSeconds - last;
    if (dt <= 0 || dt > WEATHER_SNAP_SECONDS) return;
    this.windTravelX += conditions.windX * dt;
    this.windTravelY += conditions.windY * dt;
  }
}
