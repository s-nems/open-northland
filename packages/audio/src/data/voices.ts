import type { HumanVoices } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import type { SoundIndex } from './bank.js';
import { creatureTribe, isPerson, settlerJob, voiceClassOf } from './snapshot.js';

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
 * as the original indexes by the human's array slot, except a hero always takes the first pool. Two
 * job-specific silences (the original appears to mute tribe 3 job 32 and tribe 2 job 42, unconfirmed
 * in play) are not reproduced. Undefined for a tribe and class that answers with nothing (a child, an
 * animal).
 */
export function responseGroup(index: SoundIndex, e: EntitySnapshot): string | undefined {
  return lifelongPool(index, e, humanVoicesOf(index, e)?.respondOk);
}

/**
 * The "no" pool a settler refuses with, picked like its {@link responseGroup}, so one settler keeps one
 * actor for both. The original never plays these pools; a refusal voice is our choice.
 */
export function refusalGroup(index: SoundIndex, e: EntitySnapshot): string | undefined {
  return lifelongPool(index, e, humanVoicesOf(index, e)?.respondNo);
}

function lifelongPool(
  index: SoundIndex,
  e: EntitySnapshot,
  pools: readonly string[] | undefined,
): string | undefined {
  if (pools === undefined || pools.length === 0) return undefined;
  const job = settlerJob(e.components);
  const voiceIndex = job !== undefined && job !== null && index.heroJobs.has(job) ? 0 : e.id;
  return pools[voiceIndex % pools.length];
}

/** The murmur pool ({@link import('./bank.js').TRIBE_MURMUR_GROUPS}) a grown settler's tribe and class
 *  lays under a large group's answer, or undefined for a child, an animal or a tribe without one. */
export function murmurGroup(index: SoundIndex, e: EntitySnapshot): string | undefined {
  if (!isPerson(e.components)) return undefined;
  const tribe = creatureTribe(e.components);
  const voiceClass = voiceClassOf(e.components);
  if (tribe === undefined || voiceClass === 'child') return undefined;
  const row = index.murmurByTribe.get(tribe);
  return row?.[voiceClass] ?? row?.male;
}
