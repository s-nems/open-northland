import { HEX_HEADING_COUNT, hexDistanceBetween, hexNeighboursOf, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  fitScale,
  GROUND_SQUASH,
  groundPoint,
  headingSector,
  hexRing,
  NODE_PX,
  NODE_ROW_PX,
  nodePoint,
  sightRows,
} from '../../../../../src/hud/dom/knowledge/figures/geometry.js';

describe('figure geometry', () => {
  it('draws a hex ring through nodes exactly its radius away', () => {
    const radius = 18;
    for (const corner of hexRing(radius)) {
      const hy = corner.y / NODE_ROW_PX;
      const hx = corner.x / NODE_PX;
      expect(hexDistanceBetween(0, 0, hx, hy)).toBe(radius);
    }
  });

  it('stretches sight along rows by the projection, a circle on screen', () => {
    const radius = systems.SCOUT_VISION_NODES;
    expect(sightRows(radius) * NODE_ROW_PX).toBe(radius * NODE_PX);
    expect(sightRows(radius)).toBeGreaterThan(radius);
  });

  it('scales every ring by one factor so the widest fills the room', () => {
    const scale = fitScale(sightRows(systems.SCOUT_VISION_NODES), 150);
    expect(sightRows(systems.SCOUT_VISION_NODES) * scale).toBeCloseTo(150);
    expect(sightRows(systems.CHILD_VISION_NODES) * scale).toBeCloseTo(
      (150 * systems.CHILD_VISION_NODES) / systems.SCOUT_VISION_NODES,
    );
  });

  it('puts all six neighbours on one ground circle', () => {
    const centre = { x: 0, y: 0 };
    for (const n of hexNeighboursOf(0, 0)) {
      const p = nodePoint(n.hx, n.hy);
      expect((p.x / NODE_PX) ** 2 + (p.y / (NODE_PX * GROUND_SQUASH)) ** 2).toBeCloseTo(1);
    }
    expect(groundPoint(centre, NODE_PX, 0).x).toBeCloseTo(NODE_PX);
  });

  it('tiles the ground with the six heading sectors, east and west narrower', () => {
    const spans = Array.from({ length: HEX_HEADING_COUNT }, (_, h) => headingSector(h));
    for (const [h, sector] of spans.entries()) {
      const next = spans[(h + 1) % HEX_HEADING_COUNT];
      expect(next?.from).toBeCloseTo(h + 1 === HEX_HEADING_COUNT ? sector.to - 360 : sector.to);
    }
    const width = (h: number): number => headingSector(h).to - headingSector(h).from;
    expect(width(0)).toBeLessThan(360 / HEX_HEADING_COUNT);
    expect(width(1)).toBeGreaterThan(360 / HEX_HEADING_COUNT);
  });
});
