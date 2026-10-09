import { Sprite } from 'pixi.js';

export class BloodSurfaceSprite extends Sprite {
  refreshBlood(): void {
    this.onViewUpdate();
  }
}

export interface BloodSurface {
  sprite: BloodSurfaceSprite;
  /** Three local splats and their packed age bytes; negative ages mean upright. */
  readonly packed: Float32Array;
  enabled: boolean;
  /** Pre-lift ground row prevents tall, distant silhouettes intercepting a nearby burst. */
  groundY: number;
  lift: number;
  flat: boolean;
  facade: boolean;
  /** Top of the receiving facade band in frame UVs; zero leaves ordinary scenery unclipped. */
  clipY: number;
  width: number;
  height: number;
}

const surfaces = new WeakMap<object, BloodSurface>();

/** A pooled slot is about to draw another layer. Pending contacts keep the detached receiver. */
export function detachBloodSurface(sprite: BloodSurfaceSprite): void {
  const surface = surfaces.get(sprite);
  if (surface === undefined) return;
  surface.enabled = false;
  surfaces.delete(sprite);
  sprite.refreshBlood();
}

/** Only solid scenery opts in; shadows, actors, selection stamps and ground covers do not. */
export function bloodSurface(
  sprite: BloodSurfaceSprite,
  groundY: number,
  {
    enabled = true,
    lift = 0,
    flat = false,
    facade = false,
  }: {
    enabled?: boolean;
    lift?: number;
    flat?: boolean;
    facade?: boolean;
  } = {},
  retained?: BloodSurface,
): BloodSurface {
  const clipY = facade
    ? Math.max(0.7, 1 - 40 / Math.max(1, sprite.texture.frame.height * Math.abs(sprite.scale.y)))
    : 0;
  let surface = retained ?? surfaces.get(sprite);
  if (surface === undefined) {
    surface = {
      sprite,
      packed: new Float32Array(4),
      enabled,
      groundY,
      lift,
      flat,
      facade,
      clipY,
      width: sprite.texture.frame.width,
      height: sprite.texture.frame.height,
    };
  }
  surface.sprite = sprite;
  surfaces.set(sprite, surface);
  if (surface.enabled !== enabled || surface.clipY !== clipY) sprite.refreshBlood();
  surface.enabled = enabled;
  surface.groundY = groundY;
  surface.lift = lift;
  surface.flat = flat;
  surface.facade = facade;
  surface.clipY = clipY;
  surface.width = sprite.texture.frame.width;
  surface.height = sprite.texture.frame.height;
  return surface;
}

export function surfaceOf(sprite: object | null): BloodSurface | undefined {
  return sprite === null ? undefined : surfaces.get(sprite);
}
