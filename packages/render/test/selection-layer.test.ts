import type { WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import { SelectionLayer } from '../src/gpu/selection-layer.js';
import { makeElevationField, ONE, tileToScreen } from '../src/index.js';

/**
 * The selection ring is a projection consumer too: it anchors at a unit's feet, so on a hill it must
 * ride the SAME elevation lift the sprite pool applies to the bob — else the ring floats on the flat
 * ground beneath the lifted unit. Pixi `Container`/`Graphics` construct without a GL context (geometry
 * + transform only), so the ring's world-space position is agent-checkable here.
 */
function snapshotOf(entities: WorldSnapshot['entities']): WorldSnapshot {
  return { tick: 1, entities, events: [] };
}
function settler(id: number, tileX: number, tileY: number): WorldSnapshot['entities'][number] {
  return { id, components: { Position: { x: tileX * ONE, y: tileY * ONE }, Settler: { tribe: 0 } } };
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
    layer.draw(snapshotOf([ent]), new Set([1]), undefined, field);
    const ring = layer.container.children[0];
    const feet = tileToScreen(1, 8);
    expect(ring?.position.x).toBe(feet.x);
    expect(ring?.position.y).toBeCloseTo(feet.y - field.liftAt(1, 8), 6);
    // The lift is real (the hill cell is 160), so the ring drew well ABOVE the flat-ground anchor.
    expect(ring?.position.y).toBeLessThan(feet.y - 100);
  });

  it('places the ring at the un-lifted feet on a flat map (no field / flat field)', () => {
    const layer = new SelectionLayer();
    layer.draw(snapshotOf([settler(1, 1, 8)]), new Set([1]));
    const feet = tileToScreen(1, 8);
    expect(layer.container.children[0]?.position.y).toBe(feet.y);
  });
});
