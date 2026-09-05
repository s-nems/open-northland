import type { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildingIndex } from '../src/view/runtime/read-models.js';

type ContentBuilding = Simulation['content']['buildings'][number];

const FOOTPRINT = { blocked: [], familyBody: [], reserved: [] };

/** A content building with only the fields the index reads set; the rest are the empty defaults a
 *  building with no crew, stock, recipes or construction stage carries. */
const building = (typeId: number, id: string): ContentBuilding => ({
  typeId,
  id,
  kind: 'workplace',
  homeSize: 0,
  workers: [],
  stock: [],
  produces: [],
  recipes: [],
  construction: [],
  canEnableDefenceMode: false,
  shelterCapacity: 0,
  footprint: FOOTPRINT,
});

describe('view building index', () => {
  it('carries the extracted sign-post anchor when the content has one', () => {
    const SMITHY = 23;
    const FARM = 31;
    const index = buildingIndex(
      [building(SMITHY, 'smithy'), building(FARM, 'farm')],
      new Map([[SMITHY, { x: 12, y: -4 }]]),
    );
    expect(index.get(SMITHY)?.flagPoint).toEqual({ x: 12, y: -4 });
    // A type with no flag-point row still gets an entry - the sign chain just has nothing to anchor on.
    expect(index.get(FARM)).toEqual({ id: 'farm', footprint: FOOTPRINT, flagPoint: undefined });
  });

  it('carries the extracted garrison mast, and none for a type that declares no such point', () => {
    const TOWER = 40;
    const FARM = 31;
    const index = buildingIndex(
      [building(TOWER, 'tower_00'), building(FARM, 'farm')],
      new Map([[TOWER, { x: -6, y: 29 }]]),
      new Map([[TOWER, { x: -6, y: -239 }]]),
    );
    // Two anchors on one building: the sign post at its foot, the mast high on its roof. Only the
    // tower records carry `gfxsoldierflagpoint`, so a farm's stays undefined.
    expect(index.get(TOWER)?.flagPoint).toEqual({ x: -6, y: 29 });
    expect(index.get(TOWER)?.mastPoint).toEqual({ x: -6, y: -239 });
    expect(index.get(FARM)?.mastPoint).toBeUndefined();
  });

  it('keeps the last building when two share a typeId', () => {
    // No schema enforces typeId uniqueness, and the two index rules resolve a duplicate differently
    // (packages/data/test/lookup.test.ts). This index reads last-wins.
    const DUPLICATE = 7;
    const index = buildingIndex([building(DUPLICATE, 'base'), building(DUPLICATE, 'mod')], new Map());
    expect(index.size).toBe(1);
    expect(index.get(DUPLICATE)?.id).toBe('mod');
  });

  it('is empty for content with no buildings', () => {
    expect(buildingIndex([], new Map()).size).toBe(0);
  });
});
