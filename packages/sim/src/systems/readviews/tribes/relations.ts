import type { ContentSet } from '@open-northland/data';
import { isHunterJob } from '../jobs.js';
import { animalCannotBeAttacked, isAggressiveAnimal, isAnimalTribe, isHuntablePrey } from './animals.js';

/**
 * The predation relation, gated by the attacker's job rather than by tribe hostility, and one direction
 * only: provoked prey fights back through the combat `Anger` path instead. The last-resort ordering is the
 * target search's tiering, not this pairwise relation.
 */
export function mayHunt(content: ContentSet, attackerJobType: number | null, targetTribe: number): boolean {
  if (!isHunterJob(content, attackerJobType)) return false;
  if (!isHuntablePrey(content, targetTribe)) return false;
  if (animalCannotBeAttacked(content, targetTribe)) return false; // decorative fauna stay exempt
  return true;
}

/**
 * The combat hostility relation, and the single gate the targeting drive consults for both attacker
 * eligibility and the per-candidate check. A different-tribe combatant with no record at all is not an
 * animal, so it counts as a civilization and a valid enemy.
 *
 * The extracted params are faithful: the civ-versus-animal split off the `[animaltype]` record and
 * `aggressive`/`cannotbeattacked` off its own flags. Approximation: every different tribe is an enemy,
 * a civilization engages only aggressive animals, and animals never fight each other.
 */
export function mayAttack(content: ContentSet, attackerTribe: number, targetTribe: number): boolean {
  if (attackerTribe === targetTribe) return false;
  const attackerIsAnimal = isAnimalTribe(content, attackerTribe);
  const targetIsAnimal = isAnimalTribe(content, targetTribe);
  // The authoritative attacker gate. The combat loop's matching skip is only a fast path around the scan.
  if (attackerIsAnimal && !isAggressiveAnimal(content, attackerTribe)) return false;
  if (attackerIsAnimal && targetIsAnimal) return false;
  if (targetIsAnimal) {
    // A civilization leaves passive prey and decorative fauna alone; hunting them is `mayHunt`'s business.
    return isAggressiveAnimal(content, targetTribe) && !animalCannotBeAttacked(content, targetTribe);
  }
  return true;
}
