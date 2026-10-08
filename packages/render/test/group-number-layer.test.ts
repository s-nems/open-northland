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

const labelOf = (layer: GroupNumberLayer, index = 0): Graphics => layer.container.children[index] as Graphics;

describe('GroupNumberLayer', () => {
  it('draws one label per member, wider for more groups', () => {
    const layer = new GroupNumberLayer();
    layer.draw(
      { snapshot, drawn },
      new Map([
        [SETTLER, '2'],
        [OTHER, '1,3,0'],
      ]),
    );
    expect(layer.container.children).toHaveLength(2);
    expect(labelOf(layer, 1).getLocalBounds().width).toBeGreaterThan(
      3 * labelOf(layer, 0).getLocalBounds().width,
    );
    layer.destroy();
  });

  it('stands the label on the sprite bottom, right of its centre line', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, '1']]));
    const label = labelOf(layer);
    expect(label.position.y).toBe(BOUNDS.maxY);
    expect(label.getLocalBounds().maxY).toBeLessThanOrEqual(1); // drawn upwards from the origin
    expect(label.position.x).toBeGreaterThan((BOUNDS.minX + BOUNDS.maxX) / 2);
    expect(label.position.x).toBeLessThanOrEqual(BOUNDS.maxX);
    layer.destroy();
  });

  it('marks no member the pool did not draw, such as a man resting indoors, nor a grouped building', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn: drawnGeometry() }, new Map([[SETTLER, '1']]));
    expect(layer.container.children).toHaveLength(0);

    const BARRACKS = 9;
    const withBuilding = snapshotOf([entity(BARRACKS, 3, 4, { Building: {} })]);
    layer.draw({ snapshot: withBuilding, drawn }, new Map([[BARRACKS, '1']]));
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });

  it('keeps its unzoomed screen size when zoomed out and its world size when zoomed in', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn, zoom: 0.5 }, new Map([[SETTLER, '1']]));
    expect(labelOf(layer).scale.x).toBe(2);
    layer.draw({ snapshot, drawn, zoom: 2 }, new Map([[SETTLER, '1']]));
    expect(labelOf(layer).scale.x).toBe(1);
    layer.destroy();
  });

  it('keeps the node while the label holds, swaps it on a new label and retires dropped members', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, '1']]));
    const first = labelOf(layer);
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, '1']]));
    expect(labelOf(layer)).toBe(first);

    layer.draw({ snapshot, drawn }, new Map([[SETTLER, '1,3']]));
    expect(labelOf(layer)).not.toBe(first);
    expect(first.destroyed).toBe(true);

    layer.draw({ snapshot, drawn }, new Map());
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });

  it('skips a member off screen', () => {
    const layer = new GroupNumberLayer();
    const farAway = cameraViewport({ offsetX: -100_000, offsetY: -100_000 }, 800, 600, 0);
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, '1']]), farAway);
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });
});
