import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { makeElevationField } from '../src/data/terrain/index.js';
import {
  type OrderMarker,
  OrderMarkerLayer,
  orderMarkerPose,
} from '../src/gpu/overlays/order-marker-layer.js';
import { halfCellToScreen } from '../src/index.js';

const FLAT = makeElevationField(undefined, 0, 0);
const WIDE_VIEW = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };
const marker = (id: number, progress: number, kind: OrderMarker['kind'] = 'move'): OrderMarker => ({
  id,
  kind,
  hx: 6,
  hy: 4,
  progress,
});

describe('orderMarkerPose - darts slide into the spot, then a ring lands', () => {
  it('fades in from nothing, closes in on the spot and fades out by the end', () => {
    const start = orderMarkerPose(0);
    const middle = orderMarkerPose(0.5);
    const end = orderMarkerPose(1);
    expect(start.dartAlpha).toBe(0);
    expect(middle.dartAlpha).toBeGreaterThan(0.5);
    expect(middle.dartAlpha).toBeLessThan(1); // subtle: the ground stays visible through it
    expect(end.dartAlpha).toBe(0);
    expect(middle.reach).toBeLessThan(start.reach);
    expect(end.reach).toBeLessThanOrEqual(middle.reach);
  });

  it('shows the landing ring only once the darts close, growing as it fades', () => {
    expect(orderMarkerPose(0.2).ringAlpha).toBe(0);
    const landing = orderMarkerPose(0.6);
    const late = orderMarkerPose(0.9);
    expect(landing.ringAlpha).toBeGreaterThan(late.ringAlpha);
    expect(late.ringScale).toBeGreaterThan(landing.ringScale);
    expect(orderMarkerPose(1).ringAlpha).toBe(0);
  });
});

describe('OrderMarkerLayer', () => {
  it('stands each marker on its node and retires the ones that played out', () => {
    const layer = new OrderMarkerLayer();
    layer.draw([marker(1, 0.3), marker(2, 0.3, 'attack')], FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(2);
    const spot = halfCellToScreen(6, 4);
    const [first] = layer.container.children as Container[];
    expect(first?.position.x).toBeCloseTo(spot.x);
    expect(first?.position.y).toBeCloseTo(spot.y);

    layer.draw([marker(2, 0.6, 'attack')], FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(1);
    layer.draw([], FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws nothing for a marker off the screen', () => {
    const layer = new OrderMarkerLayer();
    layer.draw([marker(1, 0.3)], FLAT, { minX: 1e5, minY: 1e5, maxX: 2e5, maxY: 2e5 });
    expect(layer.container.children).toHaveLength(0);
  });
});
