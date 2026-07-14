import type { AnimalType, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/**
 * The {@link AnimalType} record for `tribeType`, or null when the tribe has no animal record (a
 * civilization or unknown tribe). First match in source-array order: `animaltypes.ini` reuses a
 * `tribetype` for a couple of records (tribe 23 appears twice), so keying keeps the first (source basis
 * "Animal type table").
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return contentIndex(content).animalsByTribe.get(tribeType) ?? null;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `aggressive` — it attacks civilizations
 * unprovoked. The provoked companion is {@link isProvokableAnimal}/{@link angryGameTimeOf} via the
 * {@link Anger} timer (source basis "Civ-vs-animal aggression").
 */
export function isAggressiveAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.aggressive ?? false;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `getAngry` — passive until struck, then hostile
 * for {@link angryGameTimeOf} ticks (a hit stamps the {@link Anger} timer; source basis "Civ-vs-animal
 * aggression").
 */
export function isProvokableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.getAngry ?? false;
}

/**
 * How long (game ticks) an animal of `tribeType` stays hostile once provoked — its `animaltypes.ini`
 * `angryGameTime`, or 0 when the tribe has no animal record.
 */
export function angryGameTimeOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.angryGameTime ?? 0;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `cannotbeattacked` — decorative fauna (bees,
 * butterflies) a civilization can never target, even if flagged aggressive.
 */
export function animalCannotBeAttacked(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.cannotBeAttacked ?? false;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `catchable` — huntable prey a hunter
 * ({@link mayHunt}) may strike to harvest, distinct from combat hostility (original's
 * `viking_hunter_attack` → `..._harvest_cadaver` chain; source basis "Hunter strike on catchable prey").
 */
export function isCatchableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.catchable ?? false;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `warrantable` — it can become a tribe's property
 * (penned livestock), distinct from {@link isCatchableAnimal} (huntable for meat). Read by the deferred
 * livestock-ownership drive.
 */
export function isWarrantableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.warrantable ?? false;
}

/**
 * Whether `tribeType`'s `animaltypes.ini` record sets `ignorehouses` — it paths through buildings rather
 * than routing around them (a bird over a wall). Read by the deferred animal-pathing drive.
 */
export function ignoresHousesAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.ignoreHouses ?? false;
}

/**
 * The adult hitpoint pool an animal of `tribeType` is born with — its `animaltypes.ini` `hitpoints_adult`
 * (200..50000), or null when the tribe has no animal record (a civilization; human HP is stamped
 * elsewhere). Source of an animal combatant's {@link Health} stamp (source basis "Combat hit resolution").
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
}

/**
 * The juvenile hitpoint pool an animal of `tribeType` is born with — its `animaltypes.ini`
 * `hitpoints_baby`, or null when the tribe has no animal record. Read straight, not derived from
 * {@link animalHitpoints}: the source carries the two pools independently and they diverge (a wolf's baby
 * 500 is half its adult 1000; some set them equal, some leave baby at the extractor default 0).
 */
export function animalBabyHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsBaby;
}

/**
 * The herd/spawn parameters (verbatim extracted `animaltypes.ini` params) a future animal-spawn/herding
 * slice needs to place a group of animals of `tribeType`, or null when the tribe has no animal record.
 */
export interface HerdParams {
  /** `maximumgroupsize` — herd/pack size (0 = solitary / source-omitted). */
  readonly maxGroupSize: number;
  /** `searchforleader` — a member follows a herd leader vs roams solo. */
  readonly searchForLeader: boolean;
  /** `maximumleaderdistance` — how far a follower may roam from its leader. All three distances below are
   *  half-cell node Manhattan distances — the half-cell reading of the original's logic-grid params (same
   *  basis as weapon reach). */
  readonly leaderDistance: number;
  /** `maximumdistancetobirthpoint` — how far the herd ranges from its spawn point. */
  readonly birthPointRange: number;
  /** `maximumdistancetostaypoint` — territory radius around the animal's stay point. */
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

/**
 * The locomotion pace an animal of `tribeType` moves at, or null when the tribe has no animal record.
 * The IR's `runspeed` is not surfaced — no run/sprint gait is modeled; every unit moves at one pace.
 */
export interface Locomotion {
  /** `movespeed` — the animal's one pace (0 = source-omitted, engine default). */
  readonly walkSpeed: number;
}

export function locomotionOf(content: ContentSet, tribeType: number): Locomotion | null {
  const animal = animalRecord(content, tribeType);
  if (animal === null) return null;
  return { walkSpeed: animal.moveSpeed };
}

/**
 * The good a felled animal's corpse yields when a hunter harvests it — `meat`, `goodtypes.ini` `type 21`
 * (verified in `Data/logic/goodtypes.ini`; distinct from the `cadaver_meat` landscape decal id 80, the
 * corpse object on the ground, not a stock good).
 */
export const MEAT_GOOD = 21;

/**
 * How many units of {@link MEAT_GOOD} a felled animal of `tribeType` yields when its cadaver is harvested
 * — its `animaltypes.ini` `maximumcadaversize`, or 0 when the tribe has no animal record. Approximated:
 * meat is awarded in place on the killing blow (no walk-to-corpse atomic yet) and one cadaver-size unit
 * maps to one meat unit (source basis "Hunter cadaver-harvest yield").
 */
export function cadaverYieldOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.maximumCadaverSize ?? 0;
}
