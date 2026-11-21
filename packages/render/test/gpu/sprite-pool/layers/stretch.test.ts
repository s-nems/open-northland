import { Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { placeStretched } from '../../../../src/gpu/sprite-pool/layers/stretch.js';

describe('stretched layer', () => {
  it('lengthens a frame along its direction about its middle and keeps its width across', () => {
    const box = { ox: -10, oy: -20, drawnOy: -20, hiddenTop: 0, width: 20, height: 40 };
    const along = Math.atan2(40, 20);
    const sprite = new Sprite();
    placeStretched(sprite, 1, box, { along, by: 1.5 });
    sprite.updateLocalTransform();
    const at = (x: number, y: number) => sprite.localTransform.apply({ x, y });

    const middle = at(10, 20);
    expect(middle.x).toBeCloseTo(0);
    expect(middle.y).toBeCloseTo(0);
    // The far corner on the diagonal moves half as far again from the middle.
    const tip = at(20, 40);
    expect(tip.x).toBeCloseTo(15);
    expect(tip.y).toBeCloseTo(30);
    // A point straight across the diagonal from the middle stays where it was authored.
    const across = at(10 + 4, 20 - 2);
    expect(across.x).toBeCloseTo(4);
    expect(across.y).toBeCloseTo(-2);
  });
});
