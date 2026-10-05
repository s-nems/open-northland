import type { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { makeElevationField } from '../src/data/terrain/index.js';
import {
  type LostGoalMarker,
  lostGoalPose,
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

describe('lostGoalPose - darts breathe short of a steady ring', () => {
  it('never lets the darts arrive and keeps the ring full size', () => {
    for (const pulse of [0, 0.25, 0.5, 0.75]) {
      const pose = lostGoalPose(pulse);
      expect(pose.reach).toBeGreaterThan(orderMarkerPose(1).reach);
      expect(pose.ringScale).toBe(1);
      expect(pose.ringAlpha).toBeGreaterThan(0);
      expect(pose.ringAlpha).toBeLessThan(1);
    }
  });

  it('leans in and brightens mid-pulse, then wraps to where it began', () => {
    const rest = lostGoalPose(0);
    const lean = lostGoalPose(0.5);
    expect(lean.reach).toBeLessThan(rest.reach);
    expect(lean.dartAlpha).toBeGreaterThan(rest.dartAlpha);
    expect(lostGoalPose(1).reach).toBeCloseTo(rest.reach);
  });
});

const lost = (node: number, hx: number, hy: number): LostGoalMarker => ({ node, hx, hy });

describe('OrderMarkerLayer', () => {
  it('stands each marker on its node and retires the ones that played out', () => {
    const layer = new OrderMarkerLayer();
    layer.draw([marker(1, 0.3), marker(2, 0.3, 'attack')], [], 0, FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(2);
    const spot = halfCellToScreen(6, 4);
    const [first] = layer.container.children as Container[];
    expect(first?.position.x).toBeCloseTo(spot.x);
    expect(first?.position.y).toBeCloseTo(spot.y);

    layer.draw([marker(2, 0.6, 'attack')], [], 0, FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(1);
    layer.draw([], [], 0, FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(0);
  });

  it('draws nothing for a marker off the screen', () => {
    const layer = new OrderMarkerLayer();
    layer.draw([marker(1, 0.3)], [lost(9, 6, 4)], 0, FLAT, { minX: 1e5, minY: 1e5, maxX: 2e5, maxY: 2e5 });
    expect(layer.container.children).toHaveLength(0);
  });

  it('holds a lost goal beside an order of the same number, keyed apart, until it is gone', () => {
    const layer = new OrderMarkerLayer();
    layer.draw([marker(1, 0.3)], [lost(1, 8, 2)], 0.5, FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(2);
    const spot = halfCellToScreen(8, 2);
    const held = layer.container.children[1] as Container;
    expect(held.position.x).toBeCloseTo(spot.x);
    expect(held.position.y).toBeCloseTo(spot.y);

    // The order plays out while the goal stays: the same node keeps drawing.
    layer.draw([], [lost(1, 8, 2)], 0.75, FLAT, WIDE_VIEW);
    expect(layer.container.children).toEqual([held]);
    layer.draw([], [], 0, FLAT, WIDE_VIEW);
    expect(layer.container.children).toHaveLength(0);
  });
});
