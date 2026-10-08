import type { Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { GroupNumberLayer } from '../src/gpu/overlays/group-number-layer.js';
import { cameraViewport } from '../src/index.js';
import { drawnGeometry, entity, snapshotOf } from './support/fixtures.js';

const SETTLER = 7;
const OTHER = 8;
const snapshot = snapshotOf([entity(SETTLER, 3, 4, { Settler: {} }), entity(OTHER, 4, 4, { Settler: {} })]);
const FEET = { x: 120, y: 90 };
/** Both settlers drawn this frame, standing on {@link FEET}. */
const drawn = drawnGeometry({ anchorOf: () => FEET });

const labelOf = (layer: GroupNumberLayer, index = 0): Text => layer.container.children[index] as Text;

describe('GroupNumberLayer', () => {
  it('writes each member its group numbers, comma-joined', () => {
    const layer = new GroupNumberLayer();
    layer.draw(
      { snapshot, drawn },
      new Map([
        [SETTLER, ['2']],
        [OTHER, ['1', '3', '0']],
      ]),
    );
    expect(layer.container.children.map((c) => (c as Text).text)).toEqual(['2', '1,3,0']);
    layer.destroy();
  });

  it('stands a lone number right of the feet and hangs a list centred under them', () => {
    const layer = new GroupNumberLayer();
    layer.draw(
      { snapshot, drawn },
      new Map([
        [SETTLER, ['1']],
        [OTHER, ['1', '3']],
      ]),
    );
    const lone = labelOf(layer, 0);
    expect(lone.position.y).toBe(FEET.y);
    expect(lone.anchor.y).toBe(1);
    expect(lone.position.x).toBeGreaterThan(FEET.x);

    const list = labelOf(layer, 1);
    expect(list.position.x).toBe(FEET.x);
    expect(list.anchor.x).toBe(0.5);
    expect(list.position.y).toBeGreaterThanOrEqual(FEET.y);
    expect(list.anchor.y).toBe(0);
    layer.destroy();
  });

  it('marks no member the pool did not draw, such as a man resting indoors, nor a grouped building', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn: drawnGeometry() }, new Map([[SETTLER, ['1']]]));
    expect(layer.container.children).toHaveLength(0);

    const BARRACKS = 9;
    const withBuilding = snapshotOf([entity(BARRACKS, 3, 4, { Building: {} })]);
    layer.draw({ snapshot: withBuilding, drawn }, new Map([[BARRACKS, ['1']]]));
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });

  it('keeps its unzoomed screen size when zoomed out and its world size when zoomed in', () => {
    const layer = new GroupNumberLayer();
    layer.draw({ snapshot, drawn, zoom: 0.5 }, new Map([[SETTLER, ['1']]]));
    expect(labelOf(layer).scale.x).toBe(2);
    layer.draw({ snapshot, drawn, zoom: 2 }, new Map([[SETTLER, ['1']]]));
    expect(labelOf(layer).scale.x).toBe(1);
    layer.destroy();
  });

  it('keeps one node per member, rewrites it on a new list and retires dropped members', () => {
    const layer = new GroupNumberLayer();
    const lone = ['1'];
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, lone]]));
    const first = labelOf(layer);
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, lone]]));
    expect(first.text).toBe('1');
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, ['1', '3']]]));
    expect(labelOf(layer)).toBe(first);
    expect(first.text).toBe('1,3');

    layer.draw({ snapshot, drawn }, new Map());
    expect(layer.container.children).toHaveLength(0);
    expect(first.destroyed).toBe(true);
    layer.destroy();
  });

  it('skips a member off screen', () => {
    const layer = new GroupNumberLayer();
    const farAway = cameraViewport({ offsetX: -100_000, offsetY: -100_000 }, 800, 600, 0);
    layer.draw({ snapshot, drawn }, new Map([[SETTLER, ['1']]]), farAway);
    expect(layer.container.children).toHaveLength(0);
    layer.destroy();
  });
});
