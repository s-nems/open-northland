import type { ContentSet } from '@open-northland/data';
import { animalCannotBeAttacked, isAggressiveAnimal, isCatchableAnimal } from './animals.js';
import { isAnimalTribe } from './civilizations.js';

/**
 * The data-pinned hunter trade — `jobtypes.ini` `type 15` / `logicdefines.inc` `JOB_TYPE_HUMAN_HUNTER 15`,
 * the civilization job that hunts game. A combatant of this job may strike {@link isCatchableAnimal} prey
 * ({@link mayHunt}); every tribe's hunter binds the same attack atomic (`setatomic 15 81 "..._hunter_attack"`,
 * verified in `DataCnmd/tribetypes12/tribetypes.ini`), so a hunter's strike reuses the combat `attack` atomic
 * + weapon/hit path. Kept next to the `mayHunt` relation it gates.
 */
export const HUNTER_JOB = 15;

/**
 * The predation relation — may a civilization combatant whose job is `attackerJobType` hunt the animal of
 * `targetTribe`? The prey side of the hunter mechanic, separate from the hostility relation {@link mayAttack}:
 * hunting is gated by the attacker's job (only a {@link HUNTER_JOB} hunter hunts), not by tribe-vs-tribe
 * hostility. The rules:
 *
 *  - The attacker must be a hunter (`attackerJobType === HUNTER_JOB`).
 *  - The target must be a {@link isCatchableAnimal} animal — huntable livestock per `animaltypes.ini`
 *    `catchable`. Wild-only fauna, a civilization, and an unknown tribe are not huntable prey.
 *  - A `cannotbeattacked` animal is still exempt (decorative bees) — the same target exemption
 *    {@link mayAttack} applies.
 *
 * Hunting is one direction only; a `catchable` `getAngry` prey struck by a hunter is provoked into fighting
 * back through the combat `Anger` path (the AtomicSystem's `attack` effect), not through this relation.
 *
 * Source basis: the prey set is the verbatim `catchable` param and the hunter trade is the pinned
 * `JOB_TYPE_HUMAN_HUNTER 15`; which prey a hunter picks and the absence of a walk-to-prey/harvest-cadaver
 * follow-up are approximated (source basis "Hunter strike on catchable prey").
 */
export function mayHunt(content: ContentSet, attackerJobType: number | null, targetTribe: number): boolean {
  if (attackerJobType !== HUNTER_JOB) return false; // only a hunter hunts
  if (!isCatchableAnimal(content, targetTribe)) return false; // only catchable prey is huntable
  if (animalCannotBeAttacked(content, targetTribe)) return false; // decorative fauna stay exempt
  return true;
}

/**
 * The combat hostility relation — may a combatant of `attackerTribe` swing at a combatant of `targetTribe`?
 * The single source of truth the CombatSystem's targeting drive (`conflict/targeting.ts`) consults for both
 * attacker-eligibility and the per-candidate target check. The rules, in order:
 *
 *  - Same tribe → no (friendly fire is off).
 *  - Both animals → no. Animals don't fight each other in this slice (no oracle); an animal's only combat is
 *    with civilizations.
 *  - Civilization vs civilization (different tribes) → yes. A different-tribe combatant with no record at all
 *    (an unknown tribe — a synthetic test enemy) is not an animal, so this branch treats it as a civilization
 *    and a valid enemy (the three-truth-states rule — see AGENTS.md `[fe2470f]`: `!isPlayableTribe` ≠
 *    `isAnimalTribe`).
 *  - Civilization → animal → yes only if the animal is {@link isAggressiveAnimal} and not
 *    {@link animalCannotBeAttacked}. A civ engages a hostile animal but not passive prey (hunting is the
 *    separate `catchable`/hunter mechanic); a `cannotbeattacked` animal (bees) is exempt entirely.
 *  - Animal attacker must be aggressive. A passive animal attacks nothing — so an aggressive animal →
 *    civilization is the unprovoked aggression driver (a bear/wolf attacks a nearby settler). This makes
 *    `mayAttack` self-contained (it gates the attacker side itself); `cannotbeattacked` gates only being a
 *    target, so an aggressive but `cannotbeattacked` animal can still attack a civ.
 *
 * Source basis: the gate reads the faithful extracted params — the civ-vs-animal split off `isAnimalTribe`'s
 * tech-graph signature, and `aggressive`/`cannotbeattacked` off `animaltypes.ini`. The "all different tribes
 * are enemies" rule (no alliances yet) and the "civ engages only aggressive animals, animals don't fight each
 * other" simplifications are our deterministic design pending an oracle (source basis "Civ-vs-animal
 * aggression").
 */
export function mayAttack(content: ContentSet, attackerTribe: number, targetTribe: number): boolean {
  if (attackerTribe === targetTribe) return false; // same tribe — friendly
  const attackerIsAnimal = isAnimalTribe(content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(content, targetTribe);
  // An animal attacker must be aggressive to attack anything — a passive animal picks no fight. The
  // authoritative gate, so `mayAttack` is self-contained; the combat loop's matching skip is only a fast-path
  // that avoids the target scan.
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
