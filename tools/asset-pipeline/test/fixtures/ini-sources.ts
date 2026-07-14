/**
 * Shared synthetic `.ini` source fixtures. No copyrighted fixtures are committed: these snippets are
 * synthetic but mirror the real grammar of the game's rule files (quoted names, multi-value lines,
 * repeated keys, the `<CULTURES_CIF_BEGIN>` header). They are consumed by several per-module specs and
 * the IR-integration spec, so they live in one place.
 */

// Mirrors Data/logic/goodtypes.ini: an invented five-good universe exercising the classification
// flags and gathering/production shapes. `<CULTURES_CIF_BEGIN><03FD><hex>` header hex is made up.
// glimmerdew is a raw input (landscape lane, no gather chain); thornreed is a bio map good with a full
// harvest/pickup/store chain; palegrain is a cultivated map good (atomics only, no landscape line);
// guildmark is produced in-house from two inputs; dusktonic is produced with a repeated-id input list
// (a repeat encodes quantity) and no classification flags.
export const GOODTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000180> Don't modify this line!
[goodtype]
name "glimmerdew"
type 20
landscapetype 12
isInputGoodFlag 1

[goodtype]
name "thornreed"
type 22
landscapetype 16
isInputGoodFlag 1
isProducedOnMapFlag 1
isBioLandscapeFlag 1
landscapeToHarvest 13
landscapeToPickup 15
landscapeToStore 16
atomicForHarvesting 60

[goodtype]
name "palegrain"
type 24
isInputGoodFlag 1
isProducedOnMapFlag 1
atomicForHarvesting 62
atomicForCultivating 63
atomicForPlanting 64

[goodtype]
name "guildmark"
type 27
isProducedInHouseFlag 1
productionInputGoods 22 24
atomicForProduction 70

[goodtype]
name "dusktonic"
type 31
productionInputGoods 20 20 24 24 22
atomicForProduction 75
`;

// Mirrors Data/logic/jobtypes.ini: repeated `allowatomic`, a single `baseatomics`, and a
// `forbidatomic` deny line. The second job carries a `&`/space name to exercise slugging.
export const JOBTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><000001C0> Don't modify this line!
[jobtype]
type 7
name "nestward"
baseatomics 3
allowatomic 12
allowatomic 19
forbidatomic 88
canBeTrainedFlag 0
[jobtype]
type 40
name "reed & moss picker"
allowatomic 12
`;

// Mirrors DataCnmd/tribetypes12/tribetypes.ini: `setatomic <job> <atomic> "anim"`, incl. a line
// with a trailing `//`-comment (the real file has these on a few ship atomics).
export const TRIBETYPES_INI = `[tribetype]
type 4
name "fenling"
setatomic 50 61 "fen_broodling_rest"
setatomic 51 65 "fen_forager_lift"
setatomic 55 90 "fen_barge_drift" // "fen_barge_moor"
setatomic 51 65 "fen_forager_lift_b"
jobEnablesGood 51 22
jobEnablesHouse 51 31
jobEnablesGood 50 24
jobEnablesJob 51 50
jobEnablesVehicle 51 37
jobEnablesGood notanint 22
needforjob 50 8 6 7
needforgood 22 12 9
trainforjob 50 8 71
trainforgood 24 6 54
needforjob notanint 8 3
`;

// Mirrors DataCnmd/atomicanimations12/atomicanimations.ini: `[atomicanimation]` records with a
// quoted `name`, scalar `length`/`interruptable`/`startdirection`, and timed `event`/`eventx` lines
// (3-field = no value, 4-field = signed value). The first record exercises every field; the others
// exercise defaults (no length/interruptable) and the eat-yield shape.
export const ATOMICANIMATIONS_INI = `[atomicanimation]
name "fen_forager_lift"
length 18
interruptable 1
startdirection 4
event 14 9 0
eventx 16 20 -80
event 17 12

[atomicanimation]
name "fen_broodling_feed"
length 44
event 28 3 +3600

[atomicanimation]
name "fen_elder_idle"
`;

// Mirrors DataCnmd/types/weapons.ini: each `[weapontype]` has a `tribetype` + a quoted `name`, a
// `type`, the `mainType` (coarse weapon class) + `weight` (encumbrance) pair, the
// `minimumrange`/`maximumrange` pair, repeated `damagevalue <armorClass> <value>` lines, a `jobtype`,
// and combat extras the schema doesn't carry (`atomicactiontype`, `soundtype_Hit`) that are ignored.
// `mainType` is the file's exact camelCase key (a lowercased `maintype` would silently vanish). Both
// weapons share `type 4` across different tribes — the real data's `(tribetype, type)` composite key
// (type alone is not unique). The claw is `mainType 1, weight 0` and a melee weapon (no
// `munitiontype`/`damagetype` -> the schema omits both, the ranged + damage-class markers absent); the
// sling `mainType 6, weight 1` exercises non-zero capture and carries `munitiontype 3` (the all-lowercase
// ammo-class key — a class enum, NOT good id 3), `speed 6` (the ranged projectile travel speed, another
// all-lowercase key — melee weapons omit it), plus `damagetype 4` (another all-lowercase class key — the
// siege/damage-class marker, NOT good id 4). The sling also omits the range pair to exercise the schema's
// range defaults of 1. The claw's `goodtype 0` is the natural-weapon sentinel (-> undefined); the sling's
// `goodtype 22` is a real good (-> captured; 22 also exists in the IR-integration goods fixture below so
// the cross-ref resolves there).
export const WEAPONTYPES_INI = `// two-weapon composite-key sample
[weapontype]
tribetype 1
type 4
mainType 1
name "bare claw"
goodtype 0
weight 0
minimumrange 1
maximumrange 1
damagevalue 0 360
damagevalue 1 70
jobtype 51
atomicactiontype 77
soundtype_Hit 0 88
[weapontype]
tribetype 2
type 4
mainType 6
name "reed sling"
goodtype 22
weight 1
munitiontype 3
speed 6
damagetype 4
damagevalue 0 2100
jobtype 53
`;

// Mirrors Data/logic/vehicletypes.ini (plain `.ini`, the `<CULTURES_CIF_BEGIN>` header line is not a
// `[section]` so the parser ignores it like goodtypes/landscapetypes): each `[vehicletype]` carries a
// numeric `type`, a quoted `name`, `logicsize`, `stockslots` (the carry capacity), `passengerslots`,
// and the repeated `logicgood N` cargo allow-list (now carried as `cargoGoods`); the `logicpassenger`/
// `debug*` extras the schema doesn't carry are ignored. The sledge (12 slots, no passengers, land
// size 0, two `logicgood`) and the barge (46 slots, 17 passengers, sea size 2, no `logicgood`)
// bracket the range. The third omits the slot/size lines to exercise the schema defaults.
export const VEHICLETYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000150> Don't modify this line!
[vehicletype]
type 35
name "mud sledge"
logicsize 0
stockslots 12
logicgood 25
logicgood 21
passengerslots 0
debugcolor 0 90 80
[vehicletype]
type 37
name "reed barge"
logicsize 2
stockslots 46
passengerslots 17
logicpassenger 25
[vehicletype]
type 39
name "siege ram"
`;

// Mirrors DataCnmd/types/houses.ini: a `[logichousetype]` keys its id on `logictype` (not `type`) and
// its name on `debugname`. A storage warden hall (maintype 1), a home with `logichomesize`
// (maintype 2), and a workplace with workers + `logicproduction` outputs (maintype 3). Stock/worker/
// production ids here reference goods 20/22 and job 51, which the IR-integration test defines so the
// cross-refs resolve.
export const HOUSES_INI = `[logichousetype]
debugname "wardenhall"
logictype 30
logicmaintype 1
logicworker 51 3
logicstock 20 90 0
logicstock 22 90 0
debugcolor 0 0 80
logicCanEnableDefenceMode 1

[logichousetype]
debugname "burrow nest 00"
logictype 31
logicmaintype 2
logichomesize 1
logicstock 20 4 1

[logichousetype]
debugname "grind lodge 00"
logictype 44
logicmaintype 3
logicworker 51 1
logicproduction 22
logicproduction 20
`;

export const LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><00000210> Don't modify this line!
[landscapetype]
type 10
name "hollow"
allowedoneverything 1
maximumValency 90
debugcolor 120 120 120
[landscapetype]
type 12
name "brine"
allowedonland 1
allowedonwater 0
maximumValency 4
[landscapetype]
type 13
name "bramble"
allowedonland 1
maximumValency 3
transition 16 13 3 1 0
transition 21 14 3 0 0
debugcolor 4 120 8
[landscapetype]
type 14
name "bramble fall"
allowedonland 1
maximumValency 3
[landscapetype]
type 15
name "snag"
allowedonland 1
maximumValency 3
transition 12 15 3 -1 14
[landscapetype]
type 16
name "reedpile"
allowedonland 1
maximumValency 3
[landscapetype]
type 58
name "wardline"
allowedonland 1
allowedonwater 1
maximumValency 2
`;

// Mirrors the real grammar of Data/logic/humanjobexperiencetypes.ini: a "general" track (job, no
// good), a good-specific track (job + good), and one carrying baserepeatcounter.
export const JOBXP_INI = `<CULTURES_CIF_BEGIN><03FD><00000120> Don't modify this line!
[humanjobexperiencetype]
type 5
name "gatherer basic"
job 33
experiencefactor 110
[humanjobexperiencetype]
type 6
name "gatherer reed"
job 33
good 22
experiencefactor 260
[humanjobexperiencetype]
type 47
name "tiller grain"
job 34
good 24
experiencefactor 115
baserepeatcounter 3
`;
