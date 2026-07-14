import type { AnimalType, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/**
 * The {@link AnimalType} behaviour record for `tribeType`, or null — a pure read over `content.animals`
 * keyed by `tribeType` (an animal's identity is its owning tribe; source basis "Animal type table").
 * Returns the first match in source-array order: `animaltypes.ini` reuses a `tribetype` for a couple of
 * records (tribe 23 appears twice), so the table is an array, not a Map — keying by `tribeType` would
 * silently drop a record. null when the tribe has no animal record (a civilization, or an unknown tribe).
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return contentIndex(content).animalsByTribe.get(tribeType) ?? null;
}

/**
 * Whether `tribeType` is an aggressive animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `aggressive` (it attacks civilizations unprovoked). The sim's combat targeting (`conflict/targeting.ts`)
 * reads this so an aggressive animal (a bear, a wolf pack) runs an attack drive against a nearby
 * civilization while a passive animal does not. This is the unprovoked driver only; the
 * `getAngry`/`angryGameTime` provoked half is the companion {@link isProvokableAnimal}/{@link angryGameTimeOf}
 * via the {@link Anger} timer (source basis "Civ-vs-animal aggression"). A tribe with no animal record is
 * not aggressive.
 */
export function isAggressiveAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.aggressive ?? false;
}

/**
 * Whether `tribeType` is a provokable animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `getAngry` (otherwise passive, but when struck turns hostile for `angryGameTime` ticks). The
 * AtomicSystem's `attack` effect reads this: a civ's hit on a provokable animal stamps an {@link Anger}
 * timer (the CombatSystem then treats it like an aggressive animal until the timer lapses). An
 * always-aggressive animal needs no provocation; a tribe with no animal record is not provokable. The anger
 * duration is {@link angryGameTimeOf} (source basis "Civ-vs-animal aggression").
 */
export function isProvokableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.getAngry ?? false;
}

/**
 * How long (in game ticks) an animal of `tribeType` stays hostile once provoked — its `animaltypes.ini`
 * `angryGameTime`, or 0 when the tribe has no animal record. The AtomicSystem stamps
 * {@link Anger}`{until: tick + angryGameTimeOf(...)}` when a {@link isProvokableAnimal} animal is struck;
 * the timer lapses (and the component is removed) once the current tick reaches `until`.
 */
export function angryGameTimeOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.angryGameTime ?? 0;
}

/**
 * Whether `tribeType` is an animal that cannot be attacked by a civilization — a `[tribetype]` whose
 * `animaltypes.ini` record sets `cannotbeattacked` (decorative fauna: bees, butterflies). Combat targeting
 * exempts such an animal from a civilization's attacks (never a valid target), even if flagged aggressive.
 * A tribe with no animal record is not exempt.
 */
export function animalCannotBeAttacked(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.cannotBeAttacked ?? false;
}

/**
 * Whether `tribeType` is a catchable animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `catchable` (huntable livestock: cows/sheep, vs wild-only fauna). The prey side of the hunter mechanic,
 * distinct from combat hostility: an ordinary combatant leaves a passive animal alone ({@link mayAttack}),
 * but a hunter ({@link mayHunt}) may strike catchable prey to harvest it (the original's
 * `viking_hunter_attack` → `..._harvest_cadaver` chain). A tribe with no animal record is not catchable
 * (source basis "Hunter strike on catchable prey").
 */
export function isCatchableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.catchable ?? false;
}

/**
 * Whether `tribeType` is a warrantable animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `warrantable` (it can be claimed/owned by a tribe: penned livestock, vs free wildlife). Distinct from
 * {@link isCatchableAnimal} (huntable prey): `catchable` says a hunter may strike it for meat,
 * `warrantable` says it can become a tribe's property — the data the deferred livestock-ownership drive
 * (claiming/penning/breeding) will read. A tribe with no animal record is not warrantable.
 */
export function isWarrantableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.warrantable ?? false;
}

/**
 * Whether `tribeType` is an animal that ignores houses when pathing — a `[tribetype]` whose
 * `animaltypes.ini` record sets `ignorehouses` (it walks through buildings rather than routing around
 * them: a bird over a wall). Where {@link isAggressiveAnimal}/{@link animalCannotBeAttacked} gate combat,
 * this gates navigation — the data the deferred animal-pathing drive will read to decide whether a building
 * tile blocks the creature's route. A tribe with no animal record does not ignore houses.
 */
export function ignoresHousesAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.ignoreHouses ?? false;
}

/**
 * The adult hitpoint pool an animal of `tribeType` is born with — its `animaltypes.ini` `hitpoints_adult`
 * (200..50000; e.g. a bear's 15000), or null when the tribe has no animal record (a civilization — human HP
 * is below the `.ini`, content-stamped elsewhere). The {@link Health} stamp source for an animal combatant:
 * a spawned animal gets `Health{hitpoints: max, max}` from this (source basis "Combat hit resolution"). The
 * magnitude is the verbatim extracted param; animal spawning (where/when/how many) is a later slice.
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
}

/**
 * The juvenile hitpoint pool an animal of `tribeType` is born with — its `animaltypes.ini` `hitpoints_baby`
 * (e.g. a wolf's 500 vs its adult 1000; 18 of the 35 extracted animals set it), or null when the tribe has
 * no animal record. The pool a spawned baby carries until it grows up, the data the deferred animal-growth
 * slice will read to set a juvenile's {@link Health} and re-stamp it at adulthood.
 *
 * Not derived from {@link animalHitpoints}: the source carries the two pools independently and they diverge
 * (a wolf's baby 500 is half its adult 1000; some set baby == adult, others leave baby at the extractor
 * default 0) — so it reads the field straight, never inferred. The magnitude is the verbatim extracted
 * param; the life-stage growth it will drive is a later slice (the animal twin of the civ `growthSystem`).
 */
export function animalBabyHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsBaby;
}

/**
 * The herd/spawn parameters a future animal-spawn/herding slice needs to place a group of animals of
 * `tribeType`, or null when the tribe has no animal record. The fields are the verbatim extracted
 * `animaltypes.ini` params, surfaced as one struct:
 *
 *  - `maxGroupSize` (`maximumgroupsize`) — herd/pack size (0 = source-omitted, a solitary animal).
 *  - `searchForLeader` (`searchforleader`) — whether a member follows a herd leader vs roams solo.
 *  - `leaderDistance` (`maximumleaderdistance`) — how far a follower may roam from its leader before the
 *    follow-the-leader drive sends it back.
 *  - `birthPointRange` (`maximumdistancetobirthpoint`) — how far the herd ranges from its spawn point.
 *  - `stayPointRange` (`maximumdistancetostaypoint`) — territory radius around the animal's stay point.
 *
 * The spawning/herding behaviour these params will drive is a later slice with no oracle.
 */
export interface HerdParams {
  /** `maximumgroupsize` — herd/pack size (0 = solitary / source-omitted). */
  readonly maxGroupSize: number;
  /** `searchforleader` — a member follows a herd leader vs roams solo. */
  readonly searchForLeader: boolean;
  /** `maximumleaderdistance` — how far (half-cell nodes) a follower may roam from its leader before it
   *  heads back. All three distances below are likewise node Manhattan distances — the half-cell reading of
   *  the original's logic-grid params (same basis as weapon reach). */
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
 * The locomotion pace an animal of `tribeType` moves at, or null when the tribe has no animal record:
 *
 *  - `walkSpeed` (`movespeed`) — the pace the animal always moves at in our sim (0 = source-omitted, engine
 *    default; 9 of the 35 extracted animals set it, e.g. the boar's 8). The IR's `runspeed` (the original's
 *    animal run gait) is deliberately not surfaced — no run/sprint gait is modeled; every unit moves at one
 *    constant pace.
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
 * The good a felled animal's corpse yields when a hunter harvests it — `meat`, `goodtypes.ini` `name "meat"`
 * → `type 21` (verified in `Data/logic/goodtypes.ini`; distinct from the `cadaver_meat` landscapetype decal
 * id 80, the corpse object on the ground, not a stock good). A hunter's `harvest_cadaver` (`setatomic 15 33
 * "..._hunter_harvest_cadaver"`) drops this onto the slayer's back.
 */
export const MEAT_GOOD = 21;

/**
 * How many units of {@link MEAT_GOOD} a felled animal of `tribeType` yields when its cadaver is harvested —
 * its `animaltypes.ini` `maximumcadaversize` (cows/most fauna 4, a couple of small ones 2), or 0 when the
 * tribe has no animal record. A hunter who fells {@link isCatchableAnimal} prey gains this many `meat` (the
 * AtomicSystem's `attack` effect awards it on the killing blow).
 *
 * source-basis: the magnitude is the verbatim extracted `maximumcadaversize` and the good is the pinned
 * `meat` id; that the kill yields meat in place on the killing blow (no separate walk-to-corpse atomic yet)
 * and that one cadaver-size unit maps to one meat unit are the approximated halves (source basis "Hunter
 * cadaver-harvest yield").
 */
export function cadaverYieldOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.maximumCadaverSize ?? 0;
}
