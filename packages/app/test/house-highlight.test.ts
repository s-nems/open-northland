import { ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import {
  computeHouseHighlight,
  familyIdsOf,
  type HouseInfo,
  houseAssignableAt,
} from '../src/view/unit-controls/highlights/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The "przypisz dom" verdict — the residential twin of `assign-highlight.test.ts`. A home is green iff
 * it is an own, built `home` with a free FAMILY slot (`homeSize` counts families, not heads) for the
 * settler's household. The key invariant, as on the workplace side: the highlight (`computeHouseHighlight`,
 * what the player sees green) and the click resolver (`houseAssignableAt`, what a click binds) must agree
 * home-for-home, so a green home never silently cancels the click and a red one never binds.
 */

const HOME_TYPE = 2; // a `home`-kind building type
const MILL_TYPE = 9; // any non-home type — never a candidate
const HOME_SIZE = 2; // this home level holds two families
const HOUSES = new Map<number, HouseInfo>([
  [HOME_TYPE, { kind: 'home', homeSize: HOME_SIZE }],
  [MILL_TYPE, { kind: 'production' }],
]);

/** A built home of `player` (unbuilt/under-construction variants below are the negative cases). */
function home(id: number, player = HUMAN_PLAYER, typeId = HOME_TYPE): Ent {
  return {
    id,
    components: { Building: { buildingType: typeId, built: ONE }, Owner: { player } },
  };
}

/** A settler of `player`; `minor` marks a still-growing child, `marriage` links a spouse/child, and
 *  `home` moves it in as a resident. */
function person(
  id: number,
  opts: { player?: number; minor?: boolean; spouse?: number; child?: number | null; home?: number } = {},
): Ent {
  return {
    id,
    components: {
      Settler: { jobType: 0, tribe: 1 },
      Owner: { player: opts.player ?? HUMAN_PLAYER },
      ...(opts.minor === true ? { Age: { ticks: 0 } } : {}),
      ...(opts.spouse !== undefined ? { Marriage: { spouse: opts.spouse, child: opts.child ?? null } } : {}),
      ...(opts.home !== undefined ? { Residence: { home: opts.home } } : {}),
    },
  };
}

describe('familyIdsOf — the household a home assignment moves as one', () => {
  it('is just the settler when unmarried', () => {
    expect(familyIdsOf(snapshotOf([person(1)]), 1)).toEqual([1]);
  });

  it('carries the living spouse and the still-growing child', () => {
    const snap = snapshotOf([
      person(1, { spouse: 2, child: 3 }),
      person(2, { spouse: 1, child: 3 }),
      person(3, { minor: true }),
    ]);
    expect(familyIdsOf(snap, 1)).toEqual([1, 2, 3]);
  });

  it('drops a dead spouse (absent from the snapshot) and a grown-up child', () => {
    const snap = snapshotOf([person(1, { spouse: 2, child: 3 }), person(3)]); // spouse 2 destroyed, child 3 adult
    expect(familyIdsOf(snap, 1)).toEqual([1]);
  });

  it('is empty for a missing / non-settler entity', () => {
    expect(familyIdsOf(snapshotOf([home(10)]), 10)).toEqual([]);
    expect(familyIdsOf(snapshotOf([]), 1)).toEqual([]);
  });
});

describe('computeHouseHighlight / houseAssignableAt', () => {
  it('greens an empty own home and the click resolver agrees', () => {
    const snap = snapshotOf([person(1), home(10)]);
    expect(computeHouseHighlight(snap, 1, HOUSES)).toEqual([{ id: 10, ok: true }]);
    expect(houseAssignableAt(snap, 10, 1, HOUSES)).toBe(true);
  });

  it('reds a home already holding homeSize other families', () => {
    const snap = snapshotOf([
      person(1),
      home(10),
      person(2, { home: 10 }), // two unrelated households fill a homeSize-2 home
      person(3, { home: 10 }),
    ]);
    expect(computeHouseHighlight(snap, 1, HOUSES)).toEqual([{ id: 10, ok: false }]);
    expect(houseAssignableAt(snap, 10, 1, HOUSES)).toBe(false);
  });

  it('keeps a resident family green in its own home (the mover keeps its slot on a re-assign)', () => {
    // Home holds the mover's own family + one other: only the OTHER household consumes a slot.
    const snap = snapshotOf([person(1, { home: 10 }), home(10), person(2, { home: 10 })]);
    expect(houseAssignableAt(snap, 10, 1, HOUSES)).toBe(true);
  });

  it('skips a non-home building, an unbuilt home, a site, and another player’s home', () => {
    const site: Ent = {
      id: 12,
      components: {
        Building: { buildingType: HOME_TYPE, built: ONE },
        UnderConstruction: {},
        Owner: { player: HUMAN_PLAYER },
      },
    };
    const unbuilt: Ent = {
      id: 13,
      components: { Building: { buildingType: HOME_TYPE, built: ONE - 1 }, Owner: { player: HUMAN_PLAYER } },
    };
    const snap = snapshotOf([
      person(1),
      home(11, HUMAN_PLAYER, MILL_TYPE),
      site,
      unbuilt,
      home(14, ENEMY_PLAYER),
    ]);
    expect(computeHouseHighlight(snap, 1, HOUSES)).toEqual([]); // never tinted, not even red
    for (const id of [11, 12, 13, 14]) expect(houseAssignableAt(snap, id, 1, HOUSES)).toBe(false);
  });

  it('verdicts stay in lockstep with the click resolver across a mixed world', () => {
    const snap = snapshotOf([
      person(1),
      home(10), // free
      home(20), // filled below
      person(2, { home: 20 }),
      person(3, { home: 20 }),
    ]);
    const items = computeHouseHighlight(snap, 1, HOUSES);
    expect(items.length).toBe(2);
    for (const item of items) expect(item.ok).toBe(houseAssignableAt(snap, item.id, 1, HOUSES));
  });
});
