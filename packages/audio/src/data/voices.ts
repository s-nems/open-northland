import type { HumanVoices } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import { groupFiles, type SoundIndex } from './bank.js';
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

/**
 * Each "ok" pool's shortest line by its audible span (onset to the last sound above -40 dBFS), measured
 * on the decoded bank, keyed by the lower-cased pool name: the quick "Jo" a selected settler answers
 * with. Authored here because the bank carries no durations.
 */
export const SELECT_LINES: ReadonlyMap<string, string> = new Map([
  ['viking male ok 13', 'humantalk/m13ok01.wav'],
  ['viking male ok 01', 'humantalk/m1ok02.wav'],
  ['viking male ok 02', 'humantalk/m2ok08.wav'],
  ['viking male ok 03', 'humantalk/m3ok05.wav'],
  ['viking male ok 04', 'humantalk/m4ok07.wav'],
  ['viking male ok 05', 'humantalk/m5ok03.wav'],
  ['viking male ok 06', 'humantalk/m6ok01.wav'],
  ['viking male ok 07', 'humantalk/m7ok01.wav'],
  ['viking male ok 08', 'humantalk/m8ok01.wav'],
  ['viking male ok 09', 'humantalk/m9ok02.wav'],
  ['viking male ok 10', 'humantalk/m10ok01.wav'],
  ['viking male ok 11', 'humantalk/m11ok01.wav'],
  ['viking male ok 12', 'humantalk/m12ok01.wav'],
  ['viking female ok 01', 'humantalk/f1ok01.wav'],
  ['viking female ok 02', 'humantalk/f2ok01.wav'],
  ['viking female ok 03', 'humantalk/f3ok01.wav'],
  ['viking female ok 04', 'humantalk/f4ok01.wav'],
  ['viking female ok 05', 'humantalk/f5ok01.wav'],
  ['viking female ok 06', 'humantalk/f6ok01.wav'],
  ['frank male ok 01', 'humantalk/oldenglish/o33.wav'],
  ['frank male ok 02', 'humantalk/oldenglish/o19.wav'],
  ['frank male ok 03', 'humantalk/oldenglish/o32.wav'],
  ['frank female ok 01', 'humantalk/f1ok01.wav'],
  ['latin male ok 01', 'humantalk/latin/l41.wav'],
  ['latin male ok 02', 'humantalk/latin/l15.wav'],
  ['latin male ok 03', 'humantalk/latin/l18.wav'],
  ['latin female ok 01', 'humantalk/latin/l80.wav'],
  ['latin female ok 02', 'humantalk/latin/l84.wav'],
  ['latin female ok 03', 'humantalk/latin/l88.wav'],
  ['latin female ok 04', 'humantalk/latin/l92.wav'],
  ['latin female ok 05', 'humantalk/latin/l96.wav'],
  ['latin female ok 06', 'humantalk/latin/l100.wav'],
  ['arabian male ok 01', 'humantalk/arabian/a05.wav'],
  ['arabian male ok 02', 'humantalk/arabian/a10.wav'],
  ['arabian male ok 03', 'humantalk/arabian/a11.wav'],
]);

/**
 * The one line a selected settler answers with: its pool's {@link SELECT_LINES} entry, else for a pool
 * the table does not name the shortest wav by decoded length once every one has decoded, else its first.
 */
export function selectLine(
  index: SoundIndex,
  group: string,
  clipLengthS?: (file: string) => number | undefined,
): string | undefined {
  const files = groupFiles(index, group);
  if (files === undefined) return undefined;
  const authored = SELECT_LINES.get(group.toLowerCase());
  if (authored !== undefined && files.includes(authored)) return authored;
  let shortest: { readonly file: string; readonly length: number } | undefined;
  for (const file of files) {
    const length = clipLengthS?.(file);
    if (length === undefined) return files[0];
    if (shortest === undefined || length < shortest.length) shortest = { file, length };
  }
  return shortest?.file;
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
