import { type Command, ONE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../src/game/rules.js';
import { BUILDING_HOME_00, sandboxContent } from '../src/game/sandbox/index.js';
import type { Pickable } from '../src/view/picking.js';
import {
  computeHouseHighlight,
  type HouseInfo,
  houseAssignableAt,
} from '../src/view/unit-controls/highlights/index.js';
import { createPickModeController } from '../src/view/unit-controls/pick-mode.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The "przypisz dom" verdict - the residential twin of `assign-highlight.test.ts`. A home is green iff
 * it is an own `home` with a free FAMILY slot (`homeSize` counts families, not heads) for the
 * settler's household. The key invariant, as on the workplace side: the highlight (`computeHouseHighlight`,
 * what the player sees green) and the click resolver (`houseAssignableAt`, what a click binds) must agree
 * home-for-home, so a green home never silently cancels the click and a red one never binds.
 */

const TRIBE = 1; // the settlers' own tribe; OTHER_TRIBE below is the mismatch case
const OTHER_TRIBE = 2;
const HOME_TYPE = 2; // a `home`-kind building type
const MILL_TYPE = 9; // any non-home type - never a candidate
const HOME_SIZE = 2; // this home level holds two families
const HOUSES = new Map<number, HouseInfo>([
  [HOME_TYPE, { kind: 'home', homeSize: HOME_SIZE }],
  [MILL_TYPE, { kind: 'production' }],
]);

/** A built home of `player`. */
function home(id: number, player = HUMAN_PLAYER, typeId = HOME_TYPE, tribe = TRIBE): Ent {
  return {
    id,
    components: { Building: { buildingType: typeId, built: ONE, tribe }, Owner: { player } },
  };
}

/** A settler of `player`; `minor` marks a still-growing child, `marriage` links a spouse/child, and
 *  `home` moves it in as a resident. */
function person(
  id: number,
  opts: {
    player?: number;
    tribe?: number;
    minor?: boolean;
    spouse?: number;
    child?: number | null;
    home?: number;
  } = {},
): Ent {
  return {
    id,
    components: {
      Settler: { jobType: 0, tribe: opts.tribe ?? TRIBE },
      Owner: { player: opts.player ?? HUMAN_PLAYER },
      ...(opts.minor === true ? { Age: { ticks: 0 } } : {}),
      ...(opts.spouse !== undefined ? { Marriage: { spouse: opts.spouse, child: opts.child ?? null } } : {}),
      ...(opts.home !== undefined ? { Residence: { home: opts.home } } : {}),
    },
  };
}

describe('computeHouseHighlight / houseAssignableAt', () => {
  it('greens an empty own home and the click resolver agrees', () => {
    const snap = snapshotOf([person(1), home(10)]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([{ id: 10, ok: true }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES)).toBe(true);
  });

  it('greens an own home under construction and reserves its family slot', () => {
    const site: Ent = {
      id: 10,
      components: {
        Building: { buildingType: HOME_TYPE, built: 0, tribe: TRIBE },
        UnderConstruction: {},
        Owner: { player: HUMAN_PLAYER },
      },
    };
    const snap = snapshotOf([person(1), site]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([{ id: 10, ok: true }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES)).toBe(true);
  });

  it('reds a home already holding homeSize other families', () => {
    const snap = snapshotOf([
      person(1),
      home(10),
      person(2, { home: 10 }), // two unrelated households fill a homeSize-2 home
      person(3, { home: 10 }),
    ]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([{ id: 10, ok: false }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES)).toBe(false);
  });

  it('offers no click on the home a lone mover already lives in', () => {
    const snap = snapshotOf([person(1, { home: 10 }), home(10)]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([{ id: 10, ok: false }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES)).toBe(false);
  });

  it('skips a non-home building and another player’s home', () => {
    const snap = snapshotOf([person(1), home(11, HUMAN_PLAYER, MILL_TYPE), home(14, ENEMY_PLAYER)]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([]); // never tinted, not even red
    for (const id of [11, 14]) expect(houseAssignableAt(snap, id, [1], HOUSES)).toBe(false);
  });

  it('reds an own home of ANOTHER TRIBE, which the sim’s assignHouse refuses', () => {
    // A seat can field several tribes, so its own settlement holds homes this settler may not move
    // into. Tinting one green would enqueue an order the sim silently drops.
    const snap = snapshotOf([person(1), home(10, HUMAN_PLAYER, HOME_TYPE, OTHER_TRIBE)]);
    expect(computeHouseHighlight(snap, [1], HOUSES)).toEqual([{ id: 10, ok: false }]);
    expect(houseAssignableAt(snap, 10, [1], HOUSES)).toBe(false);
  });

  it('verdicts stay in lockstep with the click resolver across a mixed world', () => {
    const snap = snapshotOf([
      person(1),
      home(10), // free
      home(20), // filled below
      person(2, { home: 20 }),
      person(3, { home: 20 }),
    ]);
    const items = computeHouseHighlight(snap, [1], HOUSES);
    expect(items.length).toBe(2);
    for (const item of items) expect(item.ok).toBe(houseAssignableAt(snap, item.id, [1], HOUSES));
  });
});

const NO_TARGETS: UnitTargets = {
  owned: () => [],
  buildings: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
  chests: () => [],
  goods: () => [],
  resources: () => [],
  wildlife: () => [],
  ownedSettlersIn: () => [],
};

describe('a home pick armed for a group', () => {
  it('reds a full home a selected member already lives in', () => {
    const snap = snapshotOf([person(1, { home: 10 }), person(3, { home: 10 }), person(2), home(10)]);
    expect(computeHouseHighlight(snap, [1, 2], HOUSES)).toEqual([{ id: 10, ok: false }]);
    expect(houseAssignableAt(snap, 10, [1, 2], HOUSES)).toBe(false);
  });

  it('moves only the homeless members while there are any', () => {
    // Home 20 has a free slot, but the only member who could take it is housed while another is homeless
    // and of a tribe home 20 refuses: the sim tries the homeless alone, so the click would move nobody.
    const snap = snapshotOf([person(1, { home: 10 }), person(2, { tribe: OTHER_TRIBE }), home(10), home(20)]);
    expect(houseAssignableAt(snap, 20, [1, 2], HOUSES)).toBe(false);
    expect(houseAssignableAt(snap, 20, [1], HOUSES)).toBe(true);
  });

  it('greens a home one member may move into, though another member may not', () => {
    const snap = snapshotOf([person(1), person(2, { player: ENEMY_PLAYER }), home(10)]);
    expect(computeHouseHighlight(snap, [1, 2], HOUSES)).toEqual([{ id: 10, ok: true }]);
    expect(computeHouseHighlight(snap, [2], HOUSES)).toEqual([]);
  });

  it('sends the whole group to the clicked home as one order', () => {
    const homes = [home(10, HUMAN_PLAYER, BUILDING_HOME_00), home(20, HUMAN_PLAYER, BUILDING_HOME_00)];
    const snap = snapshotOf([person(1), person(2), person(3, { home: 20 }), ...homes]);
    const issued: Command[] = [];
    const house: Pickable = { ref: 10, x: 0, y: 0 };
    const pick = createPickModeController({
      snapshot: () => snap,
      targets: { ...NO_TARGETS, owned: (kind) => (kind === 'building' ? [house] : []) },
      content: sandboxContent(),
      mapSize: { width: 8, height: 8 },
      toWorld: () => ({ x: 0, y: 0 }),
      nodeAt: () => ({ col: 0, row: 0 }),
      enqueue: (command) => issued.push(command),
      orders: () => {
        throw new Error('no order controller in this test');
      },
      setArmedCursor: () => undefined,
    });

    pick.arm({ kind: 'home', settlers: [1, 2, 3] });
    expect(pick.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent)).toBe('ordered');
    expect(issued).toEqual([{ kind: 'assignHouseGroup', entities: [1, 2, 3], house: 10 }]);
  });
});
