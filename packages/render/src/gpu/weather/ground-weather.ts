import { Container } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { ElevationField, WaterField } from '../../data/terrain/index.js';
import { WeatherCover } from '../../data/weather/cover.js';
import type { WeatherField } from '../../data/weather/field.js';
import type { WeatherConditions } from '../../data/weather/types.js';
import { groundBudget, weatherActivity } from './ground-budget.js';
import { buildGroundMask } from './ground-mask.js';
import { GroundReactions } from './ground-reactions.js';

/** The terrain's side of the cover hook (`TerrainLayer.setWeatherCover`). */
export interface WeatherCoverTarget {
  setWeatherCover(texels: Uint8Array | null, sectorsX: number, sectorsY: number): void;
}

/** The map ground the reactions read: its size in cells, water and lift. */
export interface WeatherGroundTerrain {
  readonly width: number;
  readonly height: number;
  readonly water: WaterField;
  readonly elevation: ElevationField;
}

/** This frame's main view. */
export interface WeatherGroundView {
  readonly camera: Camera;
  /** CSS px. */
  readonly screenW: number;
  readonly screenH: number;
}

/**
 * The ground's reaction to the weather, render-only: wet, snowy and dusty terrain through the
 * terrain shader's cover hook, and splashes, water rings and drifting wisps in {@link container},
 * which the world mounts above the ground and below everything that occludes it.
 */
export class WeatherGround {
  readonly container = new Container();
  private readonly cover = new WeatherCover();
  private readonly reactions = new GroundReactions();
  private field: WeatherField | null = null;
  private terrain: WeatherGroundTerrain | null = null;
  private groundReady = false;
  private enabled = true;
  private coverShown = false;

  constructor(private readonly target: WeatherCoverTarget) {
    this.container.addChild(this.reactions.mesh);
  }

  /** Call once per map, after the terrain is set: the next field starts its cover at equilibrium. */
  setTerrain(terrain: WeatherGroundTerrain): void {
    this.terrain = terrain;
    this.groundReady = false;
    this.cover.setField(null);
    this.coverShown = false;
    if (this.field !== null) this.setField(this.field);
  }

  /** The map's weather field, again after every change (a script's `SetWeather`); null for none. */
  setField(field: WeatherField | null): void {
    this.field = field;
    this.cover.setField(field);
    if (field !== null) this.reactions.setField(field);
  }

  /** Off hides every ground effect and draws the terrain as without weather; on starts from the
   *  equilibrium again. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
      return;
    }
    this.cover.setField(null);
    this.cover.setField(this.field);
  }

  /** Once per frame, after the camera settles. `conditions` null means a clear sky. */
  update(conditions: WeatherConditions | null, view: WeatherGroundView, gameSeconds: number): void {
    const field = this.field;
    if (!this.enabled || field === null || this.terrain === null) {
      this.hide();
      return;
    }
    if (this.cover.advance(gameSeconds)) this.showCover(this.cover.any);
    if (!field.any || conditions === null) {
      this.reactions.hide();
      return;
    }
    const zoom = view.camera.scale ?? 1;
    const minX = -view.camera.offsetX / zoom;
    const minY = -view.camera.offsetY / zoom;
    const width = view.screenW / zoom;
    const height = view.screenH / zoom;
    const centreHx = (minX + width / 2) / TILE_HALF_W;
    const centreHy = (2 * (minY + height / 2)) / TILE_HALF_H;
    const activity = weatherActivity(conditions, field, centreHx, centreHy);
    const budget = groundBudget(view.screenW, view.screenH, activity, conditions);
    if (budget.splashes + budget.ripples + budget.wisps > 0 && !this.groundReady) {
      // Built on first need, so a dry map never pays for the per-cell mask.
      this.reactions.setGround(
        buildGroundMask(this.terrain.width, this.terrain.height, this.terrain.water, this.terrain.elevation),
      );
      this.groundReady = true;
    }
    // Wind arrives in screen px per second; the reactions live in world px.
    this.reactions.draw(
      { minX, minY, width, height },
      budget,
      activity,
      conditions.windX / zoom,
      conditions.windY / zoom,
      gameSeconds,
    );
  }

  destroy(): void {
    this.target.setWeatherCover(null, 0, 0);
    this.reactions.destroy();
    this.container.destroy({ children: true });
  }

  private showCover(any: boolean): void {
    if (any) {
      this.target.setWeatherCover(this.cover.texels(), this.cover.sectorsX, this.cover.sectorsY);
      this.coverShown = true;
    } else if (this.coverShown) {
      this.target.setWeatherCover(null, 0, 0);
      this.coverShown = false;
    }
  }

  private hide(): void {
    this.reactions.hide();
    if (this.coverShown) {
      this.target.setWeatherCover(null, 0, 0);
      this.coverShown = false;
    }
  }
}
