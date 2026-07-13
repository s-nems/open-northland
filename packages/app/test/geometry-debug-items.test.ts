import { fx, nodeOfPosition } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import {
  buildingSetFingerprint,
  computeGeometryDebugItems,
  type GeometryBuildingInfo,
} from '../src/view/geometry-debug-items.js';
import { building, snapshotOf } from './support/snapshot.js';

/**
 * The `?debug=geometry` projection — pure snapshot → overlay items, and the building-set fingerprint
 * that gates its rebuild. The icon anchor must match the door-badge path (both go through
 * `workerIconNode`), including the doorless fallback the old inline copy dropped.
 */

const TYPES = new Map<number, GeometryBuildingInfo>([
  [
    7,
    {
      id: 'work_well_00',
      footprint: {
        blocked: [{ dx: 0, dy: 0 }],
        familyBody: [{ dx: 0, dy: 0 }],
        reserved: [{ dx: 1, dy: 1 }],
        door: { dx: 0, dy: 2 },
      },
    },
  ],
]);

describe('computeGeometryDebugItems', () => {
  it('projects footprint cells, the door, and the workerIconNode-derived icon anchor', () => {
    const items = computeGeometryDebugItems(snapshotOf([building(1, 7, 4, 4)]), TYPES);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item?.anchor).toEqual(nodeOfPosition(fx.fromInt(4), fx.fromInt(4)));
    expect(item?.blocked).toEqual([{ dx: 0, dy: 0 }]);
    expect(item?.reserved).toEqual([{ dx: 1, dy: 1 }]);
    expect(item?.door).toEqual({ dx: 0, dy: 2 });
    // Default worker-icon offset: one node right of the door (the door-badge path's own composition).
    expect(item?.iconAnchor).toEqual({ dx: 1, dy: 2 });
    expect(item?.label).toBe('work_well_00');
  });

  it('marks the icon anchor beside the ANCHOR for a doorless/unknown type (matching the badge fallback)', () => {
    const items = computeGeometryDebugItems(snapshotOf([building(1, 99, 4, 4)]), TYPES);
    const item = items[0];
    expect(item?.door).toBeUndefined();
    expect(item?.iconAnchor).toEqual({ dx: 1, dy: 0 }); // anchor + the default offset — the badge draws here
    expect(item?.label).toBe('#99');
  });

  it('skips non-building entities', () => {
    const settler: Ent = { id: 3, components: { Settler: { jobType: 1 } } };
    expect(computeGeometryDebugItems(snapshotOf([settler]), TYPES)).toEqual([]);
  });
});

describe('buildingSetFingerprint', () => {
  it('moves when a building is added, upgraded IN PLACE, or moved — and not otherwise', () => {
    const base = snapshotOf([building(1, 7, 4, 4)]);
    const fp = buildingSetFingerprint(base, TYPES);
    expect(buildingSetFingerprint(snapshotOf([building(1, 7, 4, 4)]), TYPES)).toBe(fp); // same set
    // In-place level-up (same entity, new type) — the case placementBlockerVersion misses.
    expect(buildingSetFingerprint(snapshotOf([building(1, 8, 4, 4)]), TYPES)).not.toBe(fp);
    expect(buildingSetFingerprint(snapshotOf([building(1, 7, 4, 4), building(2, 7, 9, 9)]), TYPES)).not.toBe(
      fp,
    );
    expect(buildingSetFingerprint(snapshotOf([building(1, 7, 5, 4)]), TYPES)).not.toBe(fp); // moved
  });

  it('ignores non-building churn (a felled tree must not force an overlay rebuild)', () => {
    const buildingOnly = snapshotOf([building(1, 7, 4, 4)]);
    const withResource = snapshotOf([
      building(1, 7, 4, 4),
      { id: 9, components: { Resource: { goodType: 2, remaining: 4 } } },
    ]);
    expect(buildingSetFingerprint(withResource, TYPES)).toBe(buildingSetFingerprint(buildingOnly, TYPES));
  });
});
