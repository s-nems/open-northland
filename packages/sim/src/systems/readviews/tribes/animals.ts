import type { AnimalType, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/**
 * The {@link AnimalType} record for `tribeType`, or null for a civilization or unknown tribe.
 * `animaltypes.ini` reuses a `tribetype` for a couple of records, so the first match in source-array
 * order wins.
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return contentIndex(content).animalsByTribe.get(tribeType) ?? null;
}

/**
 * Whether `tribeType` is wildlife - a tribe the source gave an `[animaltype]` record. False for a
 * civilization, for an unknown tribe, and for the two humanoid monster tribes; none may be silently
 * reclassified as wildlife.
 *
 * Source basis: `animaltypes.ini` records cover exactly `tribetype` 8..41, the `TRIBE_TYPE_ANIMAL_*`
 * block of `logicdefines.inc`. An empty `jobEnables` tech graph is not the signature - weresnake (5)
 * and werewolf (6) carry none either, yet `logicdefines.inc` declares them `TRIBE_TYPE_HUMAN_*`.
 */
export function isAnimalTribe(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType) !== null;
}

/** `animaltypes.ini` `aggressive`: the animal attacks civilizations unprovoked. */
export function isAggressiveAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.aggressive ?? false;
}

/** `animaltypes.ini` `getAngry`: passive until struck, then hostile for {@link angryGameTimeOf} ticks. */
export function isProvokableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.getAngry ?? false;
}

/** `animaltypes.ini` `angryGameTime` in game ticks, or 0 without an animal record. */
export function angryGameTimeOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.angryGameTime ?? 0;
}

/**
 * `animaltypes.ini` `maximumdistancetostaypoint` in half-cell node Manhattan distance, or 0 without an
 * animal record. Scalar so the per-creature, per-tick grazing read mints no object.
 */
export function stayPointRangeOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.maximumDistanceToStayPoint ?? 0;
}

/**
 * `animaltypes.ini` `cannotbeattacked`: decorative fauna a civilization can never target, even when
 * flagged aggressive.
 */
export function animalCannotBeAttacked(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.cannotBeAttacked ?? false;
}

/**
 * `animaltypes.ini` `catchable`: a scout may claim it by contact and a farm may pen it. Huntability is
 * the separate {@link isHuntablePrey} table.
 */
export function isCatchableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.catchable ?? false;
}

/** `animaltypes.ini` `warrantable`: the animal can become a tribe's property as penned livestock. */
export function isWarrantableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.warrantable ?? false;
}

/** `animaltypes.ini` `ignorehouses`: the animal paths through buildings instead of around them. */
export function ignoresHousesAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.ignoreHouses ?? false;
}

/**
 * `animaltypes.ini` `hitpoints_adult` (200..50000), or null without an animal record. Human hitpoints
 * are stamped elsewhere.
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
}

/**
 * `animaltypes.ini` `hitpoints_baby`, or null without an animal record. Read straight rather than
 * derived: the source carries the two pools independently and they diverge.
 */
export function animalBabyHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsBaby;
}

/** Verbatim `animaltypes.ini` herd and spawn params. The three distances are half-cell node Manhattan. */
interface HerdParams {
  /** `maximumgroupsize`, 0 when solitary or omitted by the source. */
  readonly maxGroupSize: number;
  /** `searchforleader`: the member follows a herd leader instead of roaming solo. */
  readonly searchForLeader: boolean;
  /** `maximumleaderdistance` */
  readonly leaderDistance: number;
  /** `maximumdistancetobirthpoint` */
  readonly birthPointRange: number;
  /** `maximumdistancetostaypoint` */
  readonly stayPointRange: number;
}

export function herdParams(content: ContentSet, tribeType: number): HerdParams | null {
  const animal = animalRecord(content, tribeType);
  if (animal === null) return null;
  return {
    maxGroupSize: animal.maximumGroupSize,
    searchForLeader: animal.searchForLeader,
    leaderDistance: animal.maximumLeaderDistance,
    birthPointRange: animal.maximumDistanceToBirthPoint,
    stayPointRange: animal.maximumDistanceToStayPoint,
  };
}

/** The IR's `runspeed` is not surfaced: no sprint gait is modeled, every unit moves at one pace. */
interface Locomotion {
  /** `movespeed`, 0 when omitted by the source. */
  readonly walkSpeed: number;
}

export function locomotionOf(content: ContentSet, tribeType: number): Locomotion | null {
  const animal = animalRecord(content, tribeType);
  if (animal === null) return null;
  return { walkSpeed: animal.moveSpeed };
}

/**
 * The authored prey table is the single huntability signal: game species plus the last-resort
 * livestock, with no row for predators or decorative fauna.
 */
export function isHuntablePrey(content: ContentSet, tribeType: number): boolean {
  return contentIndex(content).huntPreyByTribe.has(tribeType);
}

/** Prey a hunter takes only when no normal prey is in its hunting area, such as penned livestock. */
export function isLastResortPrey(content: ContentSet, tribeType: number): boolean {
  return contentIndex(content).huntPreyByTribe.get(tribeType)?.lastResort ?? false;
}

/** One harvestable carcass node per entry, or null when the tribe is not huntable prey. */
export function huntYieldsOf(
  content: ContentSet,
  tribeType: number,
): readonly { readonly goodType: number; readonly amount: number }[] | null {
  return contentIndex(content).huntPreyByTribe.get(tribeType)?.yields ?? null;
}
