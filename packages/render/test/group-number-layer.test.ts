import type { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { GroupNumberLayer } from '../src/gpu/overlays/group-number-layer.js';
import { cameraViewport } from '../src/index.js';
import { drawnGeometry, entity, snapshotOf } from './support/fixtures.js';

const SETTLER = 7;
const OTHER = 8;
const snapshot = snapshotOf([entity(SETTLER, 3, 4, { Settler: {} }), entity(OTHER, 4, 4, { Settler: {} })]);
const BOUNDS = { minX: 100, minY: 50, maxX: 140, maxY: 90 };
/** Both settlers drawn this frame. */
const drawn = drawnGeometry({ boundsOf: () => BOUNDS });

describe('GroupNumberLayer', () => {
  it('draws a digit for groups 1-3 and nothing for a number without a glyph', () => {
    const layer = new GroupNumberLayer();
    layer.draw(
      { snapshot, drawn },
      new Map([
        [SETTLER, 2],
        [OTHER, 4],
      ]),
    );
    expect(layer.container.children).toHaveLength(1);
    layer.destroy();
  });

  it('hangs the digit from the sprite top, right of its centre line', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, 1]]));
    const digit = layer.container.children[0];
    expect(digit?.position.y).toBe(BOUNDS.minY);
    expect(digit?.position.x).toBeGreaterThan((BOUNDS.minX + BOUNDS.maxX) / 2);
    expect(digit?.position.x).toBeLessThanOrEqual(BOUNDS.maxX);
    layer.destroy();
  });

  it('marks no member the pool did not draw, such as a man resting indoors', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn: drawnGeometry() }, new Map([[SETTLER, 1]]));
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });

  it('keeps its unzoomed screen size when zoomed out and its world size when zoomed in', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn, zoom: 0.5 }, new Map([[SETTLER, 1]]));
    expect(layer.container.children[0]?.scale.x).toBe(2);
    layer.draw({ snapshot, drawn, zoom: 2 }, new Map([[SETTLER, 1]]));
    expect(layer.container.children[0]?.scale.x).toBe(1);
    layer.destroy();
  });

  it('keeps the node while the number holds, swaps it on a new number and retires dropped members', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, 1]]));
    const first = layer.container.children[0] as Graphics;
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, 1]]));
    expect(layer.container.children[0]).toBe(first);

    layer.draw({ snapshot, drawn }, new Map([[SETTLER, 3]]));
    expect(layer.container.children[0]).not.toBe(first);
    expect(first.destroyed).toBe(true);

    layer.draw({ snapshot, drawn }, new Map());
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });

  it('skips a member off screen', () => {
    const layer = new GroupNumberLayer();
    const farAway = cameraViewport({ offsetX: -100_000, offsetY: -100_000 }, 800, 600, 0);
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, 1]]), farAway);
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });
});
