import { AtomicAnimation, TribeType, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import {
  cifLinesToSections,
  decodeIni,
  extractAnimals,
  extractArmor,
  extractAtomicAnimations,
  extractBuildings,
  extractConstructionCosts,
  extractGoods,
  extractGraphicsBindings,
  extractJobBaseGraphics,
  extractJobChangeGraphics,
  extractJobExperience,
  extractJobs,
  extractLandscape,
  extractMapInfo,
  extractPaletteIndex,
  extractTribes,
  extractVehicles,
  extractWeapons,
  fillBuildingRecipes,
  parseIniSections,
} from '../src/decoders/ini.js';

/**
 * Rule parser tests. No copyrighted fixtures are committed: the `.ini` snippets below are synthetic
 * but mirror the real grammar of `Data/logic/goodtypes.ini` and `landscapetypes.ini` (quoted names,
 * multi-value lines, repeated keys, the `<CULTURES_CIF_BEGIN>` header).
 */

const GOODTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000247> Don't modify this line!
[goodtype]
name "water"
type 1
landscapetype 3
isInputGoodFlag 1

[goodtype]
name "wood"
type 5
landscapetype 7
isInputGoodFlag 1
isProducedOnMapFlag 1
atomicForHarvesting 24

[goodtype]
name "wheat"
type 4
isInputGoodFlag 1
isProducedOnMapFlag 1
atomicForHarvesting 29
atomicForCultivating 35
atomicForPlanting 34

[goodtype]
name "coin"
type 8
isProducedInHouseFlag 1
productionInputGoods 5 4
atomicForProduction 51

[goodtype]
name "potion"
type 9
productionInputGoods 1 1 4 4 5
atomicForProduction 73
`;

// Mirrors Data/logic/jobtypes.ini: repeated `allowatomic`, a single `baseatomics`, and a
// `forbidatomic` deny line. The second job carries a `&`/space name to exercise slugging.
const JOBTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><0000027A> Don't modify this line!
[jobtype]
type 3
name "child_female"
baseatomics 1
allowatomic 8
allowatomic 15
forbidatomic 99
canBeTrainedFlag 0
[jobtype]
type 30
name "herb & mush guy"
allowatomic 8
`;

// Mirrors DataCnmd/tribetypes12/tribetypes.ini: `setatomic <job> <atomic> "anim"`, incl. a line
// with a trailing `//`-comment (the real file has these on a few ship atomics).
const TRIBETYPES_INI = `[tribetype]
type 1
name "viking"
setatomic 1 8 "viking_baby_female_sleep"
setatomic 5 22 "viking_woman_pickup"
setatomic 52 84 "viking_ship_small_idle_short_a" // "viking_ship_small_dock"
setatomic 5 22 "viking_woman_pickup_alt"
jobEnablesGood 5 5
jobEnablesHouse 5 2
jobEnablesGood 1 4
jobEnablesJob 5 1
jobEnablesVehicle 5 3
jobEnablesGood notanint 5
needforjob 1 10 6 7
needforgood 5 15 9
trainforjob 1 10 77
trainforgood 4 5 57
needforjob notanint 10 3
`;

// Mirrors DataCnmd/atomicanimations12/atomicanimations.ini: `[atomicanimation]` records with a
// quoted `name`, scalar `length`/`interruptable`/`startdirection`, and timed `event`/`eventx` lines
// (3-field = no value, 4-field = signed value). The first record exercises every field; the others
// exercise defaults (no length/interruptable) and the eat-yield shape.
const ATOMICANIMATIONS_INI = `[atomicanimation]
name "viking_woman_pickup"
length 20
interruptable 1
startdirection 6
event 16 11 0
eventx 18 22 -100
event 19 13

[atomicanimation]
name "viking_child_female_eat_slot_food"
length 50
event 30 2 +4000

[atomicanimation]
name "viking_man_idle"
`;

// Mirrors DataCnmd/types/weapons.ini: each `[weapontype]` has a `tribetype` + a quoted `name`, a
// `type`, the `minimumrange`/`maximumrange` pair, repeated `damagevalue <armorClass> <value>` lines,
// a `jobtype`, and combat extras the schema doesn't carry (`atomicactiontype`, `soundtype_Hit`) that
// are ignored. Both weapons share `type 2` across different tribes — the real data's `(tribetype,
// type)` composite key (type alone is not unique). The second omits the range pair to exercise the
// schema's range defaults of 1. The fist's `goodtype 0` is the natural-weapon sentinel (-> undefined);
// the spear's `goodtype 5` is a real good (-> captured; 5 also exists in the IR-integration goods
// fixture below so the cross-ref resolves there).
const WEAPONTYPES_INI = `// new
[weapontype]
tribetype 1
type 2
name "woman fist"
goodtype 0
minimumrange 1
maximumrange 1
damagevalue 0 400
damagevalue 1 80
jobtype 5
atomicactiontype 81
soundtype_Hit 0 95
[weapontype]
tribetype 2
type 2
name "wooden spear"
goodtype 5
damagevalue 0 2400
jobtype 32
`;

// Mirrors Data/logic/vehicletypes.ini (plain `.ini`, the `<CULTURES_CIF_BEGIN>` header line is not a
// `[section]` so the parser ignores it like goodtypes/landscapetypes): each `[vehicletype]` carries a
// numeric `type`, a quoted `name`, `logicsize`, `stockslots` (the carry capacity), `passengerslots`,
// and the repeated `logicgood N` cargo allow-list (now carried as `cargoGoods`); the `logicpassenger`/
// `debug*` extras the schema doesn't carry are ignored. The handcart (15 slots, no passengers, land
// size 0, two `logicgood`) and the small ship (50 slots, 19 passengers, sea size 2, no `logicgood`)
// bracket the real range. The third omits the slot/size lines to exercise the schema defaults.
const VEHICLETYPES_INI = `<CULTURES_CIF_BEGIN><03FD><000001A0> Don't modify this line!
[vehicletype]
type 1
name "handcart"
logicsize 0
stockslots 15
logicgood 16
logicgood 17
passengerslots 0
debugcolor 0 100 100
[vehicletype]
type 3
name "ship small"
logicsize 2
stockslots 50
passengerslots 19
logicpassenger 25
[vehicletype]
type 5
name "catapult"
`;

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

// Mirrors DataCnmd/types/houses.ini: a `[logichousetype]` keys its id on `logictype` (not `type`) and
// its name on `debugname`. A storage HQ (maintype 1), a home with `logichomesize` (maintype 2), and a
// workplace with workers + `logicproduction` outputs (maintype 3). Stock/worker/production ids here
// reference goods 1/5 and job 5, which the IR-integration test defines so the cross-refs resolve.
const HOUSES_INI = `[logichousetype]
debugname "headquarters"
logictype 1
logicmaintype 1
logicworker 5 3
logicstock 1 150 0
logicstock 5 150 0
debugcolor 0 0 100
logicCanEnableDefenceMode 1

[logichousetype]
debugname "home level 00"
logictype 2
logicmaintype 2
logichomesize 1
logicstock 1 5 1

[logichousetype]
debugname "work mill 00"
logictype 13
logicmaintype 3
logicworker 5 1
logicproduction 5
logicproduction 1
`;

const LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><000002BF> Don't modify this line!
[landscapetype]
type 1
name "void"
allowedoneverything 1
maximumValency 100
debugcolor 117 117 117
[landscapetype]
type 3
name "water"
allowedonland 1
allowedonwater 0
maximumValency 5
[landscapetype]
type 4
name "tree"
allowedonland 1
maximumValency 5
transition 7 4 2 1 0
transition 11 5 2 0 0
debugcolor 2 115 0
[landscapetype]
type 5
name "tree falling"
allowedonland 1
maximumValency 5
[landscapetype]
type 49
name "wall"
allowedonland 1
allowedonwater 1
maximumValency 1
`;

describe('decodeIni (CP1250 byte->text seam)', () => {
  it('decodes 0x80..0xFF bytes as CP1250 Polish glyphs, not UTF-8', () => {
    // "Północ" (mod campaign theme) from its exact CP1250 bytes: 'ó' is 0xF3, 'ł' is 0xB3.
    const polnoc = Uint8Array.from([0x50, 0xf3, 0xb3, 0x6e, 0x6f, 0x63]); // P ó ł n o c
    expect(decodeIni(polnoc)).toBe('Północ');
    // The same bytes read as UTF-8 mangle the high bytes into replacement chars — the bug we avoid.
    expect(new TextDecoder('utf-8').decode(polnoc)).not.toBe('Północ');
  });

  it('leaves ASCII structure (header, [section], keys) byte-identical', () => {
    const text = '<CULTURES_CIF_BEGIN>\n[goodtype]\nname "wood"\ntype 5\n';
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    expect(decodeIni(bytes)).toBe(text);
  });

  it('feeds the parser so a CP1250 display name reaches the section unmangled', () => {
    // 'ś' is 0x9C, 'ą' is 0xB9 in Windows-1250 — exactly the bytes a UTF-8 read would corrupt.
    const bytes = Uint8Array.from([
      0x5b,
      0x74,
      0x5d,
      0x0a, // "[t]\n"
      0x6e,
      0x61,
      0x6d,
      0x65,
      0x20,
      0x22, // 'name "'
      0x9c,
      0xb9, // 'ś', 'ą'
      0x22,
      0x0a, // '"\n'
    ]);
    const [sec] = parseIniSections(decodeIni(bytes));
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['śą']);
  });
});

// A focused two-record slice for the parser test (the extractor's LANDSCAPE_INI grew more records).
const PARSE_LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><000002BF> Don't modify this line!
[landscapetype]
type 4
name "tree"
allowedonland 1
maximumValency 5
transition 7 4 2 1 0
transition 11 5 2 0 0
debugcolor 2 115 0
[landscapetype]
type 5
name "tree falling"
allowedonland 1
maximumValency 5
`;

describe('parseIniSections', () => {
  it('parses sections, skips the CIF header/blank lines, keeps multi-value + repeated keys', () => {
    const sections = parseIniSections(PARSE_LANDSCAPE_INI);
    expect(sections.map((s) => s.name)).toEqual(['landscapetype', 'landscapetype']);

    const tree = sections[0];
    expect(tree?.name).toBe('landscapetype');
    // quoted value -> single token; signed/multi values preserved as raw strings.
    expect(tree?.props.find((p) => p.key === 'name')?.values).toEqual(['tree']);
    expect(tree?.props.find((p) => p.key === 'debugcolor')?.values).toEqual(['2', '115', '0']);
    // repeated `transition` keys are both retained in file order.
    expect(tree?.props.filter((p) => p.key === 'transition')).toHaveLength(2);
  });

  it('treats a quoted value with spaces as one token', () => {
    const [sec] = parseIniSections('[t]\nname "tree falling"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['tree falling']);
  });

  it('strips `//` inline and full-line comments (the marker real .ini files use)', () => {
    // landscapetypes.ini has lines like: `transition 3 80 2 -1 9 // transition 3 80 2 -1 9`
    const sections = parseIniSections('[t]\n// a full-line comment\ntransition 3 80 2 -1 9 // dup\n');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.props).toEqual([{ key: 'transition', values: ['3', '80', '2', '-1', '9'] }]);
  });

  it('keeps a `//` that lives inside a quoted value', () => {
    const [sec] = parseIniSections('[t]\nname "a // b"\n');
    expect(sec?.props.find((p) => p.key === 'name')?.values).toEqual(['a // b']);
  });
});

describe('cifLinesToSections (unification with .cif)', () => {
  it('produces the same RuleSection shape from level-tagged lines as .ini does', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'landscapetype' },
      { level: 2, text: 'type 4' },
      { level: 2, text: 'name "tree"' },
      { level: 2, text: 'debugcolor 2 115 0' },
    ];
    const fromCif = cifLinesToSections(lines);
    const fromIni = parseIniSections('[landscapetype]\ntype 4\nname "tree"\ndebugcolor 2 115 0\n');
    expect(fromCif).toEqual(fromIni);
  });
});

describe('extractGoods', () => {
  it('maps [goodtype] sections to validated GoodType IR with slug ids and provenance', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), {
      file: 'Data/logic/goodtypes.ini',
    });
    const src = { file: 'Data/logic/goodtypes.ini', block: 'goodtype', layer: 'base' };
    const noClass = { producedOnMap: false, producedInHouse: false, inputGood: false };
    expect(goods).toEqual([
      {
        typeId: 1,
        id: 'water',
        name: 'water',
        weight: 0,
        atomics: {},
        productionInputs: [],
        // `isInputGoodFlag 1` only — a raw input good neither produced on-map nor in-house here.
        classification: { producedOnMap: false, producedInHouse: false, inputGood: true },
        source: src,
      },
      {
        typeId: 5,
        id: 'wood',
        name: 'wood',
        weight: 0,
        atomics: { harvest: 24 },
        productionInputs: [],
        // a raw good gathered from the map that is also a recipe input.
        classification: { producedOnMap: true, producedInHouse: false, inputGood: true },
        source: src,
      },
      {
        typeId: 4,
        id: 'wheat',
        name: 'wheat',
        weight: 0,
        atomics: { harvest: 29, cultivate: 35, plant: 34 },
        productionInputs: [],
        classification: { producedOnMap: true, producedInHouse: false, inputGood: true },
        source: src,
      },
      {
        typeId: 8,
        id: 'coin',
        name: 'coin',
        weight: 0,
        atomics: { produce: 51 },
        // `productionInputGoods 5 4` — one each of wood + wheat (distinct ids, amount 1).
        productionInputs: [
          { goodType: 5, amount: 1 },
          { goodType: 4, amount: 1 },
        ],
        // a produced (in-house) good — the output layer of the goods graph.
        classification: { producedOnMap: false, producedInHouse: true, inputGood: false },
        source: src,
      },
      {
        typeId: 9,
        id: 'potion',
        name: 'potion',
        weight: 0,
        atomics: { produce: 73 },
        // `productionInputGoods 1 1 4 4 5` — a repeated id is the quantity (2× good1, 2× good4, 1× good5),
        // collapsed to a multiset in first-seen order.
        productionInputs: [
          { goodType: 1, amount: 2 },
          { goodType: 4, amount: 2 },
          { goodType: 5, amount: 1 },
        ],
        // no classification flags in the fixture — all default false.
        classification: noClass,
        source: src,
      },
    ]);
  });

  it('throws on a [goodtype] missing its numeric `type`', () => {
    expect(() => extractGoods(parseIniSections('[goodtype]\nname "x"\n'), { file: 'f.ini' })).toThrow(
      /without a numeric `type`/,
    );
  });
});

describe('extractJobs', () => {
  it('collects repeated allow/base/forbid atomic lines into ordered arrays', () => {
    const jobs = extractJobs(parseIniSections(JOBTYPES_INI), { file: 'Data/logic/jobtypes.ini' });
    const src = { file: 'Data/logic/jobtypes.ini', block: 'jobtype', layer: 'base' };
    expect(jobs).toEqual([
      {
        typeId: 3,
        id: 'child_female',
        name: 'child_female',
        allowedAtomics: [8, 15],
        baseAtomics: [1],
        forbiddenAtomics: [99],
        source: src,
      },
      // `&` and spaces slug to single underscores, matching extractLandscape's slug rules.
      {
        typeId: 30,
        id: 'herb_mush_guy',
        name: 'herb & mush guy',
        allowedAtomics: [8],
        baseAtomics: [],
        forbiddenAtomics: [],
        source: src,
      },
    ]);
  });

  it('defaults atomic lists to empty when a job grants none', () => {
    const [job] = extractJobs(parseIniSections('[jobtype]\ntype 2\nname "baby_male"\n'), {
      file: 'f.ini',
    });
    expect(job).toMatchObject({ allowedAtomics: [], baseAtomics: [], forbiddenAtomics: [] });
  });
});

// Mirrors the real grammar of Data/logic/humanjobexperiencetypes.ini: a "general" track (job, no
// good), a good-specific track (job + good), and one carrying baserepeatcounter.
const JOBXP_INI = `<CULTURES_CIF_BEGIN><03FD><0000018D> Don't modify this line!
[humanjobexperiencetype]
type 2
name "collector general"
job 8
experiencefactor 100
[humanjobexperiencetype]
type 3
name "collector wood"
job 8
good 5
experiencefactor 250
[humanjobexperiencetype]
type 46
name "farmer wheat"
job 18
good 4
experiencefactor 100
baserepeatcounter 2
`;

describe('extractJobExperience', () => {
  it('maps [humanjobexperiencetype] records to validated HumanJobExperienceType IR', () => {
    const tracks = extractJobExperience(parseIniSections(JOBXP_INI), {
      file: 'Data/logic/humanjobexperiencetypes.ini',
    });
    const src = {
      file: 'Data/logic/humanjobexperiencetypes.ini',
      block: 'humanjobexperiencetype',
      layer: 'base',
    };
    expect(tracks).toEqual([
      // A "general" track carries no `good` -> goodType omitted, baseRepeatCounter omitted.
      {
        typeId: 2,
        id: 'collector_general',
        name: 'collector general',
        jobType: 8,
        experienceFactor: 100,
        source: src,
      },
      // A good-specific track carries `good`.
      {
        typeId: 3,
        id: 'collector_wood',
        name: 'collector wood',
        jobType: 8,
        goodType: 5,
        experienceFactor: 250,
        source: src,
      },
      // `baserepeatcounter` is captured when present.
      {
        typeId: 46,
        id: 'farmer_wheat',
        name: 'farmer wheat',
        jobType: 18,
        goodType: 4,
        experienceFactor: 100,
        baseRepeatCounter: 2,
        source: src,
      },
    ]);
  });

  it('throws on a record missing the required numeric `type`', () => {
    expect(() =>
      extractJobExperience(parseIniSections('[humanjobexperiencetype]\nname "x"\njob 8\n'), {
        file: 'f.ini',
      }),
    ).toThrow(/without a numeric `type`/);
  });

  it('throws on a record missing the required numeric `job`', () => {
    expect(() =>
      extractJobExperience(parseIniSections('[humanjobexperiencetype]\ntype 1\nname "x"\n'), {
        file: 'f.ini',
      }),
    ).toThrow(/without a numeric `job`/);
  });
});

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
        minRange: 1,
        maxRange: 1,
        damage: { '0': 400, '1': 80 },
        jobType: 5,
        // `goodtype 0` is the natural-weapon sentinel -> no `goodType` field (undefined dropped by toEqual).
        source: src,
      },
      // Same `type 2` but a different tribe — `(tribeType, typeId)` is the composite key. No range
      // pair -> schema range defaults of 1; combat extras (atomicactiontype, sound) ignored.
      {
        typeId: 2,
        id: 'wooden_spear',
        name: 'wooden spear',
        tribeType: 2,
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

describe('extractBuildings', () => {
  it('maps [logichousetype] records to validated BuildingType IR (logictype id, debugname slug)', () => {
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), {
      file: 'DataCnmd/types/houses.ini',
      layer: 'mod',
    });
    const src = { file: 'DataCnmd/types/houses.ini', block: 'logichousetype', layer: 'mod' };
    expect(buildings).toEqual([
      {
        typeId: 1,
        id: 'headquarters',
        kind: 'storage', // logicmaintype 1
        homeSize: 0,
        workers: [{ jobType: 5, count: 3 }],
        stock: [
          { goodType: 1, capacity: 150, initial: 0 },
          { goodType: 5, capacity: 150, initial: 0 },
        ],
        produces: [],
        construction: [], // build cost is overlaid from the graphics table, not the logic table
        source: src,
      },
      {
        typeId: 2,
        id: 'home_level_00',
        kind: 'home', // logicmaintype 2
        homeSize: 1, // logichomesize
        workers: [],
        stock: [{ goodType: 1, capacity: 5, initial: 1 }],
        produces: [],
        construction: [],
        source: src,
      },
      {
        typeId: 13,
        id: 'work_mill_00',
        kind: 'workplace', // logicmaintype 3
        homeSize: 0,
        workers: [{ jobType: 5, count: 1 }],
        stock: [],
        produces: [5, 1], // logicproduction output good ids, in file order
        construction: [],
        source: src,
      },
    ]);
  });

  it('throws on a [logichousetype] missing its numeric `logictype`', () => {
    expect(() =>
      extractBuildings(parseIniSections('[logichousetype]\ndebugname "x"\n'), { file: 'f.ini' }),
    ).toThrow(/without a numeric `logictype`/);
  });

  it('maps an unknown logicmaintype to a stable maintype_<n> kind', () => {
    const buildings = extractBuildings(
      parseIniSections('[logichousetype]\ndebugname "weird"\nlogictype 99\nlogicmaintype 9\n'),
      { file: 'f.ini' },
    );
    expect(buildings[0]?.kind).toBe('maintype_9');
  });
});

// Mirrors DataCnmd/budynki12/houses/houses.ini: a `[GfxHouse]` render record whose `LogicType` and
// `LogicConstructionGoods` lines both lead with a *size index* that pairs them, keyed to a tribe by
// `LogicTribeType`. The cost is a flat good-id list where a repeat encodes quantity. A home spans
// several `LogicType` levels (one typeId each), each with its OWN cost; a free building (HQ) has a
// `LogicType` but no construction goods.
const GFXHOUSES_INI = `[GfxHouse]
EditName "wall"
LogicTribeType 1
LogicType 0 22
LogicConstructionGoods 0 3 3 26
GfxBobId 0 100
[GfxHouse]
EditName "viking home"
LogicTribeType 1
LogicType 0 2
LogicType 1 3
LogicConstructionGoods 0 5 5 2
LogicConstructionGoods 1 24 24
[GfxHouse]
EditName "headquarters"
LogicTribeType 1
LogicType 0 1
GfxBobId 0 200
`;

// The same logic typeIds (2, 3) recur for a HIGHER tribe with a DIFFERENT (cumulative) cost — the
// real data's per-(tribe, typeId) divergence. The lowest-tribeType record must win deterministically.
const GFXHOUSES_OTHER_TRIBE_INI = `[GfxHouse]
EditName "saracen residence"
LogicTribeType 4
LogicType 0 2
LogicType 1 3
LogicConstructionGoods 0 5 5 2 24 24
LogicConstructionGoods 1 5 5 2 24 24 26 26
`;

describe('extractConstructionCosts', () => {
  it('joins per-level LogicConstructionGoods onto typeId, run-length-encoding the good list', () => {
    const costs = extractConstructionCosts(parseIniSections(GFXHOUSES_INI));
    // wall: `3 3 26` -> 2x good 3 + 1x good 26
    expect(costs.get(22)).toEqual([
      { goodType: 3, amount: 2 },
      { goodType: 26, amount: 1 },
    ]);
    // home level 0 (typeId 2) and level 1 (typeId 3) each carry their OWN cost (not cumulative)
    expect(costs.get(2)).toEqual([
      { goodType: 5, amount: 2 },
      { goodType: 2, amount: 1 },
    ]);
    expect(costs.get(3)).toEqual([{ goodType: 24, amount: 2 }]);
    // headquarters has a LogicType but no LogicConstructionGoods -> no entry (free to start)
    expect(costs.has(1)).toBe(false);
  });

  it('collapses a per-(tribe, typeId) cost to the lowest-tribeType record (deterministic reference tribe)', () => {
    // viking (tribe 1) before saracen (tribe 4): the order in the parsed list must not matter.
    const costs = extractConstructionCosts(
      parseIniSections(`${GFXHOUSES_OTHER_TRIBE_INI}\n${GFXHOUSES_INI}`),
    );
    // tribe 1's cost wins for the shared typeIds even though tribe 4 was parsed first.
    expect(costs.get(2)).toEqual([
      { goodType: 5, amount: 2 },
      { goodType: 2, amount: 1 },
    ]);
    expect(costs.get(3)).toEqual([{ goodType: 24, amount: 2 }]);
  });

  it('collapses a typeId that maps to several sizeIdx within one record to the lowest sizeIdx (base stage)', () => {
    // Mirrors the real "viking pottery" (LogicType {1:21, 2:21}) and the multi-stage wonders: one
    // typeId at two sizeIdx, each with its OWN construction line. The lower sizeIdx (the first build
    // stage) must win deterministically regardless of which LogicConstructionGoods line is parsed first.
    const costs = extractConstructionCosts(
      parseIniSections(`[GfxHouse]
EditName "pottery"
LogicTribeType 1
LogicType 1 21
LogicType 2 21
LogicConstructionGoods 2 9 9 9
LogicConstructionGoods 1 3
`),
    );
    // sizeIdx 1 (`3`) wins over sizeIdx 2 (`9 9 9`), even though the size-2 line is parsed first.
    expect(costs.get(21)).toEqual([{ goodType: 3, amount: 1 }]);
  });

  it('returns an empty map for sources with no [GfxHouse] records (the logic-only tables)', () => {
    expect(extractConstructionCosts(parseIniSections(HOUSES_INI)).size).toBe(0);
  });
});

describe('fillBuildingRecipes', () => {
  // The goods table carries the input side: coin (8) <- productionInputGoods 5 4; potion (9) <-
  // productionInputGoods 1 1 4 4 5 (= 2×good1 + 2×good4 + 1×good5). wood (5)/water (1) are raw (no
  // inputs). So a workplace producing coin should get inputs {wood,wheat}, one producing a raw good
  // should get an empty-input recipe (it makes a good with no recipe of its own).
  const GOODS = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
  const src = { file: 'houses.ini', block: 'logichousetype', layer: 'mod' as const };
  const building = (
    typeId: number,
    id: string,
    produces: number[],
    workers: { jobType: number; count: number }[] = [],
  ) => ({
    typeId,
    id,
    kind: 'workplace',
    homeSize: 0,
    workers,
    stock: [],
    produces,
    source: src,
  });
  // A minimal reference tribe binding the produce atomics of coin (8 -> atomic 51) and potion
  // (9 -> atomic 73) for worker job 5, plus the animations those bindings name with their lengths.
  const tribe = (typeId: number, bindings: [number, number, string][]) =>
    TribeType.parse({
      typeId,
      id: `tribe_${typeId}`,
      atomicBindings: bindings.map(([jobType, atomicId, animation]) => ({
        jobType,
        atomicId,
        animation,
      })),
      source: src,
    });
  const anim = (name: string, length: number) =>
    AtomicAnimation.parse({ id: name, name, length, source: src });

  it('joins a workplace output good -> that good`s productionInputs into recipe.inputs', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [8])], GOODS);
    expect(mint?.recipe).toEqual({
      // coin consumes wood (5) + wheat (4), one each — emitted in ascending input-goodType order.
      inputs: [
        { goodType: 4, amount: 1 },
        { goodType: 5, amount: 1 },
      ],
      outputs: [{ goodType: 8, amount: 1 }],
      ticks: 20,
    });
  });

  it('preserves the repeated-id quantity through the join (potion: 2×1, 2×4, 1×5)', () => {
    const [lab] = fillBuildingRecipes([building(14, 'lab', [9])], GOODS);
    expect(lab?.recipe?.inputs).toEqual([
      { goodType: 1, amount: 2 },
      { goodType: 4, amount: 2 },
      { goodType: 5, amount: 1 },
    ]);
    expect(lab?.recipe?.outputs).toEqual([{ goodType: 9, amount: 1 }]);
  });

  it('merges (sums per input goodType) the inputs of several produced goods', () => {
    const [multi] = fillBuildingRecipes([building(15, 'multi', [8, 9])], GOODS);
    // coin needs 5,4; potion needs 1,4,5 -> wood(5)=1+1, wheat(4)=1+2, water(1)=2; two outputs.
    expect(multi?.recipe?.inputs).toEqual([
      { goodType: 1, amount: 2 },
      { goodType: 4, amount: 3 },
      { goodType: 5, amount: 2 },
    ]);
    expect(multi?.recipe?.outputs).toEqual([
      { goodType: 8, amount: 1 },
      { goodType: 9, amount: 1 },
    ]);
  });

  it('gives a producer of a raw good an empty-input recipe (still a producer)', () => {
    const [cutter] = fillBuildingRecipes([building(16, 'cutter', [5])], GOODS);
    expect(cutter?.recipe).toEqual({ inputs: [], outputs: [{ goodType: 5, amount: 1 }], ticks: 20 });
  });

  it('leaves a non-producing building (empty produces) with no recipe', () => {
    const [store] = fillBuildingRecipes([building(1, 'hq', [])], GOODS);
    expect(store?.recipe).toBeUndefined();
  });

  it('does not mutate the input building records', () => {
    const input = building(13, 'mint', [8]);
    fillBuildingRecipes([input], GOODS);
    expect(input).not.toHaveProperty('recipe');
  });

  // Recipe `ticks` resolution: worker jobType + produced good's atomicForProduction -> the reference
  // tribe's setatomic animation -> that animation's length. coin (8) -> atomic 51; potion (9) -> 73.
  it('resolves recipe.ticks from the produce-atomic animation length via the reference tribe', () => {
    const tribes = [tribe(1, [[5, 51, 'coin_produce']])];
    const anims = [anim('coin_produce', 80)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(80);
  });

  it('picks the lowest-typeId tribe as the reference (deterministic, source-order-independent)', () => {
    // Two tribes bind the same (job 5, atomic 51) to different-length animations; tribe 1 wins.
    const tribes = [tribe(3, [[5, 51, 'coin_slow']]), tribe(1, [[5, 51, 'coin_fast']])];
    const anims = [anim('coin_slow', 200), anim('coin_fast', 60)];
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(mint?.recipe?.ticks).toBe(60);
  });

  it('falls back to a later output good when the primary output`s produce-atomic does not resolve', () => {
    // produces [8, 9]: coin (atomic 51) is unbound; potion (atomic 73) resolves to length 120.
    const tribes = [tribe(1, [[5, 73, 'potion_produce']])];
    const anims = [anim('potion_produce', 120)];
    const [lab] = fillBuildingRecipes(
      [building(15, 'multi', [8, 9], [{ jobType: 5, count: 1 }])],
      GOODS,
      tribes,
      anims,
    );
    expect(lab?.recipe?.ticks).toBe(120);
  });

  it('falls back to the default ticks when no produced good`s produce-atomic resolves a length', () => {
    // Worker present, but no tribe binds (job 5, atomic 51), so the chain breaks -> default 20.
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 99, 'unrelated']])],
      [anim('unrelated', 10)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when the building has no worker (no jobType to key the binding)', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8])], // workers: [] -> no jobType
      GOODS,
      [tribe(1, [[5, 51, 'coin_produce']])],
      [anim('coin_produce', 80)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('falls back to the default ticks when tribes/animations are absent (back-compat)', () => {
    const [mint] = fillBuildingRecipes([building(13, 'mint', [8], [{ jobType: 5, count: 1 }])], GOODS);
    expect(mint?.recipe?.ticks).toBe(20);
  });

  it('skips an animation of length 0 (not a real cycle) and falls back', () => {
    const [mint] = fillBuildingRecipes(
      [building(13, 'mint', [8], [{ jobType: 5, count: 1 }])],
      GOODS,
      [tribe(1, [[5, 51, 'coin_zero']])],
      [anim('coin_zero', 0)],
    );
    expect(mint?.recipe?.ticks).toBe(20);
  });
});

describe('extractTribes', () => {
  it('maps `setatomic` triples to (jobType, atomicId, animation) bindings in file order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    expect(tribes).toHaveLength(1);
    expect(tribes[0]).toMatchObject({ typeId: 1, id: 'viking', name: 'viking' });
    // The `//`-comment on the third line is stripped by the parser, so the animation token is clean.
    // A repeated (jobType, atomicId) pair is kept in file order — consumers resolve last-wins.
    expect(tribes[0]?.atomicBindings).toEqual([
      { jobType: 1, atomicId: 8, animation: 'viking_baby_female_sleep' },
      { jobType: 5, atomicId: 22, animation: 'viking_woman_pickup' },
      { jobType: 52, atomicId: 84, animation: 'viking_ship_small_idle_short_a' },
      { jobType: 5, atomicId: 22, animation: 'viking_woman_pickup_alt' },
    ]);
  });

  it('collects interleaved `jobEnables*` edges in exact source order, skipping a malformed line', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The real data interleaves the four kinds within a block, so edges keep verbatim file order
    // (good, house, good, job, vehicle here) — NOT regrouped by kind. The malformed
    // `jobEnablesGood notanint 5` (non-int jobType) is dropped, like a malformed setatomic line.
    expect(tribes[0]?.jobEnables).toEqual([
      { jobType: 5, kind: 'good', targetId: 5 },
      { jobType: 5, kind: 'house', targetId: 2 },
      { jobType: 1, kind: 'good', targetId: 4 },
      { jobType: 5, kind: 'job', targetId: 1 },
      { jobType: 5, kind: 'vehicle', targetId: 3 },
    ]);
  });

  it('collects `{need,train}for{job,good}` requirements with their expType list, in source order', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), {
      file: 'DataCnmd/tribetypes12/tribetypes.ini',
      layer: 'mod',
    });
    // The `need`/`train` prefix + `job`/`good` suffix decompose into the two dimensions; the optional
    // second expType (`needforjob 1 10 6 7`) is captured, a single one (`needforgood 5 15 9`) too,
    // and the synthetic "school" expType (77/57) on `train*` rides through unvalidated. The malformed
    // `needforjob notanint 10 3` (non-int targetId) is dropped, like a malformed jobEnables line.
    expect(tribes[0]?.jobRequirements).toEqual([
      { requirement: 'need', target: 'job', targetId: 1, amount: 10, experienceTypes: [6, 7] },
      { requirement: 'need', target: 'good', targetId: 5, amount: 15, experienceTypes: [9] },
      { requirement: 'train', target: 'job', targetId: 1, amount: 10, experienceTypes: [77] },
      { requirement: 'train', target: 'good', targetId: 4, amount: 5, experienceTypes: [57] },
    ]);
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

describe('extractLandscape', () => {
  it('slugifies multi-word names and defaults walkable/buildable', () => {
    const land = extractLandscape(parseIniSections(LANDSCAPE_INI), {
      file: 'Data/logic/landscapetypes.ini',
      layer: 'base',
    });
    expect(land.map((l) => l.id)).toEqual(['void', 'water', 'tree', 'tree_falling', 'wall']);
    const treeFalling = land.find((l) => l.id === 'tree_falling');
    expect(treeFalling).toMatchObject({ typeId: 5, id: 'tree_falling', walkable: true, buildable: true });
  });

  it('extracts maximumValency and the allowedon* placement flags (1/0 ints -> booleans)', () => {
    const byId = new Map(
      extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' }).map((l) => [l.id, l]),
    );
    // "void" carries the high valency and allowedoneverything; not on land/water.
    expect(byId.get('void')).toMatchObject({
      maxValency: 100,
      allowedOnLand: false,
      allowedOnWater: false,
      allowedOnEverything: true,
    });
    // "water" sits on the land layer with allowedonwater explicitly 0 -> false.
    expect(byId.get('water')).toMatchObject({
      maxValency: 5,
      allowedOnLand: true,
      allowedOnWater: false,
      allowedOnEverything: false,
    });
    // A wall/gate sits on BOTH land and water (allowedonwater 1).
    expect(byId.get('wall')).toMatchObject({ maxValency: 1, allowedOnLand: true, allowedOnWater: true });
  });

  it('defaults maxValency to 0 and the flags to false when the source omits them', () => {
    const [only] = extractLandscape(parseIniSections('[landscapetype]\ntype 9\nname "bare"\n'), {
      file: 'landscapetypes.ini',
    });
    expect(only).toMatchObject({
      typeId: 9,
      maxValency: 0,
      allowedOnLand: false,
      allowedOnWater: false,
      allowedOnEverything: false,
    });
  });
});

// Mirrors the real Data/engine2d/inis/palettes/palettes.ini grammar: [GfxPalette256] records with one
// gfxfile and one-or-more editname aliases, Windows backslash paths, the CIF header/footer marker lines.
const PALETTES_INI = `<CULTURES_CIF_BEGIN><03FD><00000351> Don't modify this line!
[GfxPalette256]
editname "tree01"
gfxfile "data\\Engine2D\\Bin\\palettes\\landscapes\\tree01.pcx"
gfxpreshade 1
[GfxPalette256]
editname "bear01"
editname "deer01"
gfxfile "data\\engine2d\\bin\\palettes\\creatures\\bear01.pcx"
gfxpreshade 1
[GfxPalette256]
editname "nopcx_skipme"
gfxpreshade 1
<CULTURES_CIF_END> Don't modify this line!`;

describe('extractPaletteIndex', () => {
  it('flattens aliases to one normalized .pcx path each and skips records without a gfxfile', () => {
    const aliases = extractPaletteIndex(parseIniSections(PALETTES_INI));
    // Two records contribute (1 + 2 aliases); the gfxfile-less record is dropped.
    expect(aliases).toEqual([
      { name: 'tree01', gfxFile: 'data/engine2d/bin/palettes/landscapes/tree01.pcx' },
      { name: 'bear01', gfxFile: 'data/engine2d/bin/palettes/creatures/bear01.pcx' },
      { name: 'deer01', gfxFile: 'data/engine2d/bin/palettes/creatures/bear01.pcx' },
    ]);
  });

  it('builds a name -> .pcx lookup map where aliases share a file', () => {
    const map = new Map(extractPaletteIndex(parseIniSections(PALETTES_INI)).map((a) => [a.name, a.gfxFile]));
    expect(map.get('bear01')).toBe(map.get('deer01'));
    expect(map.has('nopcx_skipme')).toBe(false);
  });
});

// Mirrors the real Data/engine2d/inis/animals/jobgraphics.ini grammar: [jobgraphics] records with a
// gfxbobmanagerbody (body .bmd + optional shadow .bmd), a gfxpalettebody editname, and logictribe/
// logicjob cross-reference ids. The last two records exercise the skip paths (no body / no palette).
const JOBGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobgraphics]
logictribe 21
logicjob 48
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_Ani_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Ani_Body_00_s.bmd"
gfxpalettebody "BEAR01"
[jobgraphics]
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_NoShadow.bmd"
gfxpalettebody "deer01"
[jobgraphics]
logictribe 9
gfxpalettebody "orphan_no_body"
[jobgraphics]
gfxbobmanagerbody "Data\\Engine2D\\Bin\\Bobs\\CR_NoPalette.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_NoPalette_s.bmd"
`;

describe('extractGraphicsBindings', () => {
  it('binds each [jobgraphics] body .bmd to its palette editname, normalizing paths + lower-casing the name', () => {
    const bindings = extractGraphicsBindings(parseIniSections(JOBGRAPHICS_INI));
    // Records 3 (no body) and 4 (no palette) are dropped; the first two bind. The first record's
    // `BEAR01` is lower-cased to `bear01` — the join key is case-insensitive (real data mixes case).
    expect(bindings).toEqual([
      {
        bmd: 'data/engine2d/bin/bobs/cr_ani_body_00.bmd',
        shadowBmd: 'data/engine2d/bin/bobs/cr_ani_body_00_s.bmd',
        paletteName: 'bear01',
        tribeId: 21,
        jobId: 48,
      },
      {
        bmd: 'data/engine2d/bin/bobs/cr_noshadow.bmd',
        shadowBmd: undefined,
        paletteName: 'deer01',
        tribeId: undefined,
        jobId: undefined,
      },
    ]);
  });

  it('resolves a bound .bmd to a .pcx palette across a case mismatch (BEAR01 -> bear01)', () => {
    // The binding references `BEAR01`; palettes.ini declares `bear01` — the lower-cased join must still
    // hit. This mirrors the real chicken01/Chicken01 + LION01/Lion01 case splits between the two legs.
    const palettes = new Map(
      extractPaletteIndex(parseIniSections(PALETTES_INI)).map((a) => [a.name, a.gfxFile]),
    );
    const [first] = extractGraphicsBindings(parseIniSections(JOBGRAPHICS_INI));
    expect(palettes.get(first?.paletteName ?? '')).toBe('data/engine2d/bin/palettes/creatures/bear01.pcx');
  });
});

// Mirrors the real DataCnmd/types/humanstype/jobgraphics.ini [jobbasegraphics] grammar: an indexed
// body bob (leading int slot + body .bmd + optional shadow), numbered head bobs (slot + head .bmd, no
// shadow), and three optional palette names. Record 1 has body+heads+all palettes; record 2 is
// body-only (no heads, only a random palette, like the real grizzu bears); record 3 has no body bob
// and is skipped.
const JOBBASEGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobbasegraphics]
logictribe 1
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_00.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_01.bmd"
gfxpalettebasebody "Test_Human_00"
gfxpalettebasehead "test_human_00"
gfxpaletterandom "Vik_Man_Base"
[jobbasegraphics]
logictribe 3
logicjob 32
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_72.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_72_s.bmd"
gfxpaletterandom "grizzu"
[jobbasegraphics]
logictribe 9
gfxpalettebasebody "orphan_no_body"
`;

describe('extractJobBaseGraphics', () => {
  it('parses indexed body/head bobs (path on values[1]) + the three split palettes, lower-casing palette names', () => {
    const bindings = extractJobBaseGraphics(parseIniSections(JOBBASEGRAPHICS_INI));
    // Record 3 (no body bob) is skipped; records 1 and 2 bind.
    expect(bindings).toEqual([
      {
        tribeId: 1,
        jobId: 6,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_00_s.bmd',
          },
        ],
        head: [
          { index: 0, bmd: 'data/engine2d/bin/bobs/cr_hum_head_00.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/engine2d/bin/bobs/cr_hum_head_01.bmd', shadowBmd: undefined },
        ],
        // `Test_Human_00` lower-cases to join case-insensitively onto the palette index.
        bodyPalette: 'test_human_00',
        headPalette: 'test_human_00',
        randomPalette: 'vik_man_base',
      },
      {
        tribeId: 3,
        jobId: 32,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_72.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_72_s.bmd',
          },
        ],
        // Body-only: no head bobs, only a random-tint palette (like the real grizzu bears).
        head: [],
        bodyPalette: undefined,
        headPalette: undefined,
        randomPalette: 'grizzu',
      },
    ]);
  });

  it('resolves a body palette across a case mismatch via the shared palettes index', () => {
    // The flat [jobgraphics] extractor stays untouched by the [jobbasegraphics] sections — the two
    // skins coexist in one file in the real mod, each guarding on its own section name.
    expect(extractGraphicsBindings(parseIniSections(JOBBASEGRAPHICS_INI))).toEqual([]);
    expect(extractJobBaseGraphics(parseIniSections(JOBGRAPHICS_INI))).toEqual([]);
  });
});

// Mirrors the real [jobbasegraphics]/[jobchangegraphics] coexistence in one file: a base-appearance
// record (job 6) and an equipment-skin record (job 27, swapping in a different head bob set over the
// shared body) using the *same* grammar, differing only in section name.
const JOBCHANGEGRAPHICS_INI = `<CULTURES_CIF_BEGIN><03FD><000000F1> Don't modify this line!
[jobbasegraphics]
logictribe 1
logicjob 6
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_00.bmd"
gfxpaletterandom "Vik_Man_Base"
[jobchangegraphics]
logictribe 1
logicjob 27
gfxbobmanagerbody 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00.bmd" "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Body_00_s.bmd"
gfxbobmanagerhead 0 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_80.bmd"
gfxbobmanagerhead 1 "Data\\Engine2D\\Bin\\Bobs\\CR_Hum_Head_81.bmd"
gfxpalettebasehead "Test_Human_00"
gfxpaletterandom "Vik_Man_ChangeJob"
`;

describe('extractJobChangeGraphics', () => {
  it('parses [jobchangegraphics] equipment-skin records with the same grammar as the base layer', () => {
    const bindings = extractJobChangeGraphics(parseIniSections(JOBCHANGEGRAPHICS_INI));
    // Only the [jobchangegraphics] record is picked up; the [jobbasegraphics] one is ignored here.
    expect(bindings).toEqual([
      {
        tribeId: 1,
        jobId: 27,
        body: [
          {
            index: 0,
            bmd: 'data/engine2d/bin/bobs/cr_hum_body_00.bmd',
            shadowBmd: 'data/engine2d/bin/bobs/cr_hum_body_00_s.bmd',
          },
        ],
        head: [
          { index: 0, bmd: 'data/engine2d/bin/bobs/cr_hum_head_80.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/engine2d/bin/bobs/cr_hum_head_81.bmd', shadowBmd: undefined },
        ],
        bodyPalette: undefined,
        headPalette: 'test_human_00',
        randomPalette: 'vik_man_changejob',
      },
    ]);
  });

  it('is independent of the base layer: each extractor sees only its own section name', () => {
    // The two skins coexist in one file; the base extractor must not bleed into the change records
    // and vice versa, so a file is never double-counted when both run over it.
    expect(extractJobBaseGraphics(parseIniSections(JOBCHANGEGRAPHICS_INI))).toEqual([
      expect.objectContaining({ jobId: 6 }),
    ]);
    expect(extractJobChangeGraphics(parseIniSections(JOBBASEGRAPHICS_INI))).toEqual([]);
  });
});

describe('extractMapInfo', () => {
  // Mirrors a real map.cif logic header (decoded by cifLinesToSections): a `logiccontrol` section with
  // `mapsize`/`mapguid`, then `misc_maptype`/`misc_mapname` metadata. A campaign map carries
  // `mapcampaignid`; a skirmish map omits it. The 16 guid bytes are a sentinel sequence.
  const guidBytes = '163 83 223 158 154 162 179 64 171 63 228 184 223 25 120 150';
  const campaignMapLines: CifLine[] = [
    { level: 1, text: 'logiccontrol' },
    { level: 2, text: 'version 1' },
    { level: 2, text: 'mapsize 142 146' },
    { level: 2, text: `mapguid ${guidBytes}` },
    { level: 1, text: 'logiccontrolend' },
    { level: 1, text: 'MissionData' },
    { level: 2, text: 'goal "True"' },
    { level: 1, text: 'misc_maptype' },
    { level: 2, text: 'maptype 1' },
    { level: 2, text: 'mapcampaignid 100 2' },
    { level: 1, text: 'misc_mapname' },
    { level: 2, text: 'mapnamestringid 99' },
    { level: 2, text: 'mapdescriptionstringid 98' },
  ];

  it('extracts the declarative logic-header metadata into a validated MapInfo', () => {
    const info = extractMapInfo(cifLinesToSections(campaignMapLines), 'tutorial_002', {
      file: 'tutorial_002/map.cif',
    });
    expect(info).toMatchObject({
      id: 'tutorial_002',
      width: 142,
      height: 146,
      mapType: 1,
      campaign: { campaignId: 100, missionId: 2 },
      nameStringId: 99,
      descriptionStringId: 98,
    });
    expect(info.guid).toEqual([163, 83, 223, 158, 154, 162, 179, 64, 171, 63, 228, 184, 223, 25, 120, 150]);
    // The scripting payload (MissionData) is deliberately NOT folded into the metadata IR.
    expect(Object.keys(info)).not.toContain('missions');
  });

  it('omits mapcampaignid on a skirmish map (the optional field is simply absent)', () => {
    const skirmish: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 250 250' },
      { level: 2, text: `mapguid ${guidBytes}` },
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: 'maptype 4' },
    ];
    const info = extractMapInfo(cifLinesToSections(skirmish), 'forteca', { file: 'forteca/map.cif' });
    expect(info.mapType).toBe(4);
    expect(info.campaign).toBeUndefined();
    expect(info.nameStringId).toBeUndefined();
  });

  it('throws when mapsize is missing or malformed (not a decodable map)', () => {
    const noSize: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: `mapguid ${guidBytes}` },
    ];
    expect(() => extractMapInfo(cifLinesToSections(noSize), 'x', { file: 'x/map.cif' })).toThrow(/mapsize/);
  });

  it('throws when mapguid is not exactly 16 bytes', () => {
    const shortGuid: CifLine[] = [
      { level: 1, text: 'logiccontrol' },
      { level: 2, text: 'mapsize 100 100' },
      { level: 2, text: 'mapguid 1 2 3' },
    ];
    expect(() => extractMapInfo(cifLinesToSections(shortGuid), 'x', { file: 'x/map.cif' })).toThrow(
      /mapguid/,
    );
  });

  it('throws when the logiccontrol section is absent entirely', () => {
    const noLogic: CifLine[] = [
      { level: 1, text: 'misc_maptype' },
      { level: 2, text: 'maptype 4' },
    ];
    expect(() => extractMapInfo(cifLinesToSections(noLogic), 'x', { file: 'x/map.cif' })).toThrow(
      /logiccontrol/,
    );
  });
});

describe('IR integration', () => {
  it('extracted goods + jobs + buildings + weapons + tribes + landscape + animations assemble into a valid ContentSet', () => {
    const goods = extractGoods(parseIniSections(GOODTYPES_INI), { file: 'goodtypes.ini' });
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), { file: 'houses.ini', layer: 'mod' });
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    const landscape = extractLandscape(parseIniSections(LANDSCAPE_INI), { file: 'landscapetypes.ini' });
    const atomicAnimations = extractAtomicAnimations(parseIniSections(ATOMICANIMATIONS_INI), {
      file: 'atomicanimations.ini',
      layer: 'mod',
    });
    const weapons = extractWeapons(parseIniSections(WEAPONTYPES_INI), {
      file: 'weapons.ini',
      layer: 'mod',
    });
    // The tribe's `jobEnablesVehicle 5 3` edge keys into the vehicle table, so it must define
    // vehicle 3 (ship small) for the cross-ref to resolve.
    const vehicles = extractVehicles(parseIniSections(VEHICLETYPES_INI), { file: 'vehicletypes.ini' });
    // The tribe binds jobTypes 1/5/52 and the weapons wield jobTypes 5/32, so the job set must
    // define them all (cross-ref resolvability — validateCrossReferences checks weapon.jobType too).
    const jobs = [
      ...extractJobs(parseIniSections(JOBTYPES_INI), { file: 'jobtypes.ini' }),
      { typeId: 1, id: 'job_1' },
      { typeId: 5, id: 'job_5' },
      { typeId: 32, id: 'job_32' },
      { typeId: 52, id: 'job_52' },
    ];
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs,
        buildings,
        weapons,
        vehicles,
        landscape,
        tribes,
        atomicAnimations,
      }),
    ).not.toThrow();
  });

  it('rejects a building that produces an unknown goodType (cross-reference)', () => {
    const buildings = extractBuildings(parseIniSections(HOUSES_INI), { file: 'houses.ini', layer: 'mod' });
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [], // no goods defined -> the workplace's logicproduction ids dangle
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings,
      }),
    ).toThrow(/produces unknown goodType/);
  });

  it('rejects a good whose productionInputGoods names an unknown goodType (cross-reference)', () => {
    // coin consumes wood (5) + gold (7), but only wood is defined -> gold dangles.
    const goods = extractGoods(
      parseIniSections(
        '[goodtype]\nname "wood"\ntype 5\n[goodtype]\nname "coin"\ntype 8\nproductionInputGoods 5 7\n',
      ),
      { file: 'goodtypes.ini' },
    );
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods,
        jobs: [],
        buildings: [],
      }),
    ).toThrow(/good "coin" consumes unknown input goodType 7/);
  });

  it('rejects a tribe whose setatomic binds an unknown jobType (cross-reference)', () => {
    const tribes = extractTribes(parseIniSections(TRIBETYPES_INI), { file: 'tribetypes.ini', layer: 'mod' });
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [], // no jobs defined -> the tribe's jobType bindings dangle
        buildings: [],
        tribes,
      }),
    ).toThrow(/unknown jobType/);
  });

  it('rejects a tribe whose jobEnables edge targets an unknown good (cross-reference)', () => {
    // job 5 exists, but the good it enables (99) is not defined -> the tech-graph edge dangles.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 5, kind: 'good', targetId: 99 }] }],
      }),
    ).toThrow(/enables unknown goodType 99/);
  });

  it('rejects a tribe whose jobEnables edge targets an unknown vehicle (cross-reference)', () => {
    // The vehicle kind keys into the `vehicletypes` `type` (`logicvehicletype`) namespace, now
    // extracted as `VehicleType.typeId` — so a dangling vehicle edge (targetId 3, no vehicle 3) is
    // caught like any other dangling tech-graph edge. (Buildings are a DIFFERENT namespace, so an
    // empty buildings list doesn't mask it.)
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        vehicles: [{ typeId: 1, id: 'handcart' }],
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 5, kind: 'vehicle', targetId: 3 }] }],
      }),
    ).toThrow(/enables unknown vehicleType 3/);
    // With vehicle 3 defined, the same edge resolves — mirrors the real data (jobEnablesVehicle ids
    // 1..5 are a subset of the vehicle typeIds 1..6).
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [{ typeId: 5, id: 'job_5' }],
        buildings: [],
        vehicles: [{ typeId: 3, id: 'oxcart' }],
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 5, kind: 'vehicle', targetId: 3 }] }],
      }),
    ).not.toThrow();
  });

  it('rejects an experience track whose job (or good) is unknown (cross-reference)', () => {
    const jobExperience = extractJobExperience(parseIniSections(JOBXP_INI), {
      file: 'humanjobexperiencetypes.ini',
    });
    // "collector wood" (job 8, good 5): defining job 8 + job 18 but no goods -> the good 5 dangles.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [],
        jobs: [
          { typeId: 8, id: 'job_8' },
          { typeId: 18, id: 'job_18' },
        ],
        buildings: [],
        jobExperience,
      }),
    ).toThrow(/jobExperience "collector_wood" references unknown goodType 5/);
    // With the goods defined but the job missing, the jobType dangles instead.
    expect(() =>
      parseContentSet({
        manifest: { version: 1, generatedFrom: { game: 'Cultures 8th Wonder' } },
        goods: [
          { typeId: 4, id: 'good_4' },
          { typeId: 5, id: 'good_5' },
        ],
        jobs: [], // no jobs -> every track's jobType dangles
        buildings: [],
        jobExperience,
      }),
    ).toThrow(/jobExperience "collector_general" references unknown jobType 8/);
  });
});
