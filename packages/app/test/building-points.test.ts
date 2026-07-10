import type { BuildingFootprint } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { WORKER_ICON_DOOR_OFFSET, doorNode, workerIconNode } from '../src/view/building-points.js';

/** A minimal footprint carrying just a door (the only field these helpers read). */
function footprintWithDoor(dx: number, dy: number): BuildingFootprint {
  return { blocked: [], familyBody: [], reserved: [], door: { dx, dy } };
}

describe('doorNode', () => {
  it('translates the door offset to the anchor (plain vector addition on the node grid)', () => {
    // The HQ's extracted door {dx:-1, dy:3} at an arbitrary anchor.
    expect(doorNode(footprintWithDoor(-1, 3), { hx: 10, hy: 20 })).toEqual({ hx: 9, hy: 23 });
  });

  it('falls back to the anchor itself for a doorless type (mirrors the sim interactionNode)', () => {
    const doorless: BuildingFootprint = { blocked: [], familyBody: [], reserved: [] };
    expect(doorNode(doorless, { hx: 4, hy: 6 })).toEqual({ hx: 4, hy: 6 });
    expect(doorNode(undefined, { hx: 4, hy: 6 })).toEqual({ hx: 4, hy: 6 });
  });
});

describe('workerIconNode', () => {
  it('sits WORKER_ICON_DOOR_OFFSET right of the door node', () => {
    const anchor = { hx: 10, hy: 20 };
    const door = doorNode(footprintWithDoor(-1, 3), anchor);
    expect(workerIconNode(footprintWithDoor(-1, 3), anchor)).toEqual({
      hx: door.hx + WORKER_ICON_DOOR_OFFSET.dx,
      hy: door.hy + WORKER_ICON_DOOR_OFFSET.dy,
    });
  });

  it('anchors beside the building anchor for a doorless type', () => {
    expect(workerIconNode(undefined, { hx: 4, hy: 6 })).toEqual({
      hx: 4 + WORKER_ICON_DOOR_OFFSET.dx,
      hy: 6 + WORKER_ICON_DOOR_OFFSET.dy,
    });
  });
});
