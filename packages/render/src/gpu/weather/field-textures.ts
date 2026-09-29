import { BufferImageSource } from 'pixi.js';
import type { Viewport } from '../../data/projection/viewport.js';
import { WEATHER_SNAP_SECONDS } from '../../data/weather/climate.js';
import { WEATHER_SECTOR_NODES, type WeatherField, weatherFieldTexels } from '../../data/weather/field.js';
import { WEATHER_NODES_PER_WORLD_X, WEATHER_NODES_PER_WORLD_Y } from '../../data/weather/precipitation.js';
import { WEATHER_KINDS, type WeatherKind } from '../../data/weather/types.js';

/** A changed field (a script wrote new weather) cross-fades from the old one over this many game
 *  seconds, so particles thin out or fill in instead of popping. Tuned by eye. */
const FIELD_FADE_SECONDS = 4;
const KIND_COUNT = WEATHER_KINDS.length;

const DRY: WeatherField = { sectorsX: 1, sectorsY: 1, amounts: new Float32Array(KIND_COUNT), any: false };

function sourceOf(field: WeatherField): BufferImageSource {
  // Linear filtering between texel centres on sector centres is the original's bilinear lookup; the
  // edge clamp repeats the border sectors past the map as the CPU lookup does.
  return new BufferImageSource({
    resource: weatherFieldTexels(field),
    width: field.sectorsX,
    height: field.sectorsY,
    format: 'rgba8unorm',
    scaleMode: 'linear',
    addressMode: 'clamp-to-edge',
  });
}

/**
 * The weather field as two GPU textures, the previous and the current one, with the cross-fade between
 * them and the strongest amount per kind over the view, which sizes each particle draw.
 */
export class WeatherFieldTextures {
  private previous: WeatherField = DRY;
  private current: WeatherField = DRY;
  previousSource: BufferImageSource = sourceOf(DRY);
  currentSource: BufferImageSource = sourceOf(DRY);
  /** 0 shows the previous field, 1 the current one. */
  mix = 1;
  private readonly retired: BufferImageSource[] = [];
  private fadeStart: number | null = null;
  private fadePending = false;
  private lastSeconds: number | null = null;

  /** True when either field holds any weather. */
  get any(): boolean {
    return this.current.any || (this.mix < 1 && this.previous.any);
  }

  /** Sectors times sector nodes per axis: the shader's node-to-texture-coordinate divisor. */
  get nodeSpanX(): number {
    return this.current.sectorsX * WEATHER_SECTOR_NODES;
  }

  get nodeSpanY(): number {
    return this.current.sectorsY * WEATHER_SECTOR_NODES;
  }

  /** Replace the field. The old sources stay alive until {@link dropRetired}, after every shader has
   *  re-bound the new ones. */
  set(field: WeatherField | null): void {
    const next = field ?? DRY;
    if (next === this.current) return;
    const sameGrid = next.sectorsX === this.current.sectorsX && next.sectorsY === this.current.sectorsY;
    this.retired.push(this.previousSource, this.currentSource);
    if (sameGrid && (this.current.any || this.previous.any)) {
      // Fade from what is on screen now, even mid-fade.
      this.previous = this.blended();
      this.previousSource = sourceOf(this.previous);
      this.fadePending = true;
      this.mix = 0;
    } else {
      this.previous = next;
      this.previousSource = sourceOf(next);
      this.fadePending = false;
      this.fadeStart = null;
      this.mix = 1;
    }
    this.current = next;
    this.currentSource = sourceOf(next);
  }

  /** Advance the cross-fade on game seconds; a pause holds it and a jump completes it. */
  advance(gameSeconds: number): void {
    const last = this.lastSeconds;
    this.lastSeconds = gameSeconds;
    if (this.fadePending) {
      this.fadePending = false;
      this.fadeStart = gameSeconds;
    }
    if (this.fadeStart === null) return;
    const jumped = last !== null && (gameSeconds < last || gameSeconds - last > WEATHER_SNAP_SECONDS);
    this.mix = jumped ? 1 : Math.min(1, Math.max(0, (gameSeconds - this.fadeStart) / FIELD_FADE_SECONDS));
    if (this.mix >= 1) this.fadeStart = null;
  }

  /** The strongest blended amount of `kind` among the sectors whose bilinear reach touches `viewport`. */
  maxAmount(kind: WeatherKind, viewport: Viewport): number {
    const k = WEATHER_KINDS.indexOf(kind);
    const { sectorsX, sectorsY } = this.current;
    const sector = (world: number, nodesPerWorld: number, sectors: number, edge: number): number =>
      Math.min(sectors - 1, Math.max(0, Math.floor((world * nodesPerWorld) / WEATHER_SECTOR_NODES) + edge));
    const x0 = sector(viewport.minX, WEATHER_NODES_PER_WORLD_X, sectorsX, -1);
    const x1 = sector(viewport.maxX, WEATHER_NODES_PER_WORLD_X, sectorsX, 1);
    const y0 = sector(viewport.minY, WEATHER_NODES_PER_WORLD_Y, sectorsY, -1);
    const y1 = sector(viewport.maxY, WEATHER_NODES_PER_WORLD_Y, sectorsY, 1);
    let max = 0;
    for (let sy = y0; sy <= y1; sy++) {
      for (let sx = x0; sx <= x1; sx++) {
        const i = (sy * sectorsX + sx) * KIND_COUNT + k;
        const amount = this.blendAt(i);
        if (amount > max) max = amount;
      }
    }
    return max;
  }

  dropRetired(): void {
    for (const source of this.retired) source.destroy();
    this.retired.length = 0;
  }

  destroy(): void {
    this.dropRetired();
    this.previousSource.destroy();
    this.currentSource.destroy();
  }

  private blendAt(i: number): number {
    const current = this.current.amounts[i] ?? 0;
    if (this.mix >= 1) return current;
    const previous = this.previous.amounts[i] ?? 0;
    return previous + (current - previous) * this.mix;
  }

  private blended(): WeatherField {
    const amounts = new Float32Array(this.current.amounts.length);
    for (let i = 0; i < amounts.length; i++) amounts[i] = this.blendAt(i);
    const { sectorsX, sectorsY } = this.current;
    return { sectorsX, sectorsY, amounts, any: amounts.some((amount) => amount > 0) };
  }
}
