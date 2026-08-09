import { AnimalType, ArmorType, AtomicAnimation, VehicleType, WeaponType } from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import { makeSource, requireTypeId, type SourceRef, slug } from '../ir-fields.js';
import { findProps, getInt, getIntList, getStr } from '../props.js';

/** A section without a `name` is unreferenceable by a tribe's `setatomic`, so it throws. */
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
    const goodTypeRaw = getInt(sec, 'goodtype');
    weapons.push(
      WeaponType.parse({
        typeId,
        id: name ? slug(name) : `weapon_${typeId}`,
        name,
        tribeType: getInt(sec, 'tribetype'),
        mainType: getInt(sec, 'mainType'),
        weight: getInt(sec, 'weight'),
        munitionType: getInt(sec, 'munitiontype'),
        speed: getInt(sec, 'speed'),
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

/** An armor's `type` is the armor class a {@link WeaponType.damage} record keys against. */
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
 * An `[animaltype]` record keys on `tribetype`, not the `type` every other table uses. A record
 * without one is a disabled stub in the real file, so it is dropped rather than treated as malformed.
 */
export function extractAnimals(sections: readonly RuleSection[], src: SourceRef): AnimalType[] {
  const animals: AnimalType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'animaltype') continue;
    const tribeType = getInt(sec, 'tribetype');
    if (tribeType === undefined) continue;
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
