import { hexDistanceBetween, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  fitScale,
  hexRing,
  NODE_PX,
  NODE_ROW_PX,
  sightRows,
  slantNode,
  slantStepsWithin,
  withinDiamond,
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

  it('reaches two thirds as many slanted steps as straight ones in the build rule', () => {
    const radius = systems.CONTESTED_GROUND_RADIUS_NODES;
    const steps = slantStepsWithin(radius);
    const end = slantNode(steps);
    const past = slantNode(steps + 1);
    expect(steps).toBe((radius * 2) / 3);
    expect(withinDiamond(end.hx, end.hy, radius)).toBe(true);
    expect(withinDiamond(past.hx, past.hy, radius)).toBe(false);
  });
});
