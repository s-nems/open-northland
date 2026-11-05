import type { BuildingFootprint } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKER_ICON_OFFSET } from '../../../src/catalog/building-tweaks.js';
import { doorNode, workerIconNode } from '../../../src/view/projections/index.js';

/** A minimal footprint carrying just a door (the only field these helpers read). */
function footprintWithDoor(dx: number, dy: number): BuildingFootprint {
  return { blocked: [], familyBody: [], reserved: [], door: { dx, dy }, workArea: [] };
}

describe('doorNode', () => {
  it('translates the door offset to the anchor (plain vector addition on the node grid)', () => {
    // The HQ's extracted door {dx:-1, dy:3} at an arbitrary even-row anchor.
    expect(doorNode(footprintWithDoor(-1, 3), { hx: 10, hy: 20 })).toEqual({ hx: 9, hy: 23 });
  });

  it('applies the odd-row parity shift to an odd-dy door, matching the sim interactionNode', () => {
    // Odd anchor row + odd door dy: one node further +x (footprintCellDx) - the walk target's rule.
    expect(doorNode(footprintWithDoor(-1, 3), { hx: 10, hy: 21 })).toEqual({ hx: 10, hy: 24 });
    // Even door dy never shifts, whatever the anchor row.
    expect(doorNode(footprintWithDoor(-1, 2), { hx: 10, hy: 21 })).toEqual({ hx: 9, hy: 23 });
  });

  it('falls back to the anchor itself for a doorless type (mirrors the sim interactionNode)', () => {
    const doorless: BuildingFootprint = { blocked: [], familyBody: [], reserved: [], workArea: [] };
    expect(doorNode(doorless, { hx: 4, hy: 6 })).toEqual({ hx: 4, hy: 6 });
    expect(doorNode(undefined, { hx: 4, hy: 6 })).toEqual({ hx: 4, hy: 6 });
  });
});

describe('workerIconNode', () => {
  it('sits the default one node right of the door for an un-overridden building', () => {
    const anchor = { hx: 10, hy: 20 };
    const door = doorNode(footprintWithDoor(-1, 3), anchor);
    expect(workerIconNode(footprintWithDoor(-1, 3), anchor, 'work_well_00')).toEqual({
      hx: door.hx + DEFAULT_WORKER_ICON_OFFSET.dx,
      hy: door.hy + DEFAULT_WORKER_ICON_OFFSET.dy,
    });
  });
});
