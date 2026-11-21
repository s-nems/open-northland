import { Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { BoundsUnion } from '../../../../src/gpu/sprite-pool/layers/box.js';
import { addStretchedBox, placeStretched } from '../../../../src/gpu/sprite-pool/layers/stretch.js';

describe('stretched layer', () => {
  it('lengthens a frame along its direction and widens it across, about its middle', () => {
    const box = { ox: -10, oy: -20, drawnOy: -20, hiddenTop: 0, width: 20, height: 40 };
    const along = Math.atan2(40, 20);
    const sprite = new Sprite();
    placeStretched(sprite, 1, box, { along, by: 1.5, across: 2 });
    sprite.updateLocalTransform();
    const at = (x: number, y: number) => sprite.localTransform.apply({ x, y });

    const middle = at(10, 20);
    expect(middle.x).toBeCloseTo(0);
    expect(middle.y).toBeCloseTo(0);
    // The far corner on the diagonal moves half as far again from the middle.
    const tip = at(20, 40);
    expect(tip.x).toBeCloseTo(15);
    expect(tip.y).toBeCloseTo(30);
    // A point straight across the diagonal moves twice as far from the middle.
    const across = at(10 + 4, 20 - 2);
    expect(across.x).toBeCloseTo(8);
    expect(across.y).toBeCloseTo(-4);
  });

  it('bounds exactly the quad it draws, an off-axis heading included', () => {
    const box = { ox: -10, oy: -20, drawnOy: -20, hiddenTop: 0, width: 20, height: 40 };
    const stretch = { along: Math.PI / 4, by: 0.8, across: 1 };
    const sprite = new Sprite();
    placeStretched(sprite, 1, box, stretch);
    sprite.updateLocalTransform();
    const corners = [
      [0, 0],
      [20, 0],
      [0, 40],
      [20, 40],
    ].map(([x, y]) => sprite.localTransform.apply({ x: x ?? 0, y: y ?? 0 }));
    const bounds = new BoundsUnion();
    addStretchedBox(bounds, box, stretch);
    expect(bounds.minX).toBeCloseTo(Math.min(...corners.map((c) => c.x)));
    expect(bounds.maxX).toBeCloseTo(Math.max(...corners.map((c) => c.x)));
    expect(bounds.minY).toBeCloseTo(Math.min(...corners.map((c) => c.y)));
    expect(bounds.maxY).toBeCloseTo(Math.max(...corners.map((c) => c.y)));
  });
});
