import { fx, type MatchOutcome } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_BUILDER,
  JOB_CHILD_FEMALE,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../../../src/catalog/jobs.js';
import { PRIMARY_TRIBE } from '../../../src/game/rules.js';
import { sandboxContent } from '../../../src/game/sandbox/content/index.js';
import {
  GOOD_AMULET_STRENGTH,
  GOOD_ARMOR_CHAIN,
  GOOD_ARMOR_WOOL,
  GOOD_CATAPULT,
  GOOD_POTION_HEAL_BIG,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  GOOD_TOOL_IRON,
} from '../../../src/game/sandbox/ids/economy/goods.js';
import { VEHICLE_CATAPULT, VEHICLE_HANDCART } from '../../../src/game/sandbox/ids/vehicles.js';
import { WEAPON_FISTS, WEAPON_SWORD } from '../../../src/game/sandbox/ids/weapons.js';
import { seatArmy, seatStandings } from '../../../src/hud/summary/standings.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

const HOME = 0;
const RIVAL = 1;
const QUIET = 2;
const BUILDING_TYPE = 3;
const HALF_BUILT = fx.fromFloat(0.5);

let nextId = 1;
function person(owner: number, jobType: number, female = false, extra: Record<string, unknown> = {}): Ent {
  return {
    id: nextId++,
    components: {
      Owner: { player: owner },
      Person: {},
      Settler: { jobType, tribe: PRIMARY_TRIBE },
      ...(female ? { Female: {} } : {}),
      ...extra,
    },
  };
}
function house(owner: number, built = fx.fromInt(1), constructing = false): Ent {
  return {
    id: nextId++,
    components: {
      Owner: { player: owner },
      Building: { buildingType: BUILDING_TYPE, built },
      ...(constructing ? { UnderConstruction: {} } : {}),
    },
  };
}

const undecided = (): MatchOutcome => 'undecided';

type Slot = { goodType: number; degreeOfUse: number } | null;
const worn = (goodType: number): Slot => ({ goodType, degreeOfUse: 0 });
const MISC_SLOTS = 4;
function gear(weapon: Slot, armor: Slot, carried: readonly number[] = []) {
  const misc: Slot[] = carried.map(worn);
  while (misc.length < MISC_SLOTS) misc.push(null);
  return { Equipment: { boots: null, tool: null, weapon, armor, misc } };
}
function vehicle(owner: number, vehicleType: number): Ent {
  return { id: nextId++, components: { Owner: { player: owner }, Vehicle: { vehicleType } } };
}

describe('seat standings', () => {
  it("count each seat's own people by sex, age and army, and its finished buildings alone", () => {
    const snapshot = snapshotOf([
      person(HOME, JOB_BUILDER),
      person(HOME, JOB_SOLDIER_SWORD),
      person(HOME, JOB_SOLDIER_SWORD),
      person(HOME, JOB_WOMAN, true),
      person(HOME, JOB_CHILD_FEMALE, true),
      house(HOME),
      house(HOME, HALF_BUILT),
      house(HOME, fx.fromInt(1), true),
      person(RIVAL, JOB_SOLDIER_SWORD),
      house(RIVAL),
      house(RIVAL),
    ]);

    const [home, rival] = seatStandings(snapshot, [HOME, RIVAL], undecided);

    expect(home?.people).toMatchObject({ men: 3, soldiers: 2, women: 1, children: 1, total: 5 });
    expect(home?.buildings).toBe(1);
    expect(rival?.people).toMatchObject({ men: 1, soldiers: 1, women: 0, children: 0, total: 1 });
    expect(rival?.buildings).toBe(2);
  });

  it('read a decided seat by its outcome, and a seat owning nothing as empty', () => {
    const snapshot = snapshotOf([person(HOME, JOB_BUILDER), house(RIVAL)]);
    const outcomes = new Map<number, MatchOutcome>([[RIVAL, 'defeat']]);

    const statuses = seatStandings(snapshot, [HOME, RIVAL, QUIET], (p) => outcomes.get(p) ?? 'undecided').map(
      (standing) => standing.status,
    );
    expect(statuses).toEqual(['playing', 'defeated', 'empty']);

    outcomes.set(HOME, 'victory');
    expect(seatStandings(snapshot, [HOME], (p) => outcomes.get(p) ?? 'undecided')[0]?.status).toBe('won');
  });
});

describe("a seat's army", () => {
  const content = sandboxContent();
  const goodId = (typeId: number): string | undefined => content.goods.find((g) => g.typeId === typeId)?.id;
  const chainClass = content.armor.find((a) => a.goodType === GOOD_ARMOR_CHAIN)?.typeId;

  it('counts soldiers by worn or stamped weapon and armour, the misc goods they carry, and siege vehicles', () => {
    const snapshot = snapshotOf([
      person(
        HOME,
        JOB_SOLDIER_BROADSWORD,
        false,
        gear(worn(GOOD_SWORD_LONG), worn(GOOD_ARMOR_CHAIN), [GOOD_POTION_HEAL_BIG, GOOD_AMULET_STRENGTH]),
      ),
      person(
        HOME,
        JOB_SOLDIER_BROADSWORD,
        false,
        gear(worn(GOOD_SWORD_LONG), worn(GOOD_ARMOR_WOOL), [GOOD_POTION_HEAL_BIG, GOOD_POTION_HEAL_BIG]),
      ),
      // No worn goods: the classes stamped on him stand for them.
      person(HOME, JOB_SOLDIER_SWORD, false, {
        Weapon: { weaponTypeId: WEAPON_SWORD },
        Armor: { armorClass: chainClass },
      }),
      // Fists are no weapon good.
      person(HOME, JOB_SOLDIER_UNARMED, false, { Weapon: { weaponTypeId: WEAPON_FISTS } }),
      // Neither a woman nor a worker joins the army, whatever they carry.
      person(HOME, JOB_WOMAN, true, gear(null, null, [GOOD_AMULET_STRENGTH])),
      person(HOME, JOB_BUILDER, false, gear(null, null, [GOOD_TOOL_IRON])),
      vehicle(HOME, VEHICLE_CATAPULT),
      vehicle(HOME, VEHICLE_CATAPULT),
      vehicle(HOME, VEHICLE_HANDCART),
      vehicle(RIVAL, VEHICLE_CATAPULT),
    ]);

    const army = seatArmy(snapshot, HOME, content);

    expect(army.soldiers).toBe(4);
    expect(army.weapons).toEqual([
      { goodId: goodId(GOOD_SWORD_SHORT), count: 1 },
      { goodId: goodId(GOOD_SWORD_LONG), count: 2 },
    ]);
    expect(army.unarmed).toBe(1);
    expect(army.armour).toEqual([
      { goodId: goodId(GOOD_ARMOR_WOOL), count: 1 },
      { goodId: goodId(GOOD_ARMOR_CHAIN), count: 2 },
    ]);
    expect(army.unarmoured).toBe(1);
    expect(army.carried).toEqual([
      { goodId: goodId(GOOD_POTION_HEAL_BIG), count: 3 },
      { goodId: goodId(GOOD_AMULET_STRENGTH), count: 1 },
    ]);
    expect(army.siege).toEqual([{ goodId: goodId(GOOD_CATAPULT), count: 2 }]);
    expect(seatArmy(snapshot, QUIET, content).soldiers).toBe(0);
  });
});
