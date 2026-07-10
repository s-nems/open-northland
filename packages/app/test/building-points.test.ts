import type { BuildingFootprint } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKER_ICON_OFFSET, DOOR_SHIFTS, workerIconOffset } from '../src/catalog/building-tweaks.js';
import { buildingFootprints } from '../src/content/ir.js';
import { doorNode, workerIconNode } from '../src/view/building-points.js';

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
  it('sits the default one node right of the door for an un-overridden building', () => {
    const anchor = { hx: 10, hy: 20 };
    const door = doorNode(footprintWithDoor(-1, 3), anchor);
    expect(workerIconNode(footprintWithDoor(-1, 3), anchor, 'work_well_00')).toEqual({
      hx: door.hx + DEFAULT_WORKER_ICON_OFFSET.dx,
      hy: door.hy + DEFAULT_WORKER_ICON_OFFSET.dy,
    });
  });

  it('honours the per-building overrides from the gallery review', () => {
    const anchor = { hx: 10, hy: 20 };
    const door = doorNode(footprintWithDoor(0, 2), anchor);
    // HQ: the stack sits a node further out; barracks: it follows the door wall down-right.
    expect(workerIconNode(footprintWithDoor(0, 2), anchor, 'headquarters')).toEqual({
      hx: door.hx + 2,
      hy: door.hy,
    });
    expect(workerIconNode(footprintWithDoor(0, 2), anchor, 'barracks')).toEqual({
      hx: door.hx + 1,
      hy: door.hy + 1,
    });
    expect(workerIconOffset(undefined)).toEqual(DEFAULT_WORKER_ICON_OFFSET);
  });
});

describe('buildingFootprints door corrections', () => {
  it('applies the committed DOOR_SHIFTS by building id at the ir → content seam', () => {
    const shift = DOOR_SHIFTS.get('home_level_00');
    expect(shift).toBeDefined(); // the review pinned a shift for the level-0 home
    const ir = {
      buildings: [
        { typeId: 2, id: 'home_level_00', footprint: footprintWithDoor(0, 2) },
        { typeId: 10, id: 'work_well_00', footprint: footprintWithDoor(0, -1) },
      ],
    };
    const out = buildingFootprints(ir);
    expect(out.get(2)?.door).toEqual({ dx: 0 + (shift?.dx ?? 0), dy: 2 + (shift?.dy ?? 0) });
    // An un-tweaked building keeps its extracted door verbatim.
    expect(out.get(10)?.door).toEqual({ dx: 0, dy: -1 });
  });

  it('leaves blocked/reserved untouched by a door shift', () => {
    const fp: BuildingFootprint = {
      blocked: [{ dx: 0, dy: 0 }],
      familyBody: [{ dx: 0, dy: 0 }],
      reserved: [{ dx: 1, dy: 1 }],
      door: { dx: 0, dy: 2 },
    };
    const out = buildingFootprints({ buildings: [{ typeId: 39, id: 'barracks', footprint: fp }] });
    expect(out.get(39)?.blocked).toEqual(fp.blocked);
    expect(out.get(39)?.reserved).toEqual(fp.reserved);
  });
});
