import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { smokePuff } from '../../data/effects/smoke.js';
import type { WindSway } from '../../data/weather/climate.js';
import { worldBatched } from '../world-batcher.js';
import { type DamageEffectTextures, FIRE_FRAMES, FIRE_VARIANTS } from './effect-textures.js';
import { DamageRubble, type GroundContact } from './rubble.js';
import { noise } from './surface.js';

export interface DamageOrigin {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly seed: number;
  readonly colour: number;
}

/** All marks ride the building's depth-sorted parent, so a nearer house also occludes its neighbour's
 * fire. Animation is driven by render ticks and freezes when the game pauses. */
export class DamageEffects {
  readonly container = new Container();
  private readonly smoke: Sprite[] = [];
  private readonly flames: Sprite[] = [];
  private readonly embers: Sprite[] = [];
  private readonly chips: Graphics[] = [];
  private readonly rubble: DamageRubble;
  private hitTick = -Infinity;
  private readonly pose = { x: 0, y: 0, radius: 0, alpha: 0 };
  private lastHp: number | undefined;

  constructor(
    private readonly art: DamageEffectTextures,
    private readonly seed: number,
  ) {
    this.rubble = new DamageRubble(seed);
    this.container.addChild(this.rubble.graphics);
    for (let i = 0; i < 18; i++) {
      const puff = worldBatched(new Sprite(art.smoke[i % 4] ?? Texture.EMPTY));
      puff.anchor.set(0.5);
      this.smoke.push(puff);
      this.container.addChild(puff);
    }
    for (let i = 0; i < 4; i++) {
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
      const length = 1.5 + noise(seed, i + 310) * 3;
      const width = 0.4 + noise(seed, i + 320);
      const chip = worldBatched(new Graphics())
        .poly([-length, -width, length, -width * 0.4, length * 0.6, width, -length * 0.4, width * 0.7])
        .fill(0xffffff);
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
    ground: readonly GroundContact[],
  ): void {
    this.rubble.draw(ground, stage, detailed);
    if (this.lastHp !== undefined && hp < this.lastHp - 0.0001) this.hitTick = tick;
    this.lastHp = hp;
    const fire = detailed && stage >= 4;
    const fires = !fire
      ? 0
      : Math.min(origins.length, zoom < 0.65 ? 1 : stage - 3 + Math.floor(noise(this.seed, 71) * 2));
    const count = stage < 3 ? 0 : !detailed || zoom < 0.65 ? 1 : Math.min(3, Math.max(1, fires));
    const perPlume = detailed && zoom >= 0.65 ? 6 : 3;
    for (let i = 0; i < this.smoke.length; i++) {
      const puff = this.smoke[i];
      if (puff === undefined) continue;
      const e = Math.floor(i / 6),
        p = i % 6;
      const origin = origins[e];
      puff.visible = e < count && p < perPlume && origin !== undefined;
      if (!puff.visible || origin === undefined) continue;
      const pose = smokePuff(
        this.seed,
        e,
        p * (6 / perPlume),
        tick * (0.55 + noise(origin.seed, 12) * 0.35),
        wind,
        this.pose,
      );
      const scale = Math.max(0.55, Math.min(1.85, origin.size / 17)) * (stage === 6 ? 1.2 : 1);
      puff.position.set(origin.x + pose.x * scale, origin.y + pose.y * scale - 3);
      puff.scale.set(
        pose.radius * scale * (0.05 + noise(origin.seed, 13) * 0.025),
        pose.radius * scale * 0.066,
      );
      puff.rotation = noise(this.seed, i + 20) * 2 + tick * 0.002;
      puff.alpha = pose.alpha * (fire ? 0.6 : 0.34);
      puff.tint = fire ? (noise(origin.seed, 14) > 0.5 ? 0x999084 : 0x777570) : 0xd6cfc3;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const flame = this.flames[i];
      if (flame === undefined) continue;
      const origin = origins[i];
      flame.visible = i < fires && origin !== undefined;
      if (!flame.visible || origin === undefined) continue;
      const phase = noise(origin.seed, 100) * Math.PI * 2;
      const frame = Math.floor(tick * (1.1 + noise(origin.seed, 101) * 1.1) + phase * 4) % FIRE_FRAMES;
      const variant = Math.floor(noise(origin.seed, 102) * FIRE_VARIANTS);
      flame.texture = this.art.flames[variant * FIRE_FRAMES + frame] ?? Texture.EMPTY;
      const size =
        Math.max(0.3, Math.min(0.9, origin.size / 34)) * (stage === 6 ? 1.35 : stage === 5 ? 1.1 : 0.85);
      const breathe = 1 + Math.sin(tick * (0.07 + noise(origin.seed, 103) * 0.06) + phase) * 0.12;
      flame.position.set(origin.x, origin.y + 2);
      flame.scale.set(
        size * (noise(origin.seed, 104) < 0.5 ? -1 : 1) * (0.75 + noise(origin.seed, 105) * 0.6),
        size * (0.75 + noise(origin.seed, 106) * 0.5) * breathe,
      );
      flame.skew.x = -(wind?.direction ?? 0) * (wind?.strength ?? 0) * 0.26;
      flame.alpha = 0.93;
    }
    for (let i = 0; i < this.embers.length; i++) {
      const ember = this.embers[i];
      const origin = origins[i % Math.max(1, fires)];
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
      chip.tint = origin.colour;
      chip.alpha = Math.min(1, (13 - age) / 4);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
