import { type Command, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../../../src/game/rules.js';
import { BUILDING_HOME_00, sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { Pickable } from '../../../../src/view/picking.js';
import {
  computeHouseHighlight,
  type HouseInfo,
  houseAssignableAt,
} from '../../../../src/view/unit-controls/highlights/index.js';
import { buildingPickController, NO_TARGETS } from '../../../support/pick-mode.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/**
 * The "przypisz dom" verdict - the residential twin of `assign-highlight.test.ts`. A home is lit iff
 * it is an own `home` with a free FAMILY slot (`homeSize` counts families, not heads) for the
 * settler's household. The key invariant, as on the workplace side: the highlight (`computeHouseHighlight`,
 * what the player sees lit) and the click resolver (`houseAssignableAt`, what a click binds) must agree
 * home-for-home, so a lit home never silently cancels the click and a refused one never binds.
 */

const TRIBE = 1; // the settlers' own tribe; OTHER_TRIBE below is the mismatch case
const OTHER_TRIBE = 2;
const HOME_TYPE = 2; // a `home`-kind building type
const MILL_TYPE = 9; // any non-home type - never a candidate
const HOME_SIZE = 2; // this home level holds two families
const FURNISHED_FAMILIES = 1; // and one more while furnished
const HOUSES = new Map<number, HouseInfo>([
  [HOME_TYPE, { kind: 'home', homeSize: HOME_SIZE, furnishedFamilies: FURNISHED_FAMILIES }],
  [MILL_TYPE, { kind: 'workplace', homeSize: 0, furnishedFamilies: 0 }],
]);
/** The sandbox goods, whose furniture adds the furnished families. */
const GOODS = sandboxContent().goods;
/** Furniture points a home stores: one whole piece of the sandbox furniture, room for one more family. */
const SOME_FURNITURE = 1000;

/** A built home of `player`; `furniture` stocks its furniture pool. */
function home(id: number, player = HUMAN_PLAYER, typeId = HOME_TYPE, tribe = TRIBE, furniture = 0): Ent {
  return {
    id,
    components: {
      Building: { buildingType: typeId, built: ONE, tribe, level: 0 },
      Owner: { player },
      HomeQuality: { cooking: 0, lodging: furniture, piety: 0 },
    },
  };
}

/** A settler of `player`; `home` moves it in as a resident. */
function person(id: number, opts: { player?: number; tribe?: number; home?: number } = {}): Ent {
  return {
    id,
    components: {
      Settler: { jobType: 0, tribe: opts.tribe ?? TRIBE },
      Owner: { player: opts.player ?? HUMAN_PLAYER },
      ...(opts.home !== undefined ? { Residence: { home: opts.home } } : {}),
    },
  };
}

describe('computeHouseHighlight / houseAssignableAt', () => {
  it('lights an empty own home and the click resolver agrees', () => {
    const snap = snapshotOf([person(1), home(10)]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'candidate' }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES, GOODS)).toBe(true);
  });

  it('lights an own home under construction and reserves its family slot', () => {
    const site: Ent = {
      id: 10,
      components: {
        Building: { buildingType: HOME_TYPE, built: 0, tribe: TRIBE },
        UnderConstruction: {},
        Owner: { player: HUMAN_PLAYER },
      },
    };
    const snap = snapshotOf([person(1), site]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'candidate' }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES, GOODS)).toBe(true);
  });

  it('reds a home already holding homeSize other families', () => {
    const snap = snapshotOf([
      person(1),
      home(10),
      person(2, { home: 10 }), // two unrelated households fill a homeSize-2 home
      person(3, { home: 10 }),
    ]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'refused' }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES, GOODS)).toBe(false);
  });

  it('takes one more family into a full home while it stores furniture', () => {
    const residents = [person(2, { home: 10 }), person(3, { home: 10 })];
    const furnished = snapshotOf([
      person(1),
      home(10, HUMAN_PLAYER, HOME_TYPE, TRIBE, SOME_FURNITURE),
      ...residents,
    ]);
    expect(computeHouseHighlight(furnished, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'candidate' }]);
    expect(houseAssignableAt(furnished, 10, [1], HOUSES, GOODS)).toBe(true);
    const bare = snapshotOf([person(1), home(10), ...residents]);
    expect(houseAssignableAt(bare, 10, [1], HOUSES, GOODS)).toBe(false);
  });

  it('offers no click on the home a lone mover already lives in', () => {
    const snap = snapshotOf([person(1, { home: 10 }), home(10)]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'refused' }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES, GOODS)).toBe(false);
  });

  it('skips a non-home building and another player’s home', () => {
    const snap = snapshotOf([person(1), home(11, HUMAN_PLAYER, MILL_TYPE), home(14, ENEMY_PLAYER)]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([]); // never marked, not even refused
    for (const id of [11, 14]) expect(houseAssignableAt(snap, id, [1], HOUSES, GOODS)).toBe(false);
  });

  it('lights an own home of another tribe, which the sim’s assignHouse accepts', () => {
    const snap = snapshotOf([person(1), home(10, HUMAN_PLAYER, HOME_TYPE, OTHER_TRIBE)]);
    expect(computeHouseHighlight(snap, [1], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'candidate' }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES, GOODS)).toBe(true);
  });

  it('verdicts stay in lockstep with the click resolver across a mixed world', () => {
    const snap = snapshotOf([
      person(1),
      home(10), // free
      home(20), // filled below
      person(2, { home: 20 }),
      person(3, { home: 20 }),
    ]);
    const items = computeHouseHighlight(snap, [1], HOUSES, GOODS);
    expect(items.length).toBe(2);
    for (const item of items)
      expect(item.tone === 'candidate').toBe(houseAssignableAt(snap, item.id, [1], HOUSES, GOODS));
  });
});

describe('a home pick armed for a group', () => {
  it('refuses a full home a selected member already lives in', () => {
    const snap = snapshotOf([person(1, { home: 10 }), person(3, { home: 10 }), person(2), home(10)]);
    expect(computeHouseHighlight(snap, [1, 2], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'refused' }]);
    expect(houseAssignableAt(snap, 10, [1, 2], HOUSES, GOODS)).toBe(false);
  });

  it('moves only the homeless members while there are any', () => {
    // Home 20 has a free slot, but the only member who could take it is housed while another is homeless
    // and of a seat home 20 refuses: the sim tries the homeless alone, so the click would move nobody.
    const snap = snapshotOf([
      person(1, { home: 10 }),
      person(2, { player: ENEMY_PLAYER }),
      home(10),
      home(20),
    ]);
    expect(houseAssignableAt(snap, 20, [1, 2], HOUSES, GOODS)).toBe(false);
    expect(houseAssignableAt(snap, 20, [1], HOUSES, GOODS)).toBe(true);
  });

  it('lights a home one member may move into, though another member may not', () => {
    const snap = snapshotOf([person(1), person(2, { player: ENEMY_PLAYER }), home(10)]);
    expect(computeHouseHighlight(snap, [1, 2], HOUSES, GOODS)).toEqual([{ id: 10, tone: 'candidate' }]);
    expect(computeHouseHighlight(snap, [2], HOUSES, GOODS)).toEqual([]);
  });

  it('sends the whole group to the clicked home as one order', () => {
    const homes = [home(10, HUMAN_PLAYER, BUILDING_HOME_00), home(20, HUMAN_PLAYER, BUILDING_HOME_00)];
    const snap = snapshotOf([person(1), person(2), person(3, { home: 20 }), ...homes]);
    const issued: Command[] = [];
    const house: Pickable = { ref: 10, x: 0, y: 0 };
    const pick = buildingPickController({
      snapshot: () => snap,
      content: sandboxContent(),
      targets: { ...NO_TARGETS, owned: (kind) => (kind === 'building' ? [house] : []) },
      enqueue: (command) => issued.push(command),
    });

    pick.arm({ kind: 'home', units: [1, 2, 3] });
    expect(pick.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent)).toBe('ordered');
    expect(issued).toEqual([
      { kind: 'assignHouseGroup', members: [{ entity: 1 }, { entity: 2 }, { entity: 3 }], house: 10 },
    ]);
  });

  it('aims at the home a press would name, with its verdict, and at nothing off every judged one', () => {
    const snap = snapshotOf([person(1, { home: 10 }), home(10, HUMAN_PLAYER, BUILDING_HOME_00)]);
    let under: Pickable[] = [{ ref: 10, x: 0, y: 0 }];
    const pick = buildingPickController({
      snapshot: () => snap,
      content: sandboxContent(),
      targets: { ...NO_TARGETS, owned: (kind) => (kind === 'building' ? under : []) },
    });
    expect(pick.aimedAt(0, 0)).toBeNull();
    pick.arm({ kind: 'home', units: [1] });
    expect(pick.aimedAt(0, 0)).toEqual({ id: 10, tone: 'refused' });
    under = [];
    pick.arm({ kind: 'home', units: [1] });
    expect(pick.aimedAt(0, 0)).toBeNull();
  });
});
