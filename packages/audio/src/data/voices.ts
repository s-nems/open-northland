import type { HumanVoices } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import type { SoundIndex } from './bank.js';
import { creatureTribe, isPerson, voiceClassOf } from './snapshot.js';

/** Which of the `humans/sounds.cif` voice rows a snapshot person speaks with. */

/** The voice row a person speaks with: its tribe's pool for its class, or undefined when the tribe
 *  leaves that class silent or the entity is no person. */
export function humanVoicesOf(index: SoundIndex, e: EntitySnapshot): HumanVoices | undefined {
  if (!isPerson(e.components)) return undefined;
  const tribe = creatureTribe(e.components);
  if (tribe === undefined) return undefined;
  return index.humanVoices.get(tribe)?.get(voiceClassOf(e.components));
}

/**
 * The "ok" pool a settler answers with for life: its pools indexed by its entity id modulo their count,
 * as the original indexes by the human's array slot. Approximations: a hero there always takes the
 * first pool, and two job-specific silences (`PlayRespondingSound` mutes tribe 3 job 32 and tribe 2 job
 * 42) are not reproduced. Undefined for a tribe and class that answers with nothing (a child, an animal).
 */
export function responseGroup(index: SoundIndex, e: EntitySnapshot): string | undefined {
  const voices = humanVoicesOf(index, e);
  if (voices === undefined || voices.respondOk.length === 0) return undefined;
  return voices.respondOk[e.id % voices.respondOk.length];
}
