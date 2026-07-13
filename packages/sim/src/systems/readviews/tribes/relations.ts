import type { ContentSet } from '@vinland/data';
import { animalCannotBeAttacked, isAggressiveAnimal, isCatchableAnimal } from './animals.js';
import { isAnimalTribe } from './civilizations.js';

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
 * source-basis: the prey set is the verbatim `catchable` param and the hunter trade is the pinned
 * `JOB_TYPE_HUMAN_HUNTER 15`; *which* prey a hunter picks (nearest in range) and the absence of a
 * walk-to-prey/harvest-cadaver follow-up are approximated (source basis "Hunter strike on catchable
 * prey").
 */
export function mayHunt(content: ContentSet, attackerJobType: number | null, targetTribe: number): boolean {
  if (attackerJobType !== HUNTER_JOB) return false; // only a hunter hunts
  if (!isCatchableAnimal(content, targetTribe)) return false; // only catchable prey is huntable
  if (animalCannotBeAttacked(content, targetTribe)) return false; // decorative fauna stay exempt
  return true;
}

/**
 * The **combat hostility relation** — may a combatant of `attackerTribe` swing at a combatant of
 * `targetTribe`? The single source of truth the CombatSystem's targeting drive (`conflict/targeting.ts`)
 * consults for *both* the attacker-eligibility check and the per-candidate target check, so the two
 * directions of a fight stay consistent. The rules, in order:
 *
 *  - **Same tribe → no** (friendly fire is off; a tribe never wars on itself).
 *  - **Both animals → no.** Animals don't fight each other in this slice (no oracle for inter-species
 *    wildlife aggression); an animal's only combat is with civilizations.
 *  - **Civilization vs civilization (different tribes) → yes** — the player-vs-player drive. A
 *    different-tribe combatant with **no** record at all (an unknown tribe — a synthetic test enemy) is
 *    NOT an animal, so this branch treats it as a civilization and a valid enemy (the three-truth-states
 *    rule — see AGENTS.md `[fe2470f]`: `!isPlayableTribe` ≠ `isAnimalTribe`).
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
 * source-basis: the hostility gate reads the faithful extracted params — the civ-vs-animal split off
 * `isAnimalTribe`'s tech-graph signature, and `aggressive`/`cannotbeattacked` off `animaltypes.ini`.
 * The cross-civilization "all different tribes are enemies" rule (no alliances/neutrality yet) and the
 * "civ engages only aggressive animals, animals don't fight each other" simplifications are our
 * deterministic design pending an oracle (source basis "Civ-vs-animal aggression"). Pure over
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
