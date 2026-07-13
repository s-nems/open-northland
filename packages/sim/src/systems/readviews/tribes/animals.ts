import type { AnimalType, ContentSet } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/**
 * The {@link AnimalType} behaviour record for `tribeType`, or null — a pure read over `content.animals`,
 * keyed by `tribeType` (an animal's identity IS its owning tribe — see source basis "Animal type
 * table"). Returns the **first** match in source-array order: the real `animaltypes.ini` reuses a
 * `tribetype` for a couple of records (tribe 23 appears twice), so the table is an array, not a Map —
 * keying by `tribeType` would silently drop a record (the same array-not-Map decision the weapon/combat
 * read views make). null when the tribe has no animal record (a civilization, or an unknown tribe).
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the behaviour flags it surfaces are the faithful params the pipeline
 * pinned. Pure over `content`, no RNG/wall-clock.
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return contentIndex(content).animalsByTribe.get(tribeType) ?? null;
}

/**
 * Whether `tribeType` is an **aggressive** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `aggressive` (it attacks civilizations **unprovoked**, the civ-vs-animal aggression driver). The sim's
 * combat targeting (`conflict/targeting.ts`) reads this so an aggressive animal (a bear, a wolf pack) runs
 * an attack drive against a nearby civilization, while a passive animal (a cow, a decorative bird) does
 * not. A tribe with no animal record (a civilization, an unknown tribe) is not aggressive.
 *
 * NOTE this is the **unprovoked** driver only (`aggressive`). The `getAngry`/`angryGameTime` half — an
 * otherwise-passive animal **provoked** into temporary hostility (it was attacked, then stays hostile
 * for `angryGameTime` ticks) — is the companion {@link isProvokableAnimal}/{@link angryGameTimeOf}
 * read side, consumed via the per-entity {@link Anger} timer the AtomicSystem stamps and the
 * CombatSystem reads (source basis "Civ-vs-animal aggression").
 *
 * source-basis n/a here (a read view); the *behaviour* it drives is tracked in source basis. Pure over
 * `content`, no RNG/wall-clock.
 */
export function isAggressiveAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.aggressive ?? false;
}

/**
 * Whether `tribeType` is a **provokable** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `getAngry` (it is otherwise passive but, when **struck**, turns temporarily hostile for
 * `angryGameTime` ticks — the provoked-anger half of aggression). The AtomicSystem's `attack` effect
 * reads this at the provocation point: a civ's hit landing on a provokable animal stamps an
 * {@link Anger} timer on it (`combatSystem` then treats it like an aggressive animal until the timer
 * lapses). An always-`aggressive` animal (a bear) needs no provocation — it is hostile unconditionally
 * — and a tribe with no animal record (a civilization, an unknown tribe) is not provokable. The
 * **anger duration** ({@link angryGameTimeOf}) is the matching `angryGameTime` magnitude. Pure over
 * `content`, no RNG/wall-clock; source-basis n/a here (a read view) — the *behaviour* it drives is tracked
 * in source basis ("Civ-vs-animal aggression").
 */
export function isProvokableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.getAngry ?? false;
}

/**
 * How long (in game ticks) an animal of `tribeType` stays hostile once **provoked** — its
 * `animaltypes.ini` `angryGameTime`, or `0` when the tribe has no animal record (a civilization, an
 * unknown tribe — it cannot be provoked, so it has no anger duration). The AtomicSystem stamps an
 * {@link Anger}`{until: tick + angryGameTimeOf(...)}` when a {@link isProvokableAnimal} animal is
 * struck; the timer lapses (and the component is removed) once the current tick reaches `until`. Pure
 * over `content`, no RNG/wall-clock; source-basis n/a (read view — the param is the verbatim extracted
 * `angryGameTime`).
 */
export function angryGameTimeOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.angryGameTime ?? 0;
}

/**
 * Whether `tribeType` is an animal that **cannot be attacked** by a civilization — a `[tribetype]` whose
 * `animaltypes.ini` record sets `cannotbeattacked` (decorative/non-combat fauna: bees, butterflies). The
 * combat targeting drive uses this to **exempt** such an animal from a civilization's attacks (it is
 * never a valid target), even if it is somehow flagged aggressive. A tribe with no animal record is not
 * exempt (it is not a decorative animal). Pure over `content`, no RNG/wall-clock; source-basis n/a (read view).
 */
export function animalCannotBeAttacked(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.cannotBeAttacked ?? false;
}

/**
 * Whether `tribeType` is a **catchable** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `catchable` (tamable/huntable livestock: cows/sheep, vs wild-only fauna). This is the prey side of the
 * **hunter** mechanic — distinct from combat hostility: a passive animal is left alone by an ordinary
 * civilization combatant ({@link mayAttack}), but a **hunter** ({@link mayHunt}) may strike `catchable`
 * prey to harvest it (the original's `viking_hunter_attack` → `..._harvest_cadaver` chain). The last
 * `animaltypes.ini` driver the sim consumes (alongside `aggressive`/`getangry`/`cannotbeattacked`). A
 * tribe with no animal record (a civilization, an unknown tribe) is not catchable.
 *
 * source-basis n/a here (a read view); the *behaviour* it drives (the hunter strike) is tracked in
 * source basis ("Hunter strike on catchable prey"). Pure over `content`, no RNG/wall-clock.
 */
export function isCatchableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.catchable ?? false;
}

/**
 * Whether `tribeType` is a **warrantable** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `warrantable` (it can be claimed/owned: a tribe's livestock that belongs to a farmer/herder, vs free
 * wildlife that belongs to nobody). Distinct from {@link isCatchableAnimal} (the *huntable* prey
 * relation): `catchable` says a hunter may strike it for meat, `warrantable` says it can become a
 * tribe's *property* (a domesticated/penned animal a herder owns and breeds) — the data the deferred
 * livestock-ownership drive (a herder claiming an animal, a pen of owned cattle) reads. A tribe with no
 * animal record (a civilization, an unknown tribe) is not warrantable.
 *
 * source-basis n/a here (a read view over the verbatim extracted `warrantable` flag); the *ownership
 * behaviour* it will drive (claiming/penning/breeding owned livestock) is a later slice with no oracle,
 * tracked separately in source basis. Pure over `content`, no RNG/wall-clock.
 */
export function isWarrantableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.warrantable ?? false;
}

/**
 * Whether `tribeType` is an animal that **ignores houses** when pathing — a `[tribetype]` whose
 * `animaltypes.ini` record sets `ignorehouses` (it walks through/over buildings rather than routing
 * around them: a bird that flies over a wall, a ghost-like creature). The pathing twin of the behaviour
 * flags: where {@link isAggressiveAnimal}/{@link animalCannotBeAttacked} gate *combat*, this gates an
 * animal's *navigation* — the data the deferred animal-pathing drive reads to decide whether a building
 * tile blocks the creature's route. A tribe with no animal record (a civilization, an unknown tribe)
 * does not ignore houses (it paths around them like any settler).
 *
 * source-basis n/a here (a read view over the verbatim extracted `ignorehouses` flag); the *pathing
 * behaviour* it will drive (an animal route that treats building tiles as walkable) is a later slice
 * with no oracle, tracked separately in source basis. With this, **every** extracted
 * `animaltypes.ini` field now has a sim read view. Pure over `content`, no RNG/wall-clock.
 */
export function ignoresHousesAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.ignoreHouses ?? false;
}

/**
 * The **adult hitpoint pool** an animal of `tribeType` is born with — its `animaltypes.ini`
 * `hitpoints_adult` (200..50000 in the real data; e.g. a bear's 15000), or null when the tribe has no
 * animal record (a civilization — humans' HP is below the `.ini`, so it is content-stamped elsewhere).
 * This is the {@link Health}-component stamp source for an animal combatant: a spawned animal gets a
 * `Health{hitpoints: max, max}` from this, exactly as the combat hit-resolution mechanic already reads
 * `Health` (source basis "Combat hit resolution"). The animal-spawn/herding slice that actually
 * places animals on the map will call this; the value is the faithful extracted param.
 *
 * source-basis: the **hitpoint magnitude** is the verbatim extracted `hitpoints_adult` (a faithful param);
 * the *spawning* of animals (where/when/how many) is a later slice with no oracle. Pure over `content`,
 * no RNG/wall-clock.
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
}

/**
 * The **juvenile hitpoint pool** an animal of `tribeType` is born with — its `animaltypes.ini`
 * `hitpoints_baby` (the baby/young life-stage HP, e.g. a wolf's 500 vs its adult 1000; 18 of the 35
 * extracted animals set it explicitly), or null when the tribe has no animal record (a civilization,
 * an unknown tribe). The life-stage twin of {@link animalHitpoints}: where that view stamps the
 * `Health` of a spawned **adult** animal, this is the pool a spawned **baby** animal carries until it
 * grows up, the data the deferred animal-growth slice (a young animal aging baby→adult, the
 * `maximumgroupsize` herd's offspring) reads to set a juvenile's `Health` and re-stamp it at adulthood.
 *
 * It is NOT derived from {@link animalHitpoints}: the source carries the two pools independently and
 * they diverge (a wolf's baby 500 is half its adult 1000; some animals set baby == adult, others set
 * only the adult and leave baby at the extractor default 0) — so it reads the field straight, never
 * inferred (cf. AGENTS.md `[cc9c3d2]` — a distinct extracted quantity, not a fallback).
 *
 * source-basis: the **baby hitpoint magnitude** is the verbatim extracted `hitpoints_baby` (a faithful
 * param); the *life-stage growth* it will drive (when a baby spawns, ages, and re-stamps to the adult
 * pool) is a later slice with no oracle — the animal twin of the civ baby→adult `growthSystem`
 * (source basis). Pure over `content`, no RNG/wall-clock.
 */
export function animalBabyHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsBaby;
}

/**
 * The **herd/spawn parameters** a future animal-spawn/herding slice needs to place a group of animals
 * of `tribeType` on the map — read straight off the `animaltypes.ini` record, or null when the tribe
 * has no animal record (a civilization, or an unknown tribe). The fields are the faithful extracted
 * params, surfaced as one struct so the spawner reads a single view (the same one-call shape
 * {@link combatDamage}/{@link goodsGraph} give their consumers):
 *
 *  - `maxGroupSize` (`maximumgroupsize`) — how many of this animal form a herd/pack (the count a spawn
 *    point seeds; 0 = the source omitted it, a solitary animal).
 *  - `searchForLeader` (`searchforleader`) — whether a member follows a herd leader (wolves/deer) vs
 *    roams solo, which decides whether the spawned group needs a designated leader entity.
 *  - `leaderDistance` (`maximumleaderdistance`) — how far a follower may roam from its herd leader
 *    before the follow-the-leader drive sends it back (the cohesion radius the herding movement reads).
 *  - `birthPointRange` (`maximumdistancetobirthpoint`) — how far the herd ranges from its birth/spawn
 *    point (the radius around the spawn tile the group scatters into).
 *  - `stayPointRange` (`maximumdistancetostaypoint`) — the territory radius around the animal's stay
 *    point (how far it wanders before turning back).
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the *spawning/herding behaviour* these params will drive (where/when a
 * group appears, how it follows a leader) is a later slice with no oracle, tracked separately in
 * source basis. Pure over `content`, no RNG/wall-clock.
 */
export interface HerdParams {
  /** `maximumgroupsize` — herd/pack size (0 = solitary / source-omitted). */
  readonly maxGroupSize: number;
  /** `searchforleader` — a member follows a herd leader vs roams solo. */
  readonly searchForLeader: boolean;
  /** `maximumleaderdistance` — how far (half-cell nodes) a follower may roam from its leader before it
   *  heads back. All three distances below are likewise consumed VERBATIM as node Manhattan distances —
   *  the half-cell reading of the original's logic-grid params (same basis note as weapon reach). */
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
 * The **locomotion speeds** an animal of `tribeType` moves at — read straight off the
 * `animaltypes.ini` record, or null when the tribe has no animal record (a civilization, or an
 * unknown tribe). The locomotion analogue of {@link herdParams}: where that view carries the
 * herd/territory radii, this carries how fast the animal walks vs runs, the data a later
 * animal-movement slice needs to drive its pace. The fields are the faithful extracted params,
 * surfaced as one struct so the mover reads a single view (the {@link herdParams} one-call shape):
 *
 *  - `walkSpeed` (`movespeed`) — the wandering/grazing pace (0 = the source omitted it, i.e. the
 *    engine default applies; 9 of the 35 extracted animals set it explicitly, e.g. the boar's 8).
 *  - `runSpeed` (`runspeed`) — the fleeing/charging pace a startled or hostile animal moves at
 *    (0 = the source omitted it; 5 of the 35 carry it, always a *slower* number than their
 *    `movespeed` — it is the engine's separate run-animation cadence, not "faster than walk").
 *
 * source-basis n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds
 * no mechanic and invents no data; the *movement behaviour* these speeds will drive (when an animal
 * walks vs runs, how a speed maps to per-tick cell advance) is a later slice with no oracle, tracked
 * separately in source basis. Pure over `content`, no RNG/wall-clock.
 */
export interface Locomotion {
  /** `movespeed` — the walking/grazing pace (0 = source-omitted, engine default). */
  readonly walkSpeed: number;
  /** `runspeed` — the fleeing/charging pace (0 = source-omitted). */
  readonly runSpeed: number;
}

export function locomotionOf(content: ContentSet, tribeType: number): Locomotion | null {
  const animal = animalRecord(content, tribeType);
  if (animal === null) return null;
  return {
    walkSpeed: animal.moveSpeed,
    runSpeed: animal.runSpeed,
  };
}

/**
 * The good a felled animal's corpse yields when a hunter harvests it — `meat`, `goodtypes.ini`
 * `name "meat"` → `type 21` (verified in `Data/logic/goodtypes.ini`; the food good the meat economy
 * also produces — distinct from the `cadaver_meat` *landscapetype* decal id 80, which is the corpse
 * object on the ground, not a stock good). A hunter's `harvest_cadaver` (`setatomic 15 33
 * "..._hunter_harvest_cadaver"`) drops this onto the slayer's back; kept as a pin next to {@link HUNTER_JOB}
 * and {@link cadaverYieldOf}, the `NEWBORN_AGE_CLASS` pin style.
 */
export const MEAT_GOOD = 21;

/**
 * How many units of {@link MEAT_GOOD} a felled animal of `tribeType` yields when its cadaver is harvested
 * — its `animaltypes.ini` `maximumcadaversize` (the corpse-size cap: cows/most fauna 4, a couple of
 * small ones 2), or `0` when the tribe has no animal record (a civilization, an unknown tribe — only an
 * animal leaves a harvestable carcass). This is the magnitude side of the hunter's `harvest_cadaver`
 * follow-up: a hunter who fells {@link isCatchableAnimal} prey gains this many `meat` (the AtomicSystem's
 * `attack` effect awards it on the killing blow). A non-catchable or zero-`maximumcadaversize` animal
 * yields nothing.
 *
 * source-basis: the **magnitude** is the verbatim extracted `maximumcadaversize` param and the **good** is the
 * pinned `meat` id; that the kill yields meat *in place on the killing blow* (no separate walk-to-corpse
 * `harvest_cadaver` atomic yet) and that one cadaver-size unit maps to one meat unit are the approximated
 * halves (source basis "Hunter cadaver-harvest yield"). Pure over `content`, no RNG/wall-clock.
 */
export function cadaverYieldOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.maximumCadaverSize ?? 0;
}
