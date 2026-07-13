/**
 * Shared synthetic `.ini` source fixtures. No copyrighted fixtures are committed: these snippets are
 * synthetic but mirror the real grammar of the game's rule files (quoted names, multi-value lines,
 * repeated keys, the `<CULTURES_CIF_BEGIN>` header). They are consumed by several per-module specs and
 * the IR-integration spec, so they live in one place.
 */

export const GOODTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><00000247> Don't modify this line!
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
isBioLandscapeFlag 1
landscapeToHarvest 4
landscapeToPickup 6
landscapeToStore 7
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
export const JOBTYPES_INI = `<CULTURES_CIF_BEGIN><03FD><0000027A> Don't modify this line!
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
export const TRIBETYPES_INI = `[tribetype]
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
export const ATOMICANIMATIONS_INI = `[atomicanimation]
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
// `type`, the `mainType` (coarse weapon class) + `weight` (encumbrance) pair, the
// `minimumrange`/`maximumrange` pair, repeated `damagevalue <armorClass> <value>` lines, a `jobtype`,
// and combat extras the schema doesn't carry (`atomicactiontype`, `soundtype_Hit`) that are ignored.
// `mainType` is the file's exact camelCase key (a lowercased `maintype` would silently vanish). Both
// weapons share `type 2` across different tribes — the real data's `(tribetype, type)` composite key
// (type alone is not unique). The fist is `mainType 1, weight 0` and a melee weapon (no
// `munitiontype`/`damagetype` -> the schema omits both, the ranged + damage-class markers absent); the
// bow `mainType 6, weight 1` exercises non-zero capture and carries `munitiontype 1` (the all-lowercase
// ammo-class key — bow ammo / arrow; value 1 is NOT good id 1 "water", a class enum), `speed 8` (the
// ranged projectile travel speed, another all-lowercase key — melee weapons omit it), plus `damagetype 2`
// (another all-lowercase class key — the siege/damage-class marker; value 2 is NOT good id 2 "mud").
// The bow also omits the range pair to exercise the schema's range defaults of 1. The fist's `goodtype 0` is the
// natural-weapon sentinel (-> undefined); the bow's `goodtype 5` is a real good (-> captured; 5 also
// exists in the IR-integration goods fixture below so the cross-ref resolves there).
export const WEAPONTYPES_INI = `// new
[weapontype]
tribetype 1
type 2
mainType 1
name "woman fist"
goodtype 0
weight 0
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
mainType 6
name "short bow"
goodtype 5
weight 1
munitiontype 1
speed 8
damagetype 2
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
export const VEHICLETYPES_INI = `<CULTURES_CIF_BEGIN><03FD><000001A0> Don't modify this line!
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

// Mirrors DataCnmd/types/houses.ini: a `[logichousetype]` keys its id on `logictype` (not `type`) and
// its name on `debugname`. A storage HQ (maintype 1), a home with `logichomesize` (maintype 2), and a
// workplace with workers + `logicproduction` outputs (maintype 3). Stock/worker/production ids here
// reference goods 1/5 and job 5, which the IR-integration test defines so the cross-refs resolve.
export const HOUSES_INI = `[logichousetype]
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

export const LANDSCAPE_INI = `<CULTURES_CIF_BEGIN><03FD><000002BF> Don't modify this line!
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
type 6
name "trunk"
allowedonland 1
maximumValency 5
transition 3 6 2 -1 5
[landscapetype]
type 7
name "wood"
allowedonland 1
maximumValency 5
[landscapetype]
type 49
name "wall"
allowedonland 1
allowedonwater 1
maximumValency 1
`;

// Mirrors the real grammar of Data/logic/humanjobexperiencetypes.ini: a "general" track (job, no
// good), a good-specific track (job + good), and one carrying baserepeatcounter.
export const JOBXP_INI = `<CULTURES_CIF_BEGIN><03FD><0000018D> Don't modify this line!
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
