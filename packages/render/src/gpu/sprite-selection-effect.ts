import { Graphics, Sprite } from 'pixi.js';

/** One world-batch value: negative draws a tinted silhouette; positive lifts colours towards white. */
export class SelectionSprite extends Sprite {
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
