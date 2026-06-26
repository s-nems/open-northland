import type { AnimalType, ContentSet, TribeType } from '@vinland/data';

// Pure, terminal **read views** for tribe classification + animal behaviour — the data-defined
// civ-vs-animal split (off each tribe's tech graph) and the `animaltypes.ini` behaviour flags the
// CombatSystem's targeting drive reads. No mechanic is added here; see ./index.ts for why read views
// are grouped out of systems/shared.ts.

/**
 * The **playable (controllable) tribes** as a derived **read view** over `content` — the N civilizations
 * a player can command, distinguished from the animal/monster tribes *by the data alone*, never by a
 * hardcoded name or count ("two"). `content.tribes` is a flat list of every `[tribetype]` the pipeline
 * extracted — the 5 civilizations (viking/frank/saracen/byzantine/egypt) **and** the 36 animal/monster
 * tribes (`bears`, `wolves`, `weresnake`, …). The distinguishing signature is the **tech graph**: only a
 * civilization carries `jobEnables` edges (and, equivalently, `{need,train}for*` `jobRequirements`) — an
 * animal tribe is purely an atomic-binding vocabulary with `jobEnables.length === 0`. So a playable
 * tribe is exactly one with a non-empty `jobEnables` graph; this is the data-defined "N tribes" the
 * combat targeting and the upcoming non-controllable-animals item both build on, with nothing hardcoded.
 *
 * Returned as a {@link TribeType} **array** sorted ascending by `typeId` (not a Map keyed by id) so the
 * enumeration order is stable regardless of `content.tribes` declaration order — the canonical order a
 * "for each playable tribe" loop (births, AI, scoring) wants. {@link isPlayableTribe} is the matching
 * membership predicate for a single `tribeType` without materializing the list.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted tribe IR, like {@link goodsGraph}
 * — it adds no mechanic (nothing produced/consumed/moved) and invents no classification: the
 * playable-vs-animal split is read straight off whether the source `[tribetype]` block declared a
 * `jobEnables*` tech graph, the faithful param the pipeline pinned (ROADMAP Phase 4 "N data-defined
 * tribes": asymmetry through each tribe's bindings + `allow*`/`needfor*` graph, never hardcode "two").
 *
 * Determinism: a pure function of `content` (no world, no RNG, no wall-clock) over the plain
 * `content.tribes` array, explicitly **sorted** by `typeId`, so the same content yields a byte-identical
 * array (and iteration order) every call.
 */
export function playableTribes(content: ContentSet): TribeType[] {
  return content.tribes.filter((t) => t.jobEnables.length > 0).sort((a, b) => a.typeId - b.typeId);
}

/**
 * Whether `tribeType` is a **playable (controllable) civilization** — the single-tribe membership half
 * of {@link playableTribes}, for a caller (combat enemy-vs-animal targeting, a per-tribe AI gate) that
 * has a `tribe` id and only needs the yes/no, without materializing the sorted list. A tribe is playable
 * iff its `[tribetype]` carries a non-empty `jobEnables` tech graph (see {@link playableTribes}); an
 * unknown `tribeType` (no matching record) is **not** playable. Pure over `content`, no RNG/wall-clock.
 */
export function isPlayableTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = content.tribes.find((t) => t.typeId === tribeType);
  return tribe !== undefined && tribe.jobEnables.length > 0;
}

/**
 * Whether `tribeType` is a **known animal/monster tribe** — a `[tribetype]` the pipeline DID extract
 * (so it has a record) but that carries **no tech graph** (`jobEnables.length === 0`). This is the
 * complement of {@link isPlayableTribe} *restricted to recorded tribes*: of the 41 extracted tribes
 * the 5 civilizations are playable and the other 36 are animals, distinguished by the same data
 * signature ({@link playableTribes} — only a civilization carries `jobEnables` edges), never by a
 * hardcoded name or count.
 *
 * The distinction from `!isPlayableTribe` matters at the boundary: an **unknown** `tribeType` (no
 * matching record at all — e.g. a synthetic test fixture's enemy, or a not-yet-loaded tribe) is
 * `!isPlayableTribe` but is **not** an animal — we know nothing about it, so it must not be silently
 * reclassified as wildlife. So this returns `true` only for a tribe we have a record for AND that
 * record proves animal (empty tech graph); an absent record is `false` here just as it is in
 * {@link isPlayableTribe}. The combat targeting drive (`systems/combat.ts`) uses this to keep an
 * animal tribe out of the **player-vs-player** enemy predicate — civ-vs-animal aggression is a
 * separate, data-driven (`animaltypes.ini`) model, not the same-different-tribe rule.
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted tribe IR, like
 * {@link isPlayableTribe} — it adds no mechanic and invents no classification; the animal-vs-civ split
 * is read straight off whether the source `[tribetype]` declared a `jobEnables*` tech graph. Pure over
 * `content`, no RNG/wall-clock.
 */
export function isAnimalTribe(content: ContentSet, tribeType: number): boolean {
  const tribe = content.tribes.find((t) => t.typeId === tribeType);
  return tribe !== undefined && tribe.jobEnables.length === 0;
}

/**
 * The {@link AnimalType} behaviour record for `tribeType`, or null — a pure read over `content.animals`,
 * keyed by `tribeType` (an animal's identity IS its owning tribe — see docs/FIDELITY.md "Animal type
 * table"). Returns the **first** match in source-array order: the real `animaltypes.ini` reuses a
 * `tribetype` for a couple of records (tribe 23 appears twice), so the table is an array, not a Map —
 * keying by `tribeType` would silently drop a record (the same array-not-Map decision the weapon/combat
 * read views make). null when the tribe has no animal record (a civilization, or an unknown tribe).
 *
 * FIDELITY n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the behaviour flags it surfaces are the faithful params the pipeline
 * pinned. Pure over `content`, no RNG/wall-clock.
 */
export function animalRecord(content: ContentSet, tribeType: number): AnimalType | null {
  return content.animals.find((a) => a.tribeType === tribeType) ?? null;
}

/**
 * Whether `tribeType` is an **aggressive** animal — a `[tribetype]` whose `animaltypes.ini` record sets
 * `aggressive` (it attacks civilizations **unprovoked**, the civ-vs-animal aggression driver). The sim's
 * combat targeting (`systems/combat.ts`) reads this so an aggressive animal (a bear, a wolf pack) runs
 * an attack drive against a nearby civilization, while a passive animal (a cow, a decorative bird) does
 * not. A tribe with no animal record (a civilization, an unknown tribe) is not aggressive.
 *
 * NOTE this is the **unprovoked** driver only (`aggressive`). The `getAngry`/`angryGameTime` half — an
 * otherwise-passive animal **provoked** into temporary hostility (it was attacked, then stays hostile
 * for `angryGameTime` ticks) — is the companion {@link isProvokableAnimal}/{@link angryGameTimeOf}
 * read side, consumed via the per-entity {@link Anger} timer the AtomicSystem stamps and the
 * CombatSystem reads (docs/FIDELITY.md "Civ-vs-animal aggression").
 *
 * FIDELITY n/a here (a read view); the *behaviour* it drives is tracked in docs/FIDELITY.md. Pure over
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
 * `content`, no RNG/wall-clock; FIDELITY n/a here (a read view) — the *behaviour* it drives is tracked
 * in docs/FIDELITY.md ("Civ-vs-animal aggression").
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
 * over `content`, no RNG/wall-clock; FIDELITY n/a (read view — the param is the verbatim extracted
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
 * exempt (it is not a decorative animal). Pure over `content`, no RNG/wall-clock; FIDELITY n/a (read view).
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
 * FIDELITY n/a here (a read view); the *behaviour* it drives (the hunter strike) is tracked in
 * docs/FIDELITY.md ("Hunter strike on catchable prey"). Pure over `content`, no RNG/wall-clock.
 */
export function isCatchableAnimal(content: ContentSet, tribeType: number): boolean {
  return animalRecord(content, tribeType)?.catchable ?? false;
}

/**
 * The data-pinned **hunter** trade — `jobtypes.ini` `type 15` / `logicdefines.inc`
 * `JOB_TYPE_HUMAN_HUNTER 15`, the civilization job that hunts game. A combatant of this job may strike
 * {@link isCatchableAnimal} prey ({@link mayHunt}); every tribe's hunter binds the same attack atomic
 * (`setatomic 15 81 "..._hunter_attack"`, verified in `DataCnmd/tribetypes12/tribetypes.ini`), so a
 * hunter's strike reuses the combat `attack` atomic + weapon/hit path. Kept here (the tribe/animal
 * read-view module) next to the `mayHunt` relation it gates, the pin style of `NEWBORN_AGE_CLASS`.
 */
export const HUNTER_JOB = 15;

/**
 * The **predation relation** — may a civilization combatant whose job is `attackerJobType` **hunt** the
 * animal of `targetTribe`? This is the prey side of the hunter mechanic, **separate from** the hostility
 * relation {@link mayAttack}: hunting is predation gated by the attacker's *job* (only a {@link HUNTER_JOB}
 * hunter hunts), not by tribe-vs-tribe hostility. The rules:
 *
 *  - **The attacker must be a hunter** (`attackerJobType === HUNTER_JOB`). An ordinary settler/soldier
 *    leaves passive prey alone — only a hunter strikes a cow/deer to harvest it. (A jobless settler /
 *    a non-hunter trade never hunts.)
 *  - **The target must be a {@link isCatchableAnimal} animal** — tamable/huntable livestock per
 *    `animaltypes.ini` `catchable`. Wild-only fauna (a non-catchable deer), a civilization, and an
 *    unknown tribe are not huntable prey here.
 *  - **A `cannotbeattacked` animal is still exempt** (decorative bees) — a hunter can't strike it any
 *    more than a soldier can, the same target exemption {@link mayAttack} applies.
 *
 * Hunting is one direction only (prey doesn't "hunt" the hunter); a `catchable` `getAngry` prey animal
 * struck by a hunter is **provoked** into fighting back through the *combat* `Anger` path (the
 * AtomicSystem's `attack` effect), not through this relation — so the hunter strike is the
 * provocation **source** the anger timer waits on. Pure over `content`, no RNG/wall-clock.
 *
 * FIDELITY: the prey set is the verbatim `catchable` param and the hunter trade is the pinned
 * `JOB_TYPE_HUMAN_HUNTER 15`; *which* prey a hunter picks (nearest in range) and the absence of a
 * walk-to-prey/harvest-cadaver follow-up are approximated (docs/FIDELITY.md "Hunter strike on catchable
 * prey").
 */
export function mayHunt(content: ContentSet, attackerJobType: number | null, targetTribe: number): boolean {
  if (attackerJobType !== HUNTER_JOB) return false; // only a hunter hunts
  if (!isCatchableAnimal(content, targetTribe)) return false; // only catchable prey is huntable
  if (animalCannotBeAttacked(content, targetTribe)) return false; // decorative fauna stay exempt
  return true;
}

/**
 * The **adult hitpoint pool** an animal of `tribeType` is born with — its `animaltypes.ini`
 * `hitpoints_adult` (200..50000 in the real data; e.g. a bear's 15000), or null when the tribe has no
 * animal record (a civilization — humans' HP is below the `.ini`, so it is content-stamped elsewhere).
 * This is the {@link Health}-component stamp source for an animal combatant: a spawned animal gets a
 * `Health{hitpoints: max, max}` from this, exactly as the combat hit-resolution mechanic already reads
 * `Health` (docs/FIDELITY.md "Combat hit resolution"). The animal-spawn/herding slice that actually
 * places animals on the map will call this; the value is the faithful extracted param.
 *
 * FIDELITY: the **hitpoint magnitude** is the verbatim extracted `hitpoints_adult` (a faithful param);
 * the *spawning* of animals (where/when/how many) is a later slice with no oracle. Pure over `content`,
 * no RNG/wall-clock.
 */
export function animalHitpoints(content: ContentSet, tribeType: number): number | null {
  const animal = animalRecord(content, tribeType);
  return animal === null ? null : animal.hitpointsAdult;
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
 * FIDELITY n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds no
 * mechanic and invents no data; the *spawning/herding behaviour* these params will drive (where/when a
 * group appears, how it follows a leader) is a later slice with no oracle, tracked separately in
 * docs/FIDELITY.md. Pure over `content`, no RNG/wall-clock.
 */
export interface HerdParams {
  /** `maximumgroupsize` — herd/pack size (0 = solitary / source-omitted). */
  readonly maxGroupSize: number;
  /** `searchforleader` — a member follows a herd leader vs roams solo. */
  readonly searchForLeader: boolean;
  /** `maximumleaderdistance` — how far a follower may roam from its leader before it heads back. */
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
 * FIDELITY n/a: a pure derived **read view** over the already-extracted `animaltypes` IR — it adds
 * no mechanic and invents no data; the *movement behaviour* these speeds will drive (when an animal
 * walks vs runs, how a speed maps to per-tick cell advance) is a later slice with no oracle, tracked
 * separately in docs/FIDELITY.md. Pure over `content`, no RNG/wall-clock.
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
 * FIDELITY: the **magnitude** is the verbatim extracted `maximumcadaversize` param and the **good** is the
 * pinned `meat` id; that the kill yields meat *in place on the killing blow* (no separate walk-to-corpse
 * `harvest_cadaver` atomic yet) and that one cadaver-size unit maps to one meat unit are the approximated
 * halves (docs/FIDELITY.md "Hunter cadaver-harvest yield"). Pure over `content`, no RNG/wall-clock.
 */
export function cadaverYieldOf(content: ContentSet, tribeType: number): number {
  return animalRecord(content, tribeType)?.maximumCadaverSize ?? 0;
}

/**
 * The **combat hostility relation** — may a combatant of `attackerTribe` swing at a combatant of
 * `targetTribe`? The single source of truth the CombatSystem's targeting drive (`systems/combat.ts`)
 * consults for *both* the attacker-eligibility check and the per-candidate target check, so the two
 * directions of a fight stay consistent. The rules, in order:
 *
 *  - **Same tribe → no** (friendly fire is off; a tribe never wars on itself).
 *  - **Both animals → no.** Animals don't fight each other in this slice (no oracle for inter-species
 *    wildlife aggression); an animal's only combat is with civilizations.
 *  - **Civilization vs civilization (different tribes) → yes** — the player-vs-player drive. A
 *    different-tribe combatant with **no** record at all (an unknown tribe — a synthetic test enemy) is
 *    NOT an animal, so this branch treats it as a civilization and a valid enemy (the three-truth-states
 *    rule — see docs/LESSONS.md `[fe2470f]`: `!isPlayableTribe` ≠ `isAnimalTribe`).
 *  - **Civilization → animal → yes only if the animal is {@link isAggressiveAnimal} AND not
 *    {@link animalCannotBeAttacked}.** A civ engages a *hostile* (aggressive) animal but not passive
 *    prey (a cow/deer — hunting is the separate `catchable`/hunter mechanic, not combat); and a
 *    decorative `cannotbeattacked` animal (bees) is exempt from a civ's attacks entirely.
 *  - **Animal attacker must be aggressive.** A passive animal (a cow/deer, or a known animal tribe with
 *    no `animaltypes` record) attacks **nothing** — so an **aggressive** animal → civilization is the
 *    unprovoked aggression driver (a bear/wolf attacks a nearby settler), while a passive animal →
 *    anything is `false`. This makes `mayAttack` self-contained (it gates the attacker side itself, not
 *    only the combat loop); `cannotbeattacked` gates only being a *target*, not attacking, so an
 *    aggressive but `cannotbeattacked` animal (a bee) can still attack a civ.
 *
 * FIDELITY: the hostility gate reads the faithful extracted params — the civ-vs-animal split off
 * `isAnimalTribe`'s tech-graph signature, and `aggressive`/`cannotbeattacked` off `animaltypes.ini`.
 * The cross-civilization "all different tribes are enemies" rule (no alliances/neutrality yet) and the
 * "civ engages only aggressive animals, animals don't fight each other" simplifications are our
 * deterministic design pending an oracle (docs/FIDELITY.md "Civ-vs-animal aggression"). Pure over
 * `content`, no RNG/wall-clock.
 */
export function mayAttack(content: ContentSet, attackerTribe: number, targetTribe: number): boolean {
  if (attackerTribe === targetTribe) return false; // same tribe — friendly
  const attackerIsAnimal = isAnimalTribe(content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(content, targetTribe);
  // An animal attacker must be AGGRESSIVE to attack anything — a passive animal (a cow/deer, or a
  // known animal tribe with no animaltypes record) picks no fight. This is the authoritative gate, so
  // `mayAttack` is fully self-contained (a caller need not pre-filter the attacker); the combat loop's
  // matching skip is only a fast-path that avoids the target scan.
  if (attackerIsAnimal && !isAggressiveAnimal(content, attackerTribe)) return false;
  if (attackerIsAnimal && targetIsAnimal) return false; // animals don't war on each other (no oracle)
  if (targetIsAnimal) {
    // attacker is a civilization (or unknown — not an animal) hitting an animal: only a hostile,
    // non-exempt animal is a valid target. Passive prey and decorative fauna are left alone.
    return isAggressiveAnimal(content, targetTribe) && !animalCannotBeAttacked(content, targetTribe);
  }
  // target is a civilization (or unknown); the attacker is a civilization or an aggressive animal — enemy.
  return true;
}
