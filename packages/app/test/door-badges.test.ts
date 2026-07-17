import { fx, nodeOfPosition, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerIconOffset } from '../src/catalog/building-tweaks.js';
import { type BuildingDoorInfo, computeDoorBadges } from '../src/view/projections/index.js';
import { building, resident, settler, snapshotOf } from './support/snapshot.js';

/**
 * computeDoorBadges — the pure snapshot→door-badge projection the render layer draws. It reads the sim's
 * {@link JobAssignment} binding, so a badge appears for every worker bound to a building (auto-assigned
 * or player-assigned), split by worker role (craftsman / carrier / gatherer via `roleOf`), anchored on
 * the building's WORKER-ICON node (the door node shifted beside the doorway — `workerIconNode`).
 */

const CARRIER = 26; // a carrier job id
const CRAFTSMAN = 1008; // a rebased craftsman job id
const GATHERER = 20; // a gatherer job id (the sandbox gatherer band)

/** The test's role classifier — the same three-way split the sandbox `workerRoleOf` makes. */
const roleOf = (jobType: number): 'gatherer' | 'carrier' | 'craftsman' =>
  jobType === CARRIER ? 'carrier' : jobType === GATHERER ? 'gatherer' : 'craftsman';

describe('computeDoorBadges', () => {
  it('tallies bound workers per building, split by role (craftsman/carrier/gatherer), at the door node', () => {
    const types = new Map<number, BuildingDoorInfo>([[7, { footprint: { door: { dx: 0, dy: 2 } } }]]);
    const snap = snapshotOf([
      building(1, 7, 4, 4),
      settler(2, CRAFTSMAN, 1),
      settler(3, CRAFTSMAN, 1),
      settler(4, CARRIER, 1),
      settler(5, GATHERER, 1),
    ]);

    const badges = computeDoorBadges(snap, types, roleOf);

    expect(badges).toHaveLength(1);
    const badge = badges[0];
    expect(badge?.id).toBe(1);
    expect(badge?.craftsmen).toBe(2);
    expect(badge?.carriers).toBe(1);
    expect(badge?.gatherers).toBe(1);
    // Anchored on the worker-icon node = anchor + the type's door offset + the icon offset beside it.
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const icon = workerIconOffset(undefined);
    const iconPos = positionOfNode(anchor.hx + 0 + icon.dx, anchor.hy + 2 + icon.dy);
    expect(badge?.x).toBe(iconPos.x);
    expect(badge?.y).toBe(iconPos.y);
  });

  it('emits no badge for an unstaffed building, and ignores an unbound settler', () => {
    const snap = snapshotOf([
      building(1, 7, 4, 4), // no workers bound here
      settler(2, CRAFTSMAN, null), // unemployed / unbound — no badge
    ]);

    expect(computeDoorBadges(snap, new Map(), roleOf)).toEqual([]);
  });

  it('falls back to beside the anchor node when the building type declares no door', () => {
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, new Map(), roleOf)[0]; // type 7 absent → no door offset
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const icon = workerIconOffset(undefined);
    const iconPos = positionOfNode(anchor.hx + icon.dx, anchor.hy + icon.dy);
    expect(badge?.x).toBe(iconPos.x);
    expect(badge?.y).toBe(iconPos.y);
  });

  it('honours a per-building worker-icon override (the HQ stack sits a node further out)', () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { id: 'headquarters', footprint: { door: { dx: 0, dy: 2 } } }],
    ]);
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    // The literal committed override (two nodes right of the door), NOT read back through the table —
    // deleting the table entry must fail this test, not silently fall back to the default.
    const iconPos = positionOfNode(anchor.hx + 0 + 2, anchor.hy + 2 + 0);
    expect(badge?.x).toBe(iconPos.x);
    expect(badge?.y).toBe(iconPos.y);
  });

  it('anchors a home’s occupancy dots a full field (two nodes) right of the door, clear of it', () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { id: 'home_level_00', footprint: { door: { dx: 0, dy: 2 } } }],
    ]);
    const snap = snapshotOf([building(1, 7, 4, 4), resident(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    expect(badge?.households).toEqual(['single']);
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    // A home pushes the marker a full field (two half-cell nodes) right of the door so the dots clear
    // the wide house door graphic — the literal committed offset, not read back through the table.
    const iconPos = positionOfNode(anchor.hx + 0 + 2, anchor.hy + 2 + 0);
    expect(badge?.x).toBe(iconPos.x);
    expect(badge?.y).toBe(iconPos.y);
  });
});
