import { describe, expect, it } from 'vitest';
import {
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractVehicles,
  extractWeapons,
  parseIniSections,
} from '../src/decoders/ini.js';
import { ATOMICANIMATIONS_INI, VEHICLETYPES_INI, WEAPONTYPES_INI } from './fixtures/ini-sources.js';

// Mirrors Data/logic/armortypes.ini (plain `.ini`; the `<CULTURES_CIF_BEGIN>` header line is not a
// `[section]` so the parser ignores it like vehicletypes/goodtypes): each `[armortype]` carries a
// numeric `type` (the armor CLASS a weapon's `damagevalue <class> <v>` keys against), a quoted `name`,
// `maintype`, `goodtype` (the good that IS the armor), `materialtype`, `weight`, `blockingvalue`. The
// woolen (light, weight 1) and plate (heavy, weight 3) records bracket the real table; the third omits
// the optional numeric lines to exercise the schema defaults (weight/blockingValue -> 0).
const ARMORTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000020> Don't modify this line!
[armortype]
name "woolen armor"
type 1
mainType 1
goodtype 33
materialType 1
weight 1
blockingValue 5
[armortype]
name "plate armor"
type 4
mainType 2
goodtype 36
materialType 4
weight 3
blockingValue 5
[armortype]
name "bare"
type 9
`;

// Mirrors Data/logic/animaltypes.ini: an `[animaltype]` keys on `tribetype` (NOT `type`). A full bear
// record (aggressive predator, big HP pool, herd params), a minimal boar (only the required tribetype +
// a couple of fields → schema defaults fill the rest), and a leftover stub with NO tribetype that the
// extractor must DROP (it cannot resolve to a tribe). The records carry no `name` line in the real
// file, so the slug falls back to `animal_<tribeType>`.
const ANIMALTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000040> Don't modify this line!
[animaltype]
tribetype 8
getangry 1
aggressive 0
angryGameTime 240
warrantable 0
maximumleaderdistance 20
searchforleader 0
maximumdistancetostaypoint 20
maximumdistancetobirthpoint 40
maximumgroupsize 3
maximumcadaversize 4
hitpoints_adult 15000
hitpoints_baby 15000
catchable 0
[animaltype]
tribetype 9
aggressive 1
searchforleader 1
maximumgroupsize 6
hitpoints_adult 2000
movespeed 8
runspeed 12
ignorehouses 1
cannotbeattacked 0
[animaltype]
getangry 1
hitpoints_adult 5000
catchable 0
`;

describe('extractWeapons', () => {
  it('maps [weapontype] sections to validated WeaponType IR with armor-class-keyed damage', () => {
    const weapons = extractWeapons(parseIniSections(WEAPONTYPES_INI), {
      file: 'DataCnmd/types/weapons.ini',
      layer: 'mod',
    });
    const src = { file: 'DataCnmd/types/weapons.ini', block: 'weapontype', layer: 'mod' };
    expect(weapons).toEqual([
      {
        typeId: 2,
        id: 'woman_fist',
        name: 'woman fist',
        tribeType: 1,
        mainType: 1, // coarse weapon class
        weight: 0, // schema default; the fist adds no encumbrance
        minRange: 1,
        maxRange: 1,
        damage: { '0': 400, '1': 80 },
        jobType: 5,
        // `goodtype 0` is the natural-weapon sentinel -> no `goodType` field (undefined dropped by toEqual).
        // A melee fist fires nothing -> no `munitionType` field either (undefined dropped by toEqual).
        source: src,
      },
      // Same `type 2` but a different tribe — `(tribeType, typeId)` is the composite key. No range
      // pair -> schema range defaults of 1; combat extras (atomicactiontype, sound) ignored.
      {
        typeId: 2,
        id: 'short_bow',
        name: 'short bow',
        tribeType: 2,
        mainType: 6, // a different weapon class — captured per record
        weight: 1, // non-zero encumbrance captured
        munitionType: 1, // a ranged weapon's ammo class (bow ammo) — captured, NOT good id 1
        speed: 8, // a ranged weapon's projectile travel speed — captured (undefined-dropped on melee)
        damageType: 2, // the damage class (siege marker, all-lowercase key) — captured, NOT good id 2
        minRange: 1,
        maxRange: 1,
        damage: { '0': 2400 },
        jobType: 32,
        goodType: 5, // a real good — the good that IS this weapon
        source: src,
      },
    ]);
  });

  it('throws on a [weapontype] missing its numeric `type`', () => {
    expect(() => extractWeapons(parseIniSections('[weapontype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });
});

describe('extractVehicles', () => {
  it('maps [vehicletype] sections to validated VehicleType IR with stock/passenger slots', () => {
    const vehicles = extractVehicles(parseIniSections(VEHICLETYPES_INI), {
      file: 'Data/logic/vehicletypes.ini',
      layer: 'base',
    });
    const src = { file: 'Data/logic/vehicletypes.ini', block: 'vehicletype', layer: 'base' };
    expect(vehicles).toEqual([
      {
        typeId: 1,
        id: 'handcart',
        name: 'handcart',
        stockSlots: 15,
        passengerSlots: 0,
        logicSize: 0,
        // Two repeated `logicgood N` lines -> the cargo allow-list, in file order.
        cargoGoods: [16, 17],
        source: src,
      },
      {
        typeId: 3,
        id: 'ship_small',
        name: 'ship small',
        stockSlots: 50,
        passengerSlots: 19,
        logicSize: 2,
        // This fixture's small-ship section lists no `logicgood` -> empty allow-list (schema default).
        cargoGoods: [],
        source: src,
      },
      // No slot/size/logicgood lines -> schema defaults (0 / empty) for all.
      {
        typeId: 5,
        id: 'catapult',
        name: 'catapult',
        stockSlots: 0,
        passengerSlots: 0,
        logicSize: 0,
        cargoGoods: [],
        source: src,
      },
    ]);
  });

  it('throws on a [vehicletype] missing its numeric `type`', () => {
    expect(() => extractVehicles(parseIniSections('[vehicletype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });
});

describe('extractArmor', () => {
  it('maps [armortype] sections to validated ArmorType IR with the armor class + blocking value', () => {
    const armor = extractArmor(parseIniSections(ARMORTYPES_INI), {
      file: 'Data/logic/armortypes.ini',
      layer: 'base',
    });
    const src = { file: 'Data/logic/armortypes.ini', block: 'armortype', layer: 'base' };
    expect(armor).toEqual([
      {
        typeId: 1,
        id: 'woolen_armor',
        name: 'woolen armor',
        mainType: 1,
        goodType: 33,
        materialType: 1,
        weight: 1,
        blockingValue: 5,
        source: src,
      },
      {
        typeId: 4,
        id: 'plate_armor',
        name: 'plate armor',
        mainType: 2,
        goodType: 36,
        materialType: 4,
        weight: 3,
        blockingValue: 5,
        source: src,
      },
      // No mainType/goodtype/materialType/weight/blockingValue lines -> schema defaults (weight 0,
      // blockingValue 0); the optional ids parse to explicit `undefined` (zod `.optional()`).
      {
        typeId: 9,
        id: 'bare',
        name: 'bare',
        mainType: undefined,
        goodType: undefined,
        materialType: undefined,
        weight: 0,
        blockingValue: 0,
        source: src,
      },
    ]);
  });

  it('throws on an [armortype] missing its numeric `type`', () => {
    expect(() => extractArmor(parseIniSections('[armortype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });
});

describe('extractAnimals', () => {
  it('maps [animaltype] sections (keyed on tribetype) to validated AnimalType IR', () => {
    const animals = extractAnimals(parseIniSections(ANIMALTYPES_INI), {
      file: 'Data/logic/animaltypes.ini',
      layer: 'base',
    });
    const src = { file: 'Data/logic/animaltypes.ini', block: 'animaltype', layer: 'base' };
    expect(animals).toEqual([
      {
        id: 'animal_8',
        name: undefined,
        tribeType: 8,
        aggressive: false,
        getAngry: true,
        angryGameTime: 240,
        hitpointsAdult: 15000,
        hitpointsBaby: 15000,
        maximumGroupSize: 3,
        maximumCadaverSize: 4,
        maximumLeaderDistance: 20,
        searchForLeader: false,
        maximumDistanceToStayPoint: 20,
        maximumDistanceToBirthPoint: 40,
        moveSpeed: 0,
        runSpeed: 0,
        catchable: false,
        warrantable: false,
        cannotBeAttacked: false,
        ignoreHouses: false,
        source: src,
      },
      // The minimal boar: every omitted numeric/flag field falls back to its schema default.
      {
        id: 'animal_9',
        name: undefined,
        tribeType: 9,
        aggressive: true,
        getAngry: false,
        angryGameTime: 0,
        hitpointsAdult: 2000,
        hitpointsBaby: 0,
        maximumGroupSize: 6,
        maximumCadaverSize: 0,
        maximumLeaderDistance: 0,
        searchForLeader: true,
        maximumDistanceToStayPoint: 0,
        maximumDistanceToBirthPoint: 0,
        moveSpeed: 8,
        runSpeed: 12,
        catchable: false,
        warrantable: false,
        cannotBeAttacked: false,
        ignoreHouses: true,
        source: src,
      },
    ]);
  });

  it('drops an [animaltype] with no tribetype (a disabled stub that cannot resolve to a tribe)', () => {
    // The third record in ANIMALTYPES_INI carries no `tribetype` — it is silently dropped, NOT thrown
    // on (the key is genuinely absent in real data, unlike a malformed `type`-keyed table).
    const animals = extractAnimals(parseIniSections(ANIMALTYPES_INI), { file: 'animaltypes.ini' });
    expect(animals.map((a) => a.tribeType)).toEqual([8, 9]);
  });
});

describe('extractAtomicAnimations', () => {
  it('captures length/interruptable/startdirection scalars and ordered event/eventx tuples', () => {
    const anims = extractAtomicAnimations(parseIniSections(ATOMICANIMATIONS_INI), {
      file: 'DataCnmd/atomicanimations12/atomicanimations.ini',
      layer: 'mod',
    });
    const src = {
      file: 'DataCnmd/atomicanimations12/atomicanimations.ini',
      block: 'atomicanimation',
      layer: 'mod',
    };
    expect(anims).toEqual([
      {
        id: 'viking_woman_pickup',
        name: 'viking_woman_pickup',
        length: 20,
        interruptible: true,
        startDirection: 6,
        events: [
          // `event 16 11 0` -> value 0 kept (distinct from a missing value).
          { at: 16, type: 11, value: 0, extended: false },
          // `eventx` becomes an extended event; signed value preserved.
          { at: 18, type: 22, value: -100, extended: true },
          // `event 19 13` has no value field -> `value` omitted entirely.
          { at: 19, type: 13, extended: false },
        ],
        source: src,
      },
      {
        id: 'viking_child_female_eat_slot_food',
        name: 'viking_child_female_eat_slot_food',
        length: 50,
        interruptible: false,
        events: [{ at: 30, type: 2, value: 4000, extended: false }],
        source: src,
      },
      // No length/interruptable lines -> schema defaults (length 0, not interruptible, no events).
      {
        id: 'viking_man_idle',
        name: 'viking_man_idle',
        length: 0,
        interruptible: false,
        events: [],
        source: src,
      },
    ]);
  });

  it('treats `interruptable 0` and a missing interruptable line both as not interruptible', () => {
    const [off] = extractAtomicAnimations(
      parseIniSections('[atomicanimation]\nname "a"\ninterruptable 0\n'),
      { file: 'f.ini' },
    );
    expect(off?.interruptible).toBe(false);
  });

  it('skips a malformed event line (non-numeric at/type) but keeps valid ones in file order', () => {
    const [anim] = extractAtomicAnimations(
      parseIniSections('[atomicanimation]\nname "a"\nevent 10 5 +200\nevent bad 9\nevent 20 6\n'),
      { file: 'f.ini' },
    );
    expect(anim?.events).toEqual([
      { at: 10, type: 5, value: 200, extended: false },
      { at: 20, type: 6, extended: false },
    ]);
  });

  it('throws on an [atomicanimation] with no (or empty) `name` — it would be unreferenceable', () => {
    expect(() =>
      extractAtomicAnimations(parseIniSections('[atomicanimation]\nlength 20\n'), { file: 'f.ini' }),
    ).toThrow(/without a `name`/);
    // An empty/whitespace name is just as unreferenceable as a missing one.
    expect(() =>
      extractAtomicAnimations(parseIniSections('[atomicanimation]\nname ""\n'), { file: 'f.ini' }),
    ).toThrow(/without a `name`/);
  });
});
