import { describe, expect, it } from 'vitest';
import { placeLayers } from '../../../../src/hud/dom/knowledge/art.js';

const frame = (offsetX: number, offsetY: number, width: number, height: number) => ({
  bobId: 0,
  rect: { x: 0, y: 0, width, height },
  offsetX,
  offsetY,
});
const body = { stem: 'a', bob: 1, x: 0, y: 0 };
const part = { stem: 'b', bob: 2, x: 3, y: 0 };

describe('placeLayers', () => {
  it('boxes the body and its parts from their shared anchor', () => {
    const placed = placeLayers([body, part], (layer) =>
      layer === body ? frame(-10, -20, 10, 20) : frame(-5, -30, 4, 4),
    );
    expect([placed?.width, placed?.height]).toEqual([12, 30]);
    expect(placed?.frames.map((f) => [f.left, f.top])).toEqual([
      [0, 10],
      [8, 0],
    ]);
  });

  it('leaves out a part the sheet lacks, and the whole picture without its body', () => {
    expect(
      placeLayers([body, part], (layer) => (layer === body ? frame(0, 0, 4, 4) : undefined))?.frames,
    ).toHaveLength(1);
    expect(placeLayers([body, part], (layer) => (layer === part ? frame(0, 0, 4, 4) : undefined))).toBeNull();
  });
});
