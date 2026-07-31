import { fx, nodeOfPosition, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerIconOffset } from '../src/catalog/building-tweaks.js';
import { type BuildingDoorInfo, computeDoorBadges } from '../src/view/projections/index.js';
import { building, type Ent, resident, settler, snapshotOf } from './support/snapshot.js';

/**
 * computeDoorBadges — the pure snapshot→door-badge projection the render layer draws. It reads the sim's
 * {@link JobAssignment} binding, so a badge row appears for every worker bound to a building
 * (auto-assigned or player-assigned), split by worker role (craftsman / carrier / gatherer via
 * `roleOf`). The projection owns the bottom-to-top stack order and each row's click-pick settler id;
 * the anchor is the type's `GfxFlagPoint` when present, else the worker-icon node beside the door.
 */

const CARRIER = 26; // a carrier job id
const CRAFTSMAN = 1008; // a rebased craftsman job id
const GATHERER = 20; // a gatherer job id (the sandbox gatherer band)

/** The test's role classifier — the same three-way split the sandbox `workerRoleOf` makes. */
const roleOf = (jobType: number): 'gatherer' | 'carrier' | 'craftsman' =>
  jobType === CARRIER ? 'carrier' : jobType === GATHERER ? 'gatherer' : 'craftsman';

describe('computeDoorBadges', () => {
  it('emits one row per bound worker - discs first, carrier pennants on top - with settler ids', () => {
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
    expect(badge?.player).toBeUndefined(); // the fixture building is unowned - the layer draws slot 0
    // Bottom-to-top: craftsmen, gatherers (both the worker disc), then the carrier always on top.
    expect(badge?.rows).toEqual([
      { role: 'craftsman', settler: 2 },
      { role: 'craftsman', settler: 3 },
      { role: 'gatherer', settler: 5 },
      { role: 'carrier', settler: 4 },
    ]);
    // Anchored on the worker-icon node = anchor + the type's door offset + the icon offset beside it.
    const anchor = nodeOfPosition(fx.fromInt(4), fx.fromInt(4));
    const icon = workerIconOffset(undefined);
    const iconPos = positionOfNode(anchor.hx + 0 + icon.dx, anchor.hy + 2 + icon.dy);
    expect(badge?.x).toBe(iconPos.x);
    expect(badge?.y).toBe(iconPos.y);
    expect(badge?.dx).toBeUndefined(); // no flag point → node anchor, no px offset
  });

  it('anchors at the building position + GfxFlagPoint px offset when the type carries one', () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { footprint: { door: { dx: 0, dy: 2 } }, flagPoint: { x: -6, y: 29 } }],
    ]);
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    // The anchor is the building's own position (the sprite draw anchor)…
    expect(badge?.x).toBe(fx.fromInt(4));
    expect(badge?.y).toBe(fx.fromInt(4));
    // …and the flag point rides as a screen-px offset (the viking tower's real values).
    expect(badge?.dx).toBe(-6);
    expect(badge?.dy).toBe(29);
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

  it("puts a home's family banner at the stack base, below its worker rows", () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { id: 'home_level_00', footprint: { door: { dx: 0, dy: 2 } } }],
    ]);
    const lodger = resident(2, CRAFTSMAN, 1);
    const snap = snapshotOf([
      building(1, 7, 4, 4),
      { ...lodger, components: { ...lodger.components, JobAssignment: { workplace: 1 } } },
    ]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    expect(badge?.rows).toEqual([
      { role: 'single', settler: 2 }, // the banner at the base…
      { role: 'craftsman', settler: 2 }, // …then the worker disc above it
    ]);
  });

  it("a couple's banner clicks to the wife; a single's to its lone resident", () => {
    const couple = (home: number, husbandId: number, wifeId: number): Ent[] => [
      {
        id: husbandId,
        components: {
          Settler: { jobType: CRAFTSMAN },
          Residence: { home },
          Marriage: { spouse: wifeId, child: null },
        },
      },
      {
        id: wifeId,
        components: {
          Settler: { jobType: CRAFTSMAN },
          Residence: { home },
          Female: {},
          Marriage: { spouse: husbandId, child: null },
        },
      },
    ];
    const snap = snapshotOf([building(1, 7, 4, 4), ...couple(1, 2, 3), resident(9, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, new Map(), roleOf)[0];
    expect(badge?.rows).toEqual([
      { role: 'couple', settler: 3 }, // the wife (adult female), not the lower-id husband
      { role: 'single', settler: 9 },
    ]);
  });

  it("carries the building's owner slot so the layer picks that player's sign recolour", () => {
    const owned = building(1, 7, 4, 4);
    const snap = snapshotOf([
      { ...owned, components: { ...owned.components, Owner: { player: 4 } } },
      settler(2, CRAFTSMAN, 1),
    ]);

    expect(computeDoorBadges(snap, new Map(), roleOf)[0]?.player).toBe(4);
  });
});
