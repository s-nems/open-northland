import { Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SelectionLayer } from '../src/gpu/overlays/selection-layer.js';
import { makeElevationField, tileToScreen } from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';

function settler(id: number, tileX: number, tileY: number): ReturnType<typeof entity> {
  return entity(id, tileX, tileY, { Settler: { tribe: 0 } });
}

// The ring anchors at a unit's feet, so it must ride the same lift the sprite pool applies to the bob.
describe('SelectionLayer elevation lift', () => {
  const W = 4;
  const H = 12;
  const elev = new Array<number>(W * H).fill(0);
  elev[8 * W + 1] = 160; // a hill under cell (col 1, row 8)
  const field = makeElevationField(elev, W, H);

  it('lifts a selected unit’s ring by the terrain height at its feet', () => {
    const layer = new SelectionLayer();
    const ent = settler(1, 1, 8);
    layer.draw({ snapshot: snapshotOf([ent]), elevation: field }, new Set([1]));
    const ring = layer.container.children[0];
    const feet = tileToScreen(1, 8);
    expect(ring?.position.x).toBe(feet.x);
    expect(ring?.position.y).toBeCloseTo(feet.y - field.liftAt(1, 8), 6);
    // The hill cell is 160, so the ring clears the flat-ground anchor by far more than 100.
    expect(ring?.position.y).toBeLessThan(feet.y - 100);
  });

  it('places the ring at the un-lifted feet on a flat map (no field / flat field)', () => {
    const layer = new SelectionLayer();
    layer.draw({ snapshot: snapshotOf([settler(1, 1, 8)]) }, new Set([1]));
    const feet = tileToScreen(1, 8);
    expect(layer.container.children[0]?.position.y).toBe(feet.y);
  });
});

describe('SelectionLayer id resolution', () => {
  it('rings every selected id wherever it sits among unselected entities, and only those', () => {
    const layer = new SelectionLayer();
    const crowd = [1, 2, 3, 4, 5, 6, 7].map((id) => settler(id, id, 1));
    layer.draw({ snapshot: snapshotOf(crowd) }, new Set([1, 4, 7]));
    expect(layer.container.children.length).toBe(3);
    const drawnX = layer.container.children.map((c) => c.position.x).sort((a, b) => a - b);
    expect(drawnX).toEqual([1, 4, 7].map((id) => tileToScreen(id, 1).x).sort((a, b) => a - b));
  });

  it('retires the ring of a selected id that left the snapshot', () => {
    const layer = new SelectionLayer();
    const selection = new Set([1, 2]);
    layer.draw({ snapshot: snapshotOf([settler(1, 1, 1), settler(2, 2, 1)]) }, selection);
    expect(layer.container.children.length).toBe(2);
    // Entity 2 died; the app still holds it selected until its next selection pass.
    layer.draw({ snapshot: snapshotOf([settler(1, 1, 1)]) }, selection);
    expect(layer.container.children.length).toBe(1);
    expect(layer.container.children[0]?.position.x).toBe(tileToScreen(1, 1).x);
  });

  it('rings the flag pool from its own id set, independent of the selection', () => {
    const layer = new SelectionLayer();
    const snapshot = snapshotOf([settler(1, 1, 1), entity(2, 3, 1, { DeliveryFlag: {} })]);
    layer.draw({ snapshot }, new Set([1]), new Set([2]));
    expect(layer.container.children.length).toBe(2);
    expect(layer.container.children.map((c) => c.position.x)).toContain(tileToScreen(3, 1).x);
  });
});

describe('SelectionLayer ring sizing', () => {
  it('gives a building a larger ring than a settler, classified from its marker', () => {
    const layer = new SelectionLayer();
    // Same feet cell: the size difference is the marker classification, not the position.
    layer.draw(
      { snapshot: snapshotOf([settler(1, 1, 8), entity(2, 1, 8, { Building: {} })]) },
      new Set([1, 2]),
    );
    const settlerW = layer.container.children[0]?.getLocalBounds().width ?? 0;
    const buildingW = layer.container.children[1]?.getLocalBounds().width ?? 0;
    expect(settlerW).toBeGreaterThan(0);
    expect(buildingW).toBeGreaterThan(settlerW);
  });
});

describe('authored building ground marker', () => {
  it('ignores transparent canvas bounds and follows changing authored geometry while selected', () => {
    const layer = new SelectionLayer();
    const snapshot = snapshotOf([entity(2, 1, 8, { Building: {} })]);
    const ellipse = { cx: 35, cy: -12, rx: 90, ry: 32 };
    const drawn = {
      anchorOf: () => ({ x: 100, y: 200 }),
      boundsOf: () => ({ minX: -500, minY: -900, maxX: 900, maxY: 400 }),
      selectionOf: () => ellipse,
    };
    layer.draw({ snapshot, drawn }, new Set([2]));
    const ring = layer.container.children[0];
    expect(ring?.position.x).toBe(100);
    expect(ring?.position.y).toBe(200);
    const before = ring?.getLocalBounds().clone();
    expect(before).toBeDefined();
    expect(((before?.minX ?? 0) + (before?.maxX ?? 0)) / 2).toBeCloseTo(35);
    expect(before?.width).toBeGreaterThan(180);
    expect(before?.width).toBeLessThan(184);
    ellipse.rx = 110;
    ellipse.cy = -25;
    layer.draw({ snapshot, drawn }, new Set([2]));
    expect(layer.container.children[0]).toBe(ring);
    const after = ring?.getLocalBounds();
    expect(after?.width).toBeGreaterThan(220);
    expect(after?.width).toBeLessThan(224);
    expect((after?.minY ?? 0) - (before?.minY ?? 0)).toBeCloseTo(-13, 1);
    layer.destroy();
  });
});

describe('unit selection presentation', () => {
  it('keeps line weight in screen pixels while retaining the marker across zoom changes', () => {
    const layer = new SelectionLayer();
    const snapshot = snapshotOf([settler(1, 1, 1)]);
    const selected = new Set([1]);
    const drawn = {
      anchorOf: () => ({ x: 100, y: 200 }),
      boundsOf: () => undefined,
    };
    layer.draw({ snapshot, drawn, zoom: 1 }, selected);
    const ring = layer.container.children[0];
    expect(ring).toBeInstanceOf(Graphics);
    if (!(ring instanceof Graphics)) throw new Error('Missing selection graphic');
    const strokeWidth = ring.getLocalBounds().width - 32;
    expect(strokeWidth).toBeGreaterThan(0);
    expect(ring.context.instructions.every((instruction) => instruction.action === 'stroke')).toBe(true);
    for (const zoom of [0.75, 2]) {
      layer.draw({ snapshot, drawn, zoom }, selected);
      expect(layer.container.children[0]).toBe(ring);
      expect((ring.getLocalBounds().width - 32) * zoom).toBeCloseTo(strokeWidth);
      expect(ring.position.x).toBe(100);
      expect(ring.position.y).toBe(200);
    }
    layer.destroy();
  });

  it('fits the vehicle ground ellipse and retires focus marks without removing the selection', () => {
    const layer = new SelectionLayer();
    const snapshot = snapshotOf([entity(3, 1, 1, { Vehicle: {} })]);
    const drawn = {
      anchorOf: () => ({ x: 100, y: 200 }),
      boundsOf: () => ({ minX: -500, minY: -900, maxX: 900, maxY: 400 }),
      selectionOf: () => ({ cx: 12, cy: -4, rx: 35, ry: 10 }),
    };
    const selected = new Set([3]);
    layer.draw({ snapshot, drawn }, selected, undefined, undefined, selected);
    expect(layer.container.children).toHaveLength(2);
    const ring = layer.container.children[0];
    const bounds = ring?.getLocalBounds();
    expect(bounds).toBeDefined();
    expect(((bounds?.minX ?? 0) + (bounds?.maxX ?? 0)) / 2).toBeCloseTo(12);
    expect(bounds?.width).toBeGreaterThan(70);
    expect(bounds?.width).toBeLessThan(75);
    layer.draw({ snapshot, drawn }, selected);
    expect(layer.container.children).toEqual([ring]);
    layer.destroy();
  });
});

it('switches selected buildings between coloured rings and sprite effects without stale rings', () => {
  const layer = new SelectionLayer();
  const snapshot = snapshotOf([entity(2, 1, 8, { Building: {} })]);
  const selected = new Set([2]);
  layer.draw({ snapshot, selectionStyle: 'ring-green' }, selected);
  const ring = layer.container.children[0];
  if (!(ring instanceof Graphics)) throw new Error('Missing selection ring');
  const colours = () =>
    ring.context.instructions
      .filter((entry) => entry.action === 'stroke')
      .map((entry) => entry.data.style.color);
  expect(colours()).toContain(0x66ff66);
  layer.draw({ snapshot, selectionStyle: 'ring-white' }, selected);
  expect(layer.container.children[0]).toBe(ring);
  expect(colours()).toContain(0xf2e8c9);
  expect(colours()).not.toContain(0x66ff66);
  for (const selectionStyle of ['outline', 'pulse'] as const) {
    layer.draw({ snapshot, selectionStyle }, selected);
    expect(layer.container.children).toHaveLength(0);
  }
  layer.draw({ snapshot, selectionStyle: 'ring-green' }, selected);
  expect(layer.container.children).toHaveLength(1);
  layer.destroy();
});
