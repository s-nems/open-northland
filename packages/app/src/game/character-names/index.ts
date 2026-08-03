import { JOB_BABY_FEMALE, JOB_CHILD_FEMALE, JOB_WOMAN } from '../../catalog/jobs.js';
import { FALLBACK_POOL, NAME_POOLS } from './pools.js';

/**
 * Per-settler personal names: a first name plus a patronymic surname, over the first-name by
 * father-name cross product. Cosmetic and derived, not sim state - a name is a pure function of tribe,
 * sex and stable entity id, so nothing here touches the sim or its golden hashes.
 */

export type Sex = 'male' | 'female';

/** Patronymic endings appended to the father's given name: "Ulf" → "Ulfsson" / "Ulfsdóttir". */
const PATRONYMIC_SUFFIX: Readonly<Record<Sex, string>> = {
  male: 'sson',
  female: 'sdóttir',
};

/** The golden ratio's conjugate: the multiplier fraction that spreads consecutive ids most evenly. */
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

function gcd(x: number, y: number): number {
  let a = x;
  let b = y;
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

/**
 * A multiplier coprime to `m`, near the golden-ratio fraction of `m`. Multiplying an id by it mod `m` is
 * a bijection that scatters consecutive ids across the whole range, so a batch of settlers spawned with
 * clustered ids gets spread names. `m <= 1` has no non-trivial multiplier and would loop forever.
 */
function coprimeMultiplier(m: number): number {
  if (m <= 1) return 1;
  let a = Math.max(2, Math.floor(m * GOLDEN_RATIO_CONJUGATE));
  while (gcd(a, m) !== 1) a++;
  return a;
}

/**
 * Map a stable id onto a `(first, root)` cell of the `firstCount × rootCount` name grid. The coprime
 * scatter makes this a bijection, so distinct ids give distinct pairs until the grid is full.
 */
function nameGridCell(id: number, firstCount: number, rootCount: number): { first: number; root: number } {
  const m = firstCount * rootCount;
  if (m <= 0) return { first: 0, root: 0 };
  const scattered = ((((id % m) + m) % m) * coprimeMultiplier(m)) % m;
  return { first: scattered % firstCount, root: Math.floor(scattered / firstCount) };
}

/**
 * The sex of the body a settler draws, mirroring `content/settler-gfx.ts` so a name never contradicts
 * the on-screen character. Only the woman job draws a female adult body; the two baby jobs share one
 * sex-neutral body, so a baby's sex shows through its name alone.
 */
export function settlerSex(jobType: number | null | undefined, young: boolean): Sex {
  if (young) return jobType === JOB_BABY_FEMALE || jobType === JOB_CHILD_FEMALE ? 'female' : 'male';
  return jobType === JOB_WOMAN ? 'female' : 'male';
}

/**
 * The personal name shown for a settler: a faction- and sex-appropriate first name plus a surname, both
 * picked from a {@link nameGridCell} permutation of the stable entity id. Passing a husband's or
 * father's id as `surnameFromEntityId` makes the settler inherit that person's surname, so a household
 * shares one. That id must be male: the inherited surname matches its owner's displayed one only
 * because both resolve on the male grid.
 */
export function characterName(
  tribe: number,
  jobType: number | null | undefined,
  young: boolean,
  entityId: number,
  surnameFromEntityId?: number,
  female?: boolean,
): string {
  const pool = NAME_POOLS[tribe] ?? FALLBACK_POOL;
  // The sim's persistent `Female` marker wins when the caller has it, so a woman re-professioned into a
  // trade keeps her name; the jobType inference is the fallback for callers without a snapshot.
  const sex = female === undefined ? settlerSex(jobType, young) : female ? 'female' : 'male';
  const firstNames = pool[sex];
  const fatherNames = pool.male; // a surname is a patronymic of a male father's given name
  const first = firstNames[nameGridCell(entityId, firstNames.length, fatherNames.length).first] as string;

  // The father-name resolves on the male grid, so a man and every relative pointing at him share a root.
  const inherited = surnameFromEntityId !== undefined;
  const surnameOwnerId = surnameFromEntityId ?? entityId;
  const rootGridWidth = inherited ? fatherNames.length : firstNames.length;
  const father = fatherNames[nameGridCell(surnameOwnerId, rootGridWidth, fatherNames.length).root] as string;
  const suffix = inherited ? PATRONYMIC_SUFFIX.male : PATRONYMIC_SUFFIX[sex];
  return `${first} ${father}${suffix}`;
}
