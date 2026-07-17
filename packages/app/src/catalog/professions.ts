import { categoryLabel, type Locale, type Messages, professionLabel } from '../i18n/index.js';
import {
  JOB_ARMORER,
  JOB_BAKER,
  JOB_BREEDER,
  JOB_BREWER,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_COIN_MAKER,
  JOB_COLLECTOR,
  JOB_DRUID,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HERBALIST,
  JOB_HUNTER,
  JOB_JESTER,
  JOB_JOINER,
  JOB_MASON,
  JOB_MILLER,
  JOB_POTTER,
  JOB_SCOUT,
  JOB_SMITH,
  JOB_SOLDIER,
  JOB_TAILOR,
  JOB_TRADER,
  SOLDIER_JOB_MAX,
  SOLDIER_JOB_MIN,
} from './jobs.js';

/**
 * The committed hand-authored profession roster — the complete set of jobs a player can assign a settler to,
 * transcribed from the original `Data/logic/jobtypes.ini` (`[jobtype]` records). This is the source of
 * truth for both the profession picker (what it offers + which job each row assigns) and the settler
 * details-panel label (a settler's profession name), so the two can never drift.
 *
 * Faithfulness to the original's job model:
 *  - **One soldier.** `jobtypes.ini` splits soldiers into an unarmed base (type 31) plus ten weapon
 *    classes (32..41: spear/sword/saber/axe/bow). A settler's soldier class is its weapon, not a separate
 *    profession — so the picker offers a single "Żołnierz" that assigns the unarmed base ({@link JOB_SOLDIER}
 *    = 31); the weapon (a later step) specializes it. Only a soldier ever carries a weapon (weapons resolve
 *    by `(tribe, jobType)`, and no civilian trade has a binding), so a civilian is always unarmed.
 *  - **Life stages, animals, vehicles, and named heroes are not professions** (jobtypes 1..6, 42..55) and
 *    are omitted. Sea variants (`fisher_sea` 23, `trader_sea` 26) are omitted too: they need a harbour/ship
 *    the sandbox lacks. Collecting is the single `collector` ({@link JOB_COLLECTOR} = 8): the original's one
 *    outdoor gatherer fells wood, mines every deposit, and picks mushrooms, so there is one gatherer row.
 *
 * jobType numbering: every row carries its real `jobtypes.ini` id (collector 8, carrier 24, soldier 31, and
 * the production trades at their own ids). The synthetic per-good gatherer band that used to shadow
 * baker/brewer/fisher/trader (real ids 20..22, 25) is gone, so those trades now sit at their real ids too.
 *
 * The added trades render as the generic civilian body (only jobtypes 5 and 31..41 have their own body in
 * `content/settler-gfx.ts`); in the current sandbox they have no workhouse, so an assigned smith/baker/…
 * stands idle until the economy content lands — exactly as the original gates a trade on its workshop.
 */

/** The picker's five ordered groups (the list is sorted by this order, with a header per group). */
export type ProfessionCategory = keyof Messages['category'];

/** One assignable profession: its i18n key, the job `setJob` assigns, its picker group, and its source. */
export interface ProfessionDef {
  readonly key: keyof Messages['profession'];
  readonly jobType: number;
  readonly category: ProfessionCategory;
  /** The `jobtypes.ini` record this row transcribes (the faithfulness anchor). */
  readonly source: string;
}

/** True for any job in the `jobtypes.ini` soldier band (31..41) — all collapse to the one soldier label. */
export function isSoldierJob(jobType: number): boolean {
  return jobType >= SOLDIER_JOB_MIN && jobType <= SOLDIER_JOB_MAX;
}

/**
 * The complete roster, in picker order (gathering → transport → production → special → military). The
 * order here is the list order; `pickerEntries` inserts a group header wherever the category changes.
 */
export const PROFESSIONS: readonly ProfessionDef[] = [
  { key: 'collector', jobType: JOB_COLLECTOR, category: 'gathering', source: 'jobtypes.ini 8 "collector"' },
  { key: 'carrier', jobType: JOB_CARRIER, category: 'transport', source: 'jobtypes.ini 24 "carrier"' },
  { key: 'builder', jobType: JOB_BUILDER, category: 'production', source: 'jobtypes.ini 7 "builder"' },
  { key: 'joiner', jobType: JOB_JOINER, category: 'production', source: 'jobtypes.ini 9 "joiner"' },
  { key: 'armorer', jobType: JOB_ARMORER, category: 'production', source: 'jobtypes.ini 10 "armorer"' },
  { key: 'potter', jobType: JOB_POTTER, category: 'production', source: 'jobtypes.ini 11 "potter"' },
  { key: 'mason', jobType: JOB_MASON, category: 'production', source: 'jobtypes.ini 12 "mason"' },
  { key: 'smith', jobType: JOB_SMITH, category: 'production', source: 'jobtypes.ini 13 "smith"' },
  {
    key: 'coin_maker',
    jobType: JOB_COIN_MAKER,
    category: 'production',
    source: 'jobtypes.ini 14 "coin maker"',
  },
  { key: 'hunter', jobType: JOB_HUNTER, category: 'production', source: 'jobtypes.ini 15 "hunter"' },
  { key: 'breeder', jobType: JOB_BREEDER, category: 'production', source: 'jobtypes.ini 16 "breeder"' },
  { key: 'tailor', jobType: JOB_TAILOR, category: 'production', source: 'jobtypes.ini 17 "sewer"' },
  { key: 'farmer', jobType: JOB_FARMER, category: 'production', source: 'jobtypes.ini 18 "farmer"' },
  { key: 'miller', jobType: JOB_MILLER, category: 'production', source: 'jobtypes.ini 19 "miller"' },
  {
    key: 'baker',
    jobType: JOB_BAKER,
    category: 'production',
    source: 'jobtypes.ini 20 "baker"',
  },
  {
    key: 'brewer',
    jobType: JOB_BREWER,
    category: 'production',
    source: 'jobtypes.ini 21 "brewer"',
  },
  {
    key: 'fisher',
    jobType: JOB_FISHER,
    category: 'production',
    source: 'jobtypes.ini 22 "fisher"',
  },
  {
    key: 'herbalist',
    jobType: JOB_HERBALIST,
    category: 'production',
    source: 'jobtypes.ini 29 "herb & mush guy"',
  },
  { key: 'druid', jobType: JOB_DRUID, category: 'production', source: 'jobtypes.ini 30 "druid"' },
  { key: 'scout', jobType: JOB_SCOUT, category: 'special', source: 'jobtypes.ini 27 "scout"' },
  { key: 'jester', jobType: JOB_JESTER, category: 'special', source: 'jobtypes.ini 28 "jester"' },
  {
    key: 'trader',
    jobType: JOB_TRADER,
    category: 'special',
    source: 'jobtypes.ini 25 "trader"',
  },
  { key: 'soldier', jobType: JOB_SOLDIER, category: 'military', source: 'jobtypes.ini 31 "soldier_unarmed"' },
];

/** The one soldier profession (the picker's single "Żołnierz" row / the whole soldier band's label).
 *  Resolved at module load, so a roster edit that drops the row fails loudly here rather than mislabelling
 *  every soldier at runtime. */
const SOLDIER_PROFESSION = professionByKey('soldier');

function professionByKey(key: ProfessionDef['key']): ProfessionDef {
  const def = PROFESSIONS.find((p) => p.key === key);
  if (def === undefined) throw new Error(`professions: no roster row keyed "${key}"`);
  return def;
}

/**
 * The profession a job belongs to — for the details-panel label. Any soldier-band job (31..41) resolves to
 * the one soldier profession; every other job matches by exact `jobType`. `undefined` for jobs off the
 * roster (e.g. idle), which the caller labels itself.
 */
export function professionDefForJob(jobType: number | undefined): ProfessionDef | undefined {
  if (jobType === undefined) return undefined;
  if (isSoldierJob(jobType)) return SOLDIER_PROFESSION;
  return PROFESSIONS.find((p) => p.jobType === jobType);
}

/** One rendered picker row: a clickable profession, or a non-clickable group header. */
export type PickerEntry =
  | { readonly kind: 'header'; readonly label: string }
  | { readonly kind: 'profession'; readonly jobType: number; readonly label: string };

/**
 * The localized, grouped picker list: each profession as a `profession` entry, preceded by a `header`
 * entry at every category boundary. Built from {@link PROFESSIONS} so the offered set and its order live
 * in one place; the widget just renders entries top to bottom.
 */
export function pickerEntries(locale?: Locale): PickerEntry[] {
  const entries: PickerEntry[] = [];
  let group: ProfessionCategory | null = null;
  for (const p of PROFESSIONS) {
    if (p.category !== group) {
      group = p.category;
      entries.push({ kind: 'header', label: categoryLabel(p.category, locale) });
    }
    entries.push({ kind: 'profession', jobType: p.jobType, label: professionLabel(p.key, locale) });
  }
  return entries;
}
