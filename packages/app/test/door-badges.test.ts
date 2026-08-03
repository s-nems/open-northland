import { ONE, tileToScreen } from '@open-northland/render';
import { fx, nodeOfPosition, positionOfNode } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerIconOffset } from '../src/catalog/building-tweaks.js';
import { type BuildingDoorInfo, computeDoorBadges } from '../src/view/projections/index.js';
import { building, type Ent, resident, settler, snapshotOf } from './support/snapshot.js';

/**
 * computeDoorBadges - the pure snapshot→door-badge projection the render layer draws. It reads the sim's
 * {@link JobAssignment} binding, so a badge row appears for every worker posted to a building,
 * split by worker role (craftsman / carrier / gatherer via
 * `roleOf`). The projection owns the bottom-to-top stack order and each row's click-pick settler id;
 * the stack stands at the type's `GfxFlagPoint` when present, else the worker-icon node beside the door,
 * and reaches the layer as the BUILDING's position plus a screen-px offset either way (the layer keys
 * the chain's depth off that position, so it must be the house, not the post).
 */

/** The screen-px step from a building's own position to a half-cell node - how the projection has to
 *  express a derived (non-flag-point) anchor. */
function pxStep(pos: { x: number; y: number }, node: { hx: number; hy: number }): { x: number; y: number } {
  const to = positionOfNode(node.hx, node.hy);
  const from = tileToScreen(pos.x / ONE, pos.y / ONE);
  const at = tileToScreen(to.x / ONE, to.y / ONE);
  return { x: at.x - from.x, y: at.y - from.y };
}

const CARRIER = 26; // a carrier job id
const CRAFTSMAN = 1008; // a rebased craftsman job id
const GATHERER = 20; // a gatherer job id (the sandbox gatherer band)
const ARCHER = 40; // a bow soldier - the garrison band

/** The test's role classifier - the same four-way split the sandbox `workerRoleOf` makes. */
const roleOf = (jobType: number): 'gatherer' | 'carrier' | 'craftsman' | 'garrison' =>
  jobType === CARRIER
    ? 'carrier'
    : jobType === GATHERER
      ? 'gatherer'
      : jobType === ARCHER
        ? 'garrison'
        : 'craftsman';

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
    // Anchored on the building, stepping out to the worker-icon node = door offset + the icon offset.
    const pos = { x: fx.fromInt(4), y: fx.fromInt(4) };
    const anchor = nodeOfPosition(pos.x, pos.y);
    const icon = workerIconOffset(undefined);
    const step = pxStep(pos, { hx: anchor.hx + 0 + icon.dx, hy: anchor.hy + 2 + icon.dy });
    expect(badge?.x).toBe(pos.x);
    expect(badge?.y).toBe(pos.y);
    expect(badge?.dx).toBe(step.x);
    expect(badge?.dy).toBe(step.y);
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
      settler(2, CRAFTSMAN, null), // unemployed / unbound - no badge
    ]);

    expect(computeDoorBadges(snap, new Map(), roleOf)).toEqual([]);
  });

  it('falls back to beside the anchor node when the building type declares no door', () => {
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, new Map(), roleOf)[0]; // type 7 absent → no door offset
    const pos = { x: fx.fromInt(4), y: fx.fromInt(4) };
    const anchor = nodeOfPosition(pos.x, pos.y);
    const icon = workerIconOffset(undefined);
    const step = pxStep(pos, { hx: anchor.hx + icon.dx, hy: anchor.hy + icon.dy });
    expect(badge?.x).toBe(pos.x);
    expect(badge?.y).toBe(pos.y);
    expect(badge?.dx).toBe(step.x);
    expect(badge?.dy).toBe(step.y);
  });

  it('keeps a back-door type anchored on its building, so the chain cannot sort into its own house', () => {
    // The wonders are the real no-flag-point types, and two of them (mausolos, zeus statue) put the door
    // NORTH of the anchor. Carrying that as the badge position would key the chain a row behind the
    // house and let the building body swallow its own signs.
    const types = new Map<number, BuildingDoorInfo>([[7, { footprint: { door: { dx: 1, dy: -3 } } }]]);
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    expect(badge?.x).toBe(fx.fromInt(4)); // the house, not the node behind it
    expect(badge?.y).toBe(fx.fromInt(4));
    expect(badge?.dy).toBeLessThan(0); // the post is drawn behind the anchor, by px offset alone
  });

  it('honours a per-building worker-icon override (the HQ stack sits a node further out)', () => {
    const types = new Map<number, BuildingDoorInfo>([
      [7, { id: 'headquarters', footprint: { door: { dx: 0, dy: 2 } } }],
    ]);
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, CRAFTSMAN, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    const pos = { x: fx.fromInt(4), y: fx.fromInt(4) };
    const anchor = nodeOfPosition(pos.x, pos.y);
    // The literal committed override (two nodes right of the door), NOT read back through the table -
    // deleting the table entry must fail this test, not silently fall back to the default.
    const step = pxStep(pos, { hx: anchor.hx + 0 + 2, hy: anchor.hy + 2 + 0 });
    expect(badge?.dx).toBe(step.x);
    expect(badge?.dy).toBe(step.y);
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

  it('flies one flag for the whole garrison at the mast, and leaves its hauler a row', () => {
    const MAST = { x: -6, y: -239 }; // the viking tower's extracted `gfxsoldierflagpoint`
    const types = new Map<number, BuildingDoorInfo>([
      [7, { id: 'tower_00', flagPoint: { x: -6, y: 29 }, mastPoint: MAST }],
    ]);
    const snap = snapshotOf([
      building(1, 7, 4, 4),
      settler(2, ARCHER, 1),
      settler(3, ARCHER, 1),
      settler(4, CARRIER, 1),
    ]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    // No worker disc per archer: two men, one flag with two stars, flown from the roof rather than the
    // sign post the hauler's pennant still stands on.
    expect(badge?.rows).toEqual([{ role: 'carrier', settler: 4 }]);
    expect(badge?.garrison).toEqual({ stars: 2, dx: MAST.x, dy: MAST.y });
    expect(badge?.dx).toBe(-6);
    expect(badge?.dy).toBe(29);
  });

  it('reports every man on the post, over the five the art draws', () => {
    const types = new Map<number, BuildingDoorInfo>([[7, { id: 'tower_01', mastPoint: { x: -6, y: -255 } }]]);
    const garrison = Array.from({ length: 8 }, (_, i) => settler(i + 2, ARCHER, 1));
    const snap = snapshotOf([building(1, 7, 4, 4), ...garrison]);

    // The big tower employs eight bows. Capping is the flag art's job (five stars is its ceiling); the
    // projection reports the post as it stands, so the layer never has to guess what it was told.
    expect(computeDoorBadges(snap, types, roleOf)[0]?.garrison?.stars).toBe(8);
  });

  it('flies the flag from the sign post when nobody authored the building a mast', () => {
    const types = new Map<number, BuildingDoorInfo>([[7, { flagPoint: { x: -6, y: 29 } }]]);
    const snap = snapshotOf([building(1, 7, 4, 4), settler(2, ARCHER, 1)]);

    const badge = computeDoorBadges(snap, types, roleOf)[0];
    expect(badge?.rows).toEqual([]); // still no row - the flag is the garrison's whole marker
    expect(badge?.garrison).toEqual({ stars: 1, dx: -6, dy: 29 });
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
