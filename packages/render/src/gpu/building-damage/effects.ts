import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { smokePuff } from '../../data/effects/smoke.js';
import type { WindSway } from '../../data/weather/climate.js';
import { worldBatched } from '../world-batcher.js';
import { type DamageEffectTextures, FIRE_FRAMES } from './effect-textures.js';
import { noise } from './surface.js';

export interface DamageOrigin {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

/** All marks ride the building's depth-sorted parent, so a nearer house also occludes its neighbour's
 * fire. Animation is driven by render ticks and freezes when the game pauses. */
export class DamageEffects {
  readonly container = new Container();
  private readonly smoke: Sprite[] = [];
  private readonly flames: Sprite[] = [];
  private readonly embers: Sprite[] = [];
  private readonly chips: Graphics[] = [];
  private hitTick = -Infinity;
  private readonly pose = { x: 0, y: 0, radius: 0, alpha: 0 };
  private lastHp: number | undefined;

  constructor(
    private readonly art: DamageEffectTextures,
    private readonly seed: number,
  ) {
    for (let i = 0; i < 12; i++) {
      const puff = worldBatched(new Sprite(art.smoke[i % 4] ?? Texture.EMPTY));
      puff.anchor.set(0.5);
      this.smoke.push(puff);
      this.container.addChild(puff);
    }
    for (let i = 0; i < 2; i++) {
      const flame = worldBatched(new Sprite(art.flames[0] ?? Texture.EMPTY));
      flame.anchor.set(0.5, 0.91);
      this.flames.push(flame);
      this.container.addChild(flame);
    }
    for (let i = 0; i < 4; i++) {
      const ember = worldBatched(new Sprite(Texture.WHITE));
      ember.tint = i % 2 === 0 ? 0xe8a94b : 0xc56832;
      this.embers.push(ember);
      this.container.addChild(ember);
    }
    for (let i = 0; i < 8; i++) {
      const chip = new Graphics().poly([-2, -1, 2, -0.5, 1, 1, -1.5, 0.5]).fill(i % 2 ? 0x80694b : 0xab9270);
      this.chips.push(chip);
      this.container.addChild(chip);
    }
  }

  draw(
    origins: readonly DamageOrigin[],
    hp: number,
    stage: number,
    tick: number,
    wind: WindSway | undefined,
    detailed: boolean,
    zoom: number,
  ): void {
    if (this.lastHp !== undefined && hp < this.lastHp - 0.0001) this.hitTick = tick;
    this.lastHp = hp;
    const fire = detailed && stage >= 4;
    const count = stage < 3 ? 0 : detailed && stage >= 4 && zoom >= 0.65 ? 2 : 1;
    const perPlume = detailed && zoom >= 0.65 ? 6 : 3;
    for (let i = 0; i < this.smoke.length; i++) {
      const puff = this.smoke[i];
      if (puff === undefined) continue;
      const e = Math.floor(i / 6),
        p = i % 6;
      const origin = origins[e % Math.max(1, origins.length)];
      puff.visible = e < count && p < perPlume && origin !== undefined;
      if (!puff.visible || origin === undefined) continue;
      const pose = smokePuff(this.seed, e, p * (6 / perPlume), tick * 0.72, wind, this.pose);
      const scale = Math.max(0.65, Math.min(1.6, origin.size / 14));
      puff.position.set(origin.x + pose.x * scale, origin.y + pose.y * scale - 3);
      puff.scale.set(pose.radius * scale * 0.058, pose.radius * scale * 0.066);
      puff.rotation = noise(this.seed, i + 20) * 2 + tick * 0.002;
      puff.alpha = pose.alpha * (fire ? 0.6 : 0.34);
      puff.tint = fire ? 0x999084 : 0xd6cfc3;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i];
      if (flame === undefined) continue;
      const origin = origins[i];
      flame.visible = fire && i < count && origin !== undefined;
      if (!flame.visible || origin === undefined) continue;
      const frame = Math.floor(tick * 1.6 + noise(this.seed, i + 100) * FIRE_FRAMES) % FIRE_FRAMES;
      flame.texture = this.art.flames[frame] ?? Texture.EMPTY;
      const size = Math.max(0.33, Math.min(0.65, origin.size / 32)) * (stage === 5 ? 1.15 : 0.85);
      flame.position.set(origin.x, origin.y + 2);
      flame.scale.set(size, size * (0.86 + noise(this.seed, i + 110) * 0.25));
      flame.skew.x = -(wind?.direction ?? 0) * (wind?.strength ?? 0) * 0.26;
      flame.alpha = 0.93;
    }
    for (let i = 0; i < this.embers.length; i++) {
      const ember = this.embers[i];
      const origin = origins[i % 2];
      if (ember === undefined) continue;
      ember.visible = fire && zoom >= 0.8 && origin !== undefined;
      if (!ember.visible || origin === undefined) continue;
      const t = (((tick / 25 + noise(this.seed, i + 150)) % 1) + 1) % 1;
      ember.position.set(
        origin.x +
          (noise(this.seed, i + 160) - 0.5) * 15 * t +
          (wind?.direction ?? 0) * (wind?.strength ?? 0) * 20 * t * t,
        origin.y - t * 35,
      );
      ember.scale.set(0.65, 1.3);
      ember.alpha = Math.sin(t * Math.PI) * 0.65;
    }
    const age = tick - this.hitTick;
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      const origin = origins[i % Math.max(1, origins.length)];
      if (chip === undefined) continue;
      chip.visible = detailed && zoom >= 0.7 && age >= 0 && age < 13 && origin !== undefined;
      if (!chip.visible || origin === undefined) continue;
      const vx = (noise(this.seed, i + 210) - 0.5) * 3;
      chip.position.set(
        origin.x + vx * age,
        origin.y - (1 + noise(this.seed, i + 220)) * age + 0.23 * age * age,
      );
      chip.rotation = age * (noise(this.seed, i + 230) - 0.5);
      chip.alpha = Math.min(1, (13 - age) / 4);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
