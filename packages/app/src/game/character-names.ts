import { VIKING } from '../catalog/buildings.js';

/**
 * Per-settler personal names, shown in the details panel in place of the generic "Ogólne" section title.
 *
 * A name is a first name plus a surname — "Bjørn Ulfsson", "Astrid Sveinsdóttir". Today every settler
 * carries their OWN patronymic surname (son/daughter of a father's name), so the space is the CROSS
 * PRODUCT of the first-name and father-name pools, not a flat list, and both parts vary per settler.
 *
 * Family-ready (no sim family system exists yet): the surname is resolved through a single seam so a
 * future marriage/lineage system can pass a husband's or father's entity id and the wife + children then
 * inherit that person's surname verbatim (see the `surnameFromEntityId` argument of {@link characterName}).
 *
 * These names are COSMETIC and DERIVED, not sim state: a settler's name is a pure function of its tribe,
 * sex and stable entity id, so the same settler always shows the same name and nothing here touches the
 * deterministic sim or its golden hashes. The original game assigns no per-settler names, so the pools are
 * a clean-room approximation (see `NAME_POOLS`) — named as such, not pinned to extracted data.
 *
 * Extensible by faction: add a tribe's pools to {@link NAME_POOLS} and settlers of that tribe get its
 * names automatically. Only the viking pool exists today (the one tribe in the current content); any other
 * tribe falls back to it until its own pool is added.
 */

export type Sex = 'male' | 'female';

interface NamePool {
  /** Male given names. Also the source of PATRONYMIC roots (a father's name is a male given name). */
  readonly male: readonly string[];
  /** Female given names. */
  readonly female: readonly string[];
}

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
 * Map a stable id onto an (first, root) cell of the `firstCount × rootCount` name grid. The coprime
 * scatter (above) makes this a bijection over the grid, so distinct ids give distinct name pairs up to the
 * full `firstCount × rootCount` before any repeat, while consecutive ids still land far apart. A degenerate
 * empty pool (`m === 0`) has no cell to pick, so return the zero cell instead of dividing by zero.
 */
function nameGridCell(id: number, firstCount: number, rootCount: number): { first: number; root: number } {
  const m = firstCount * rootCount;
  if (m <= 0) return { first: 0, root: 0 };
  const scattered = ((((id % m) + m) % m) * coprimeMultiplier(m)) % m;
  return { first: scattered % firstCount, root: Math.floor(scattered / firstCount) };
}

/**
 * The sex/age `jobType` ids that carry a fixed body sex, transcribed from the same `jobtypes.ini`
 * semantics the render body-join uses (`content/settler-gfx.ts` `YOUNG_CHARACTER_BY_JOB` maps job 1
 * baby_female / 2 baby_male / 3 child_female / 4 child_male; the adult woman is job 5). Named per the
 * no-magic-numbers rule so the sex classifier reads by meaning. Every other job draws a male body.
 */
const BABY_FEMALE_JOB = 1;
const GIRL_JOB = 3;
const WOMAN_JOB = 5;

/**
 * The sex of the body a settler draws, mirroring `content/settler-gfx.ts` so a name never contradicts the
 * on-screen character. Young settlers (those carrying an `Age` component) key the age-class jobs: the two
 * female child bodies (baby_female 1, girl 3) are female, the male ones (baby_male 2, boy 4) male. Adults
 * are female only for the woman job (5); every other adult job draws the male body. (The two baby jobs draw
 * one sex-neutral `baby` body, so a baby's sex only shows through its name, not its sprite.) Pure + total.
 */
export function settlerSex(jobType: number | null | undefined, young: boolean): Sex {
  if (young) return jobType === BABY_FEMALE_JOB || jobType === GIRL_JOB ? 'female' : 'male';
  return jobType === WOMAN_JOB ? 'female' : 'male';
}

/**
 * Clean-room Old Norse given names, split by sex to match the drawn body. Drawn from common historical
 * Norse name lists; the original game carries none of these, so this is an independent approximation, not
 * extracted content.
 *
 * With the surname cross product (see {@link characterName}) these give 101 × 101 = 10 201 distinct male
 * full names and 72 × 101 = 7 272 female ones. The male pool is the larger because male settlers heavily
 * outnumber female ones, so more of them need distinct names; both counts sit far past any real settlement,
 * so a repeat is very rare. The pools stay finite on purpose (a name stock is finite), but large enough
 * that duplicates effectively never surface in play.
 */
const VIKING_NAMES: NamePool = {
  male: [
    'Ragnar',
    'Bjørn',
    'Leif',
    'Sten',
    'Ivar',
    'Ulf',
    'Harald',
    'Sigurd',
    'Knut',
    'Torstein',
    'Halfdan',
    'Egil',
    'Gunnar',
    'Rollo',
    'Sven',
    'Arne',
    'Vidar',
    'Erik',
    'Hakon',
    'Frode',
    'Orm',
    'Toke',
    'Vali',
    'Asger',
    'Grim',
    'Kettil',
    'Vagn',
    'Hemming',
    'Ottar',
    'Rurik',
    'Guthorm',
    'Sigtrygg',
    'Thorvald',
    'Thorolf',
    'Ospak',
    'Hallstein',
    'Ingolf',
    'Floki',
    'Ubbe',
    'Hastein',
    'Njal',
    'Skarde',
    'Gorm',
    'Thrand',
    'Onund',
    'Steinar',
    'Hallvard',
    'Kolbein',
    'Eystein',
    'Ozur',
    'Amund',
    'Trygve',
    'Snorri',
    'Yngvar',
    'Dag',
    'Alrek',
    'Hrolf',
    'Sigmund',
    'Bo',
    'Refil',
    'Eskil',
    'Bergthor',
    'Kolgrim',
    'Thorgils',
    'Audun',
    'Birger',
    'Brand',
    'Eindride',
    'Finn',
    'Geir',
    'Gisli',
    'Grettir',
    'Haki',
    'Hallbjorn',
    'Hauk',
    'Ingimar',
    'Jorund',
    'Kari',
    'Kjartan',
    'Kveldulf',
    'Magnus',
    'Mord',
    'Odd',
    'Ofeig',
    'Ragnvald',
    'Roar',
    'Sigvat',
    'Skallagrim',
    'Solmund',
    'Starkad',
    'Sumarlidi',
    'Thorbjorn',
    'Thorfinn',
    'Thorgrim',
    'Thorir',
    'Thorkell',
    'Torgeir',
    'Ulfar',
    'Vemund',
    'Vestein',
    'Yngvi',
  ],
  female: [
    'Astrid',
    'Freya',
    'Sigrid',
    'Ingrid',
    'Helga',
    'Gunnhild',
    'Thyra',
    'Solveig',
    'Ragnhild',
    'Bodil',
    'Hilde',
    'Yrsa',
    'Signe',
    'Gudrun',
    'Liv',
    'Randi',
    'Tove',
    'Estrid',
    'Runa',
    'Alfhild',
    'Thora',
    'Ragna',
    'Ingeborg',
    'Gyda',
    'Aslaug',
    'Bergljot',
    'Dagny',
    'Eir',
    'Frida',
    'Gerd',
    'Groa',
    'Halldis',
    'Herdis',
    'Hervor',
    'Jofrid',
    'Kelda',
    'Ljufa',
    'Nanna',
    'Oddny',
    'Ragnfrid',
    'Saga',
    'Sunniva',
    'Svanhild',
    'Thurid',
    'Torhild',
    'Ulfhild',
    'Unn',
    'Vigdis',
    'Yngvild',
    'Aud',
    'Bera',
    'Borghild',
    'Disa',
    'Eldrid',
    'Gunnvor',
    'Hallgerd',
    'Idunn',
    'Jorunn',
    'Katla',
    'Ljot',
    'Ragnborg',
    'Signy',
    'Thordis',
    'Vilborg',
    'Asa',
    'Bothild',
    'Geirlaug',
    'Holmfrid',
    'Ingrun',
    'Osk',
    'Thorgunna',
    'Yr',
  ],
};

/** Name pools by tribe. Add a faction here to give its settlers faction-appropriate names. */
const NAME_POOLS: Readonly<Record<number, NamePool>> = {
  [VIKING]: VIKING_NAMES,
};

/** The pool used for a tribe that has no pool of its own yet — the only content tribe today is viking. */
const FALLBACK_POOL = VIKING_NAMES;

/**
 * The personal name shown for a settler — a faction- and sex-appropriate first name plus a surname
 * ("Bjørn Ulfsson", "Astrid Sveinsdóttir"), stable per entity and derived purely from ids (nothing here
 * touches sim state). Both parts come from a coprime grid permutation of the stable entity id, so distinct
 * settlers get distinct names up to the full first × father grid, and settlers spawned with clustered ids
 * still get well-spread names rather than a shared surname.
 *
 * Family seam — `surnameFromEntityId`: with no sim marriage/lineage system yet, every settler carries their
 * OWN patronymic (a woman's ends `-sdóttir`, a man's `-sson`). When such a system exists, pass the husband's
 * (for a wife) or father's (for a child) entity id here: the settler then inherits THAT person's surname
 * verbatim — the male `-sson` patronymic of the same father-name — so a whole household shares one surname.
 *
 * Precondition: `surnameFromEntityId` must be a MALE entity (a husband/father). The inherited surname
 * equals that entity's OWN displayed surname only because both resolve on the male grid, which holds only
 * for a male owner — patronymic inheritance always flows from the father, so that is the correct contract.
 */
export function characterName(
  tribe: number,
  jobType: number | null | undefined,
  young: boolean,
  entityId: number,
  surnameFromEntityId?: number,
): string {
  const pool = NAME_POOLS[tribe] ?? FALLBACK_POOL;
  const sex = settlerSex(jobType, young);
  const firstNames = pool[sex];
  const fatherNames = pool.male; // a surname is a patronymic of a (male) father's given name
  const first = firstNames[nameGridCell(entityId, firstNames.length, fatherNames.length).first] as string;

  // The surname: inherited from a husband/father when the family seam supplies one, else the settler's own.
  // An inherited surname is always the male `-sson` form of that person's father-name — the whole household
  // shares it; an own surname takes the settler's sex. The father-name is picked on the MALE grid so a man
  // and every relative resolving to his id land on the same root.
  const inherited = surnameFromEntityId !== undefined;
  const surnameOwnerId = surnameFromEntityId ?? entityId;
  const rootGridWidth = inherited ? fatherNames.length : firstNames.length;
  const father = fatherNames[nameGridCell(surnameOwnerId, rootGridWidth, fatherNames.length).root] as string;
  const suffix = inherited ? PATRONYMIC_SUFFIX.male : PATRONYMIC_SUFFIX[sex];
  return `${first} ${father}${suffix}`;
}
