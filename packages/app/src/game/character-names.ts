import { JOB_BABY_FEMALE, JOB_CHILD_FEMALE, JOB_WOMAN } from '../catalog/jobs.js';
import { FALLBACK_POOL, NAME_POOLS } from './character-names/pools.js';

/**
 * Per-settler personal names, shown in the details panel in place of the generic "Ogólne" section title.
 * A name is a first name plus a patronymic surname — "Bjørn Ulfsson", "Astrid Sveinsdóttir" — over the
 * first-name × father-name cross product.
 *
 * These names are cosmetic and derived, not sim state: a settler's name is a pure function of its tribe,
 * sex and stable entity id, so nothing here touches the deterministic sim or its golden hashes.
 */

export type Sex = 'male' | 'female';

/** Patronymic endings appended to the father's given name: "Ulf" → "Ulfsson" / "Ulfsdóttir". */
const PATRONYMIC_SUFFIX: Readonly<Record<Sex, string>> = {
  male: 'sson',
  female: 'sdóttir',
};

/** The golden ratio's conjugate — the multiplier fraction that spreads consecutive ids most evenly. */
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
 * A multiplier coprime to `m`, near the golden-ratio fraction of `m`. Multiplying an id by it (mod `m`)
 * is a bijection that scatters *consecutive* ids across the whole range — so a batch of settlers spawned
 * with clustered ids gets well-spread names instead of all sharing one (the "everyone Ragnarsson" bug).
 * `m <= 1` (a degenerate/empty pool) has no non-trivial multiplier and would loop forever, so return 1.
 */
function coprimeMultiplier(m: number): number {
  if (m <= 1) return 1;
  let a = Math.max(2, Math.floor(m * GOLDEN_RATIO_CONJUGATE));
  while (gcd(a, m) !== 1) a++;
  return a;
}

/**
 * Map a stable id onto a (first, root) cell of the `firstCount × rootCount` name grid. The coprime scatter
 * makes this a bijection, so distinct ids give distinct name pairs up to the full grid before any repeat.
 * A degenerate empty pool (`m === 0`) has no cell to pick, so return the zero cell instead of dividing by
 * zero.
 */
function nameGridCell(id: number, firstCount: number, rootCount: number): { first: number; root: number } {
  const m = firstCount * rootCount;
  if (m <= 0) return { first: 0, root: 0 };
  const scattered = ((((id % m) + m) % m) * coprimeMultiplier(m)) % m;
  return { first: scattered % firstCount, root: Math.floor(scattered / firstCount) };
}

/**
 * The sex of the body a settler draws, mirroring `content/settler-gfx.ts` so a name never contradicts the
 * on-screen character. Young settlers (those carrying an `Age` component) key the age-class jobs: the two
 * female child bodies (baby_female 1, girl 3) are female, the male ones (baby_male 2, boy 4) male. Adults
 * are female only for the woman job (5); every other adult job draws the male body. (The two baby jobs draw
 * one sex-neutral `baby` body, so a baby's sex only shows through its name, not its sprite.)
 */
export function settlerSex(jobType: number | null | undefined, young: boolean): Sex {
  if (young) return jobType === JOB_BABY_FEMALE || jobType === JOB_CHILD_FEMALE ? 'female' : 'male';
  return jobType === JOB_WOMAN ? 'female' : 'male';
}

/**
 * The personal name shown for a settler: a faction- and sex-appropriate first name plus a surname, both
 * picked from a {@link nameGridCell} permutation of the stable entity id.
 *
 * Family seam — `surnameFromEntityId`: with no sim marriage/lineage system yet, every settler carries their
 * own patronymic (a woman's ends `-sdóttir`, a man's `-sson`). When such a system exists, pass the husband's
 * (for a wife) or father's (for a child) entity id here: the settler then inherits that person's surname
 * verbatim — the male `-sson` patronymic of the same father-name — so a whole household shares one surname.
 *
 * Precondition: `surnameFromEntityId` must be a male entity (a husband/father). The inherited surname equals
 * that owner's own displayed surname only because both resolve on the male grid, which holds for a male
 * owner alone.
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
  // The sim's persistent `Female` marker wins when the caller has it (a woman re-professioned into a
  // trade keeps her name); the jobType inference remains the fallback for callers without a snapshot.
  const sex = female === undefined ? settlerSex(jobType, young) : female ? 'female' : 'male';
  const firstNames = pool[sex];
  const fatherNames = pool.male; // a surname is a patronymic of a (male) father's given name
  const first = firstNames[nameGridCell(entityId, firstNames.length, fatherNames.length).first] as string;

  // The father-name is picked on the male grid so a man and every relative resolving to his id land on the
  // same root.
  const inherited = surnameFromEntityId !== undefined;
  const surnameOwnerId = surnameFromEntityId ?? entityId;
  const rootGridWidth = inherited ? fatherNames.length : firstNames.length;
  const father = fatherNames[nameGridCell(surnameOwnerId, rootGridWidth, fatherNames.length).root] as string;
  const suffix = inherited ? PATRONYMIC_SUFFIX.male : PATRONYMIC_SUFFIX[sex];
  return `${first} ${father}${suffix}`;
}
