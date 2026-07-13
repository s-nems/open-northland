/**
 * Atomic animations and the combat/mobile actor types: weapons, armor, vehicles, and animals.
 */
import { AnimalType, ArmorType, AtomicAnimation, VehicleType, WeaponType } from '@open-northland/data';
import {
  findProps,
  getInt,
  getIntList,
  getStr,
  makeSource,
  type RuleSection,
  requireTypeId,
  type SourceRef,
  slug,
} from '../grammar.js';

/**
 * Extracts `[atomicanimation]` sections into validated {@link AtomicAnimation} IR — the timing/effect
 * layer the atomic vocabulary points at. Each section is keyed by `name` (the join target of a tribe's
 * `setatomic` binding); `length`/`interruptable`/`startdirection` are scalars, and `event`/`eventx`
 * lines become ordered {@link AtomicEvent}s carrying their raw `(at, type, value?)` numbers — the event
 * vocabulary is undocumented and captured faithfully, not interpreted. Throws on a section without a
 * `name` (it would be unreferenceable), matching {@link extractGoods}'s throw-on-malformed stance.
 */
export function extractAtomicAnimations(sections: readonly RuleSection[], src: SourceRef): AtomicAnimation[] {
  const animations: AtomicAnimation[] = [];
  for (const sec of sections) {
    if (sec.name !== 'atomicanimation') continue;
    const name = getStr(sec, 'name');
    if (name === undefined || name.trim() === '') {
      throw new Error(`ini: [atomicanimation] without a \`name\` in ${src.file}`);
    }
    const events: { at: number; type: number; value?: number; extended: boolean }[] = [];
    for (const p of sec.props) {
      if (p.key !== 'event' && p.key !== 'eventx') continue;
      const at = Number.parseInt(p.values[0] ?? '', 10);
      const type = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(at) || Number.isNaN(type)) continue;
      const event: { at: number; type: number; value?: number; extended: boolean } = {
        at,
        type,
        extended: p.key === 'eventx',
      };
      const rawValue = p.values[2];
      if (rawValue !== undefined) {
        const value = Number.parseInt(rawValue, 10);
        if (!Number.isNaN(value)) event.value = value;
      }
      events.push(event);
    }
    animations.push(
      AtomicAnimation.parse({
        id: slug(name),
        name,
        length: getInt(sec, 'length'),
        interruptible: getInt(sec, 'interruptable') === 1,
        startDirection: getInt(sec, 'startdirection'),
        events,
        source: makeSource(src, 'atomicanimation'),
      }),
    );
  }
  return animations;
}

/**
 * Extracts `[weapontype]` sections into validated {@link WeaponType} IR. The mod ships a readable
 * `DataCnmd/types/weapons.ini` (the base game's `Data/logic/weapontypes.cif` is the encrypted twin),
 * so this prefers that `.ini` per AGENTS.md golden rule #4.
 *
 * Each `damagevalue <armorClass> <value>` line becomes one entry in the role-keyed `damage` record
 * (the armor class is the string key, matching the schema's `record<string,number>` shape and the
 * original `damageValue[targetArmorClass]` indexing). `minimumrange`/`maximumrange` map to
 * `minRange`/`maxRange`; `jobtype` is the wielding job (cross-checked against the job table by
 * `validateCrossReferences`). `goodtype` is the good that IS the weapon (the weapon-side twin of an
 * armor's `goodtype`), cross-checked against the good table — captured as `undefined` when the source
 * value is **0** (the natural-weapon sentinel: a fist/claw is backed by no craftable good, just as
 * armor class 0 / a weapon's `damage["0"]` mean "unarmored"; good ids start at 1, so a literal 0 would
 * dangle). `tribetype` is captured because a weapon's `type` id is **not**
 * globally unique — the original keys a weapon by `(tribetype, type)`, so the same id recurs once
 * per tribe (e.g. `type 2` = "fist" for every tribe); see {@link WeaponType}. `mainType` (the coarse
 * weapon class) and `weight` (encumbrance) are captured as the weapon-side twins of an armor's
 * `mainType`/`weight` — note `mainType` is the file's exact camelCase key (a lowercased `maintype`
 * would silently vanish; see AGENTS.md). `munitiontype` (all-lowercase in the source, unlike
 * `mainType`) is the ammunition class a *ranged* weapon fires (1 = bow ammo, 2 = catapult projectile;
 * only bows/catapults carry it — melee weapons omit it → `undefined`), captured as a plain id (it is
 * a class enum, not a cross-ref — `munitiontype` exists in no other table and 1/2 are not good ids).
 * `damagetype` (all-lowercase like `munitiontype`) is the damage **class** a weapon deals — a
 * siege/area marker carried only by the catapults (value `2`); absent on every other weapon, so it's
 * `undefined` there and, like `munitiontype`, captured as a plain id (a class enum in no other table,
 * `2` is not a good id). `speed` (all-lowercase like `munitiontype`) is the ranged projectile's travel
 * speed — carried only by the bow/catapult rows (absent → `undefined` on melee weapons, its
 * `munitiontype` twin), captured as a plain magnitude (the unit is unreadable — the ranged drive maps
 * it via a calibration constant, see the schema). The remaining combat extras (`soundtype_*`,
 * `createsmoke`) are not in the {@link WeaponType} schema yet and are intentionally skipped here — they
 * belong with the Phase-4 CombatSystem, not this type-table slice.
 * Throws on a section missing the required numeric `type` (matches {@link extractGoods}'s
 * throw-on-malformed stance).
 */
export function extractWeapons(sections: readonly RuleSection[], src: SourceRef): WeaponType[] {
  const weapons: WeaponType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'weapontype') continue;
    const typeId = requireTypeId(sec, 'weapontype', src);
    const name = getStr(sec, 'name');
    const damage: Record<string, number> = {};
    for (const p of findProps(sec, 'damagevalue')) {
      const armorClass = Number.parseInt(p.values[0] ?? '', 10);
      const value = Number.parseInt(p.values[1] ?? '', 10);
      if (Number.isNaN(armorClass) || Number.isNaN(value)) continue;
      damage[String(armorClass)] = value;
    }
    // `goodtype 0` is the natural-weapon sentinel (fist/claw — no craftable good); good ids start at
    // 1, so drop a 0 to `undefined` rather than let it dangle in the cross-ref (the armor class-0 /
    // damage["0"] = "unarmored" pattern, one axis over).
    const goodTypeRaw = getInt(sec, 'goodtype');
    weapons.push(
      WeaponType.parse({
        typeId,
        id: name ? slug(name) : `weapon_${typeId}`,
        name,
        tribeType: getInt(sec, 'tribetype'),
        mainType: getInt(sec, 'mainType'),
        weight: getInt(sec, 'weight'),
        // `munitiontype` is all-lowercase in the source (unlike `mainType`) — the ammo class a ranged
        // weapon fires (bow/catapult); absent on melee weapons, so it doubles as the "is ranged" marker.
        munitionType: getInt(sec, 'munitiontype'),
        // `speed` (all-lowercase) is the ranged projectile's travel speed (bow 8, catapult 3); like
        // `munitiontype` it is carried only by ranged rows and absent on melee weapons → undefined.
        speed: getInt(sec, 'speed'),
        // `damagetype` is all-lowercase too — the damage class (siege marker, catapult-only, value 2);
        // absent on every other weapon → undefined. A class enum, not a cross-ref (no other table).
        damageType: getInt(sec, 'damagetype'),
        minRange: getInt(sec, 'minimumrange'),
        maxRange: getInt(sec, 'maximumrange'),
        damage,
        jobType: getInt(sec, 'jobtype'),
        goodType: goodTypeRaw === 0 ? undefined : goodTypeRaw,
        source: makeSource(src, 'weapontype'),
      }),
    );
  }
  return weapons;
}

/**
 * Extracts `[armortype]` sections (base `Data/logic/armortypes.ini` — plain `.ini` despite the
 * `<CULTURES_CIF_BEGIN>` header line, which the parser ignores like `goodtypes`/`vehicletypes`; the
 * mod ships no readable twin) into validated {@link ArmorType} IR. An armor's `type` is the **armor
 * class** a {@link WeaponType.damage} record keys against (`damagevalue <armorClass> <value>`), so
 * this table makes those keys resolvable — the prerequisite the later CombatSystem read side joins on
 * (a weapon's damage vs. a target's armor `blockingValue`). Captured per record: `mainType`,
 * `goodType` (the good that IS the armor — cross-checked against the good table), `materialType`,
 * `weight`, `blockingValue`. Throws on a section missing the required numeric `type` (matches
 * {@link extractWeapons}'s throw-on-malformed stance).
 */
export function extractArmor(sections: readonly RuleSection[], src: SourceRef): ArmorType[] {
  const armor: ArmorType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'armortype') continue;
    const typeId = requireTypeId(sec, 'armortype', src);
    const name = getStr(sec, 'name');
    armor.push(
      ArmorType.parse({
        typeId,
        id: name ? slug(name) : `armor_${typeId}`,
        name,
        mainType: getInt(sec, 'mainType'),
        goodType: getInt(sec, 'goodtype'),
        materialType: getInt(sec, 'materialType'),
        weight: getInt(sec, 'weight'),
        blockingValue: getInt(sec, 'blockingValue'),
        source: makeSource(src, 'armortype'),
      }),
    );
  }
  return armor;
}

/**
 * Extracts `[vehicletype]` sections (base `Data/logic/vehicletypes.ini` — the mod ships no readable
 * twin, and the file is plain `.ini` like `goodtypes`/`landscapetypes`) into validated
 * {@link VehicleType} IR. The carry capacity is `stockslots` (the param the later multi-good carrier
 * slice consumes); `passengerslots` and `logicsize` round out the type record. The per-vehicle
 * `logicgood` cargo allow-list is carried (the goodtypes a hold may hold — the `cargoGoods` filter
 * the Sea/Northland boat-as-mobile-store consumes), read with {@link getIntList} since each
 * `logicgood N` is a repeated single-value line. The `logicpassenger` board-list, vector/slot
 * graphics (`stockvector`/`vehicleslots`), the draft-animal (`logicdragginganimaltribe`) and `debug*`
 * extras are still skipped — they belong with the later embark/transport + graphics slices, not this
 * type-table extract. Throws on a section missing the required numeric `type` (matches
 * {@link extractWeapons}'s throw-on-malformed stance).
 */
export function extractVehicles(sections: readonly RuleSection[], src: SourceRef): VehicleType[] {
  const vehicles: VehicleType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'vehicletype') continue;
    const typeId = requireTypeId(sec, 'vehicletype', src);
    const name = getStr(sec, 'name');
    vehicles.push(
      VehicleType.parse({
        typeId,
        id: name ? slug(name) : `vehicle_${typeId}`,
        name,
        stockSlots: getInt(sec, 'stockslots'),
        passengerSlots: getInt(sec, 'passengerslots'),
        logicSize: getInt(sec, 'logicsize'),
        cargoGoods: getIntList(sec, 'logicgood'),
        source: makeSource(src, 'vehicletype'),
      }),
    );
  }
  return vehicles;
}

/**
 * Extracts `[animaltype]` sections (base `Data/logic/animaltypes.ini` — plain `.ini` despite the
 * `<CULTURES_CIF_BEGIN>` header line, like `armortypes`/`vehicletypes`; the mod ships no readable twin)
 * into validated {@link AnimalType} IR — the per-tribe behaviour of the non-controllable creature
 * tribes the civ-vs-animal combat slice consumes. Unlike every other type table, an animal record keys
 * on **`tribetype`** (the cross-ref into the tribe table), NOT `type`: the source has no `type` id and
 * an animal's identity is its owning tribe. A record **missing `tribetype`** is **dropped** (a couple of
 * leftover/disabled stubs in the real file carry none) — it cannot resolve to a tribe, so keeping it
 * would dangle. This is the one extractor that drops-on-missing-key rather than throwing
 * ({@link extractWeapons}'s stance): here the key is genuinely absent in real data (a disabled record),
 * not malformed. The 0/1 flags become booleans (`getInt(...) === 1`, as {@link extractLandscape} does);
 * the magnitude fields stay ints. The graphics/sound/spawn extras are skipped — behaviour slice only.
 */
export function extractAnimals(sections: readonly RuleSection[], src: SourceRef): AnimalType[] {
  const animals: AnimalType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'animaltype') continue;
    const tribeType = getInt(sec, 'tribetype');
    if (tribeType === undefined) continue; // a disabled/leftover stub with no tribe key — can't resolve, drop it
    const name = getStr(sec, 'name');
    animals.push(
      AnimalType.parse({
        id: name ? slug(name) : `animal_${tribeType}`,
        name,
        tribeType,
        aggressive: getInt(sec, 'aggressive') === 1,
        getAngry: getInt(sec, 'getangry') === 1,
        angryGameTime: getInt(sec, 'angryGameTime'),
        hitpointsAdult: getInt(sec, 'hitpoints_adult'),
        hitpointsBaby: getInt(sec, 'hitpoints_baby'),
        maximumGroupSize: getInt(sec, 'maximumgroupsize'),
        maximumCadaverSize: getInt(sec, 'maximumcadaversize'),
        maximumLeaderDistance: getInt(sec, 'maximumleaderdistance'),
        searchForLeader: getInt(sec, 'searchforleader') === 1,
        maximumDistanceToStayPoint: getInt(sec, 'maximumdistancetostaypoint'),
        maximumDistanceToBirthPoint: getInt(sec, 'maximumdistancetobirthpoint'),
        moveSpeed: getInt(sec, 'movespeed'),
        runSpeed: getInt(sec, 'runspeed'),
        catchable: getInt(sec, 'catchable') === 1,
        warrantable: getInt(sec, 'warrantable') === 1,
        cannotBeAttacked: getInt(sec, 'cannotbeattacked') === 1,
        ignoreHouses: getInt(sec, 'ignorehouses') === 1,
        source: makeSource(src, 'animaltype'),
      }),
    );
  }
  return animals;
}
