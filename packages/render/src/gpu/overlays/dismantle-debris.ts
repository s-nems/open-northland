import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import {
  type DismantleChip,
  dismantleChips,
  dismantleDustOrigins,
  MAX_DISMANTLE_CHIPS,
  poseDismantleChip,
  poseDismantleDust,
} from '../../data/effects/dismantle-debris.js';
import { frac } from '../../data/effects/random.js';
import type { DamageEffectTextures } from '../building-damage/effect-textures.js';
import { isDrawableResource, type readable2dContext } from '../drawable-resource.js';
import { worldBatched } from '../world-batcher.js';

/** Retained, ordinary world-batched chips and local dust. No per-frame geometry or pixel readbacks. */
export class DismantleDebris {
  readonly display = new Container();
  private readonly bits: { origin: DismantleChip; chip: Graphics }[] = [];
  private readonly puffs: { origin: DismantleChip; sprite: Sprite }[] = [];
  private readonly dustPose = { x: 0, y: 0, rotation: 0, alpha: 0, scaleX: 0, scaleY: 0 };
  private dustSpan = 0;
  private readonly pose = { x: 0, y: 0, rotation: 0, alpha: 0 };

  add(
    view: Texture,
    removal: Uint8ClampedArray,
    x: number,
    y: number,
    scale: number,
    seed: number,
    ctx: ReturnType<typeof readable2dContext>,
  ): void {
    const { width, height } = view;
    const resource: unknown = view.source.resource;
    if (ctx === null || !isDrawableResource(resource) || width > 1024 || height > 1024) return;
    let pixels: Uint8ClampedArray;
    try {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(resource, view.frame.x, view.frame.y, width, height, 0, 0, width, height);
      pixels = ctx.getImageData(0, 0, width, height).data;
    } catch {
      return;
    }
    for (const sample of dismantleChips(pixels, removal, width, height, seed)) {
      if (this.bits.length >= MAX_DISMANTLE_CHIPS) break;
      const origin = { ...sample, x: x + sample.x * scale, y: y + sample.y * scale };
      const length = 1.3 + frac(sample.seed, 10) * 3.5;
      const thickness = 0.7 + frac(sample.seed, 11) * 1.2;
      const chip = worldBatched(new Graphics())
        .poly([-length, 0, -length * 0.5, -thickness, length, -thickness * 0.5, length * 0.7, thickness])
        .fill(sample.colour)
        .moveTo(-length * 0.5, -thickness)
        .lineTo(length, -thickness * 0.5)
        .stroke({ color: 0xd4bc8f, width: 0.65, alpha: 0.4 });
      this.display.addChild(chip);
      this.bits.push({ origin, chip });
    }
  }

  /** All body layers have supplied their samples before the dust budget is distributed. */
  addDust(width: number, height: number, seed: number, art: DamageEffectTextures): void {
    this.dustSpan = Math.max(width / 2, height * 0.33);
    for (const origin of dismantleDustOrigins(
      this.bits.map((bit) => bit.origin),
      seed,
    )) {
      const sprite = worldBatched(new Sprite(art.smoke[Math.floor(frac(origin.seed, 31) * 4)]));
      sprite.anchor.set(0.5);
      sprite.tint = DUST_COLOURS[Math.floor(frac(origin.seed, 32) * DUST_COLOURS.length)] ?? DUST_COLOURS[0];
      this.display.addChild(sprite);
      this.puffs.push({ origin, sprite });
    }
  }

  draw(age: number, ground: number): void {
    const pose = this.pose;
    for (const { origin, chip } of this.bits) {
      poseDismantleChip(pose, origin, age, ground);
      chip.position.set(pose.x, pose.y);
      chip.rotation = pose.rotation;
      chip.alpha = pose.alpha;
    }
    const dust = this.dustPose;
    for (const { origin, sprite } of this.puffs) {
      poseDismantleDust(dust, origin, age, this.dustSpan);
      sprite.position.set(dust.x, dust.y);
      sprite.scale.set(dust.scaleX, dust.scaleY);
      sprite.rotation = dust.rotation;
      sprite.alpha = dust.alpha;
    }
  }

  destroy(): void {
    this.display.destroy({ children: true, context: true });
  }
}

const DUST_COLOURS = [0xf0eddf, 0xd9d5c9, 0xe7dfca] as const;
