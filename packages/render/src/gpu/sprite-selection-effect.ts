import { Graphics } from 'pixi.js';
import { BloodSurfaceSprite } from './blood-surface.js';

/** One world-batch value: negative draws a tinted silhouette; positive lifts colours towards white. */
export class SelectionSprite extends BloodSurfaceSprite {
  private effect = 0;
  private blood = 0;

  get bloodEffect(): number {
    return this.blood;
  }

  set bloodEffect(packed: number) {
    if (packed === this.blood) return;
    this.blood = packed;
    this.onViewUpdate();
  }

  get selectionEffect(): number {
    return this.effect;
  }

  set selectionEffect(amount: number) {
    if (amount === this.effect) return;
    this.effect = amount;
    this.onViewUpdate();
  }
}

export class SelectionGraphics extends Graphics {
  private effect = 0;
  get selectionEffect(): number {
    return this.effect;
  }
  set selectionEffect(amount: number) {
    if (amount === this.effect) return;
    this.effect = amount;
    this.onViewUpdate();
  }
}

export function spriteSelectionEffect(sprite: object | null): number {
  return sprite instanceof SelectionSprite || sprite instanceof SelectionGraphics
    ? sprite.selectionEffect
    : 0;
}

export function spriteBloodEffect(sprite: object | null): number {
  return sprite instanceof SelectionSprite ? sprite.bloodEffect : 0;
}
