import { describe, expect, it } from 'vitest';
import { SelectionLayer } from '../src/gpu/overlays/selection-layer.js';
import { makeElevationField, tileToScreen } from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * The selection ring is a projection consumer too: it anchors at a unit's feet, so on a hill it must
 * ride the SAME elevation lift the sprite pool applies to the bob - else the ring floats on the flat
 * ground beneath the lifted unit. Pixi `Container`/`Graphics` construct without a GL context (geometry
 * + transform only), so the ring's world-space position is agent-checkable here.
 */
function settler(id: number, tileX: number, tileY: number): ReturnType<typeof entity> {
  return entity(id, tileX, tileY, { Settler: { tribe: 0 } });
}

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
    // The lift is real (the hill cell is 160), so the ring drew well ABOVE the flat-ground anchor.
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
