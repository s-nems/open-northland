import { categoryLabel, type Locale, type Messages, professionLabel } from '../i18n/index.js';
import {
  JOB_ARMORER,
  JOB_BAKER,
  JOB_BREEDER,
  JOB_BREWER,
  JOB_BUILDER,
  JOB_CARRIER,
  JOB_CIVILIST,
  JOB_COIN_MAKER,
  JOB_COLLECTOR,
  JOB_DRUID,
  JOB_FARMER,
  JOB_FISHER,
  JOB_HERBALIST,
  JOB_HUNTER,
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
 * The committed profession roster, transcribed from `Data/logic/jobtypes.ini` `[jobtype]` records: what
 * the picker offers and which job each row assigns. The soldier band (31..41) collapses to one
 * profession, since a soldier's class is its weapon, and collecting is the single `collector` (8), the
 * original's one outdoor gatherer. Life stages, animals, vehicles and heroes (1..6, 42..55) are not
 * professions; the sea variants (23, 26) need a harbour, and the original's menu never offers the jester
 * (28) (observed).
 */

/** The picker's ordered groups. */
export type ProfessionCategory = keyof Messages['category'];

export interface ProfessionDef {
  readonly key: keyof Messages['profession'];
  readonly jobType: number;
  readonly category: ProfessionCategory;
  /** The `jobtypes.ini` record this row transcribes. */
  readonly source: string;
}

/** True for any job in the `jobtypes.ini` soldier band (31..41). The band is catalog policy rather than
 *  the sim's content-derived role, so it also labels classes the running content may not declare. */
export function isSoldierJob(jobType: number): boolean {
  return jobType >= SOLDIER_JOB_MIN && jobType <= SOLDIER_JOB_MAX;
}

/** The complete roster in picker order; `pickerEntries` inserts a header wherever the category changes. */
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
  {
    key: 'trader',
    jobType: JOB_TRADER,
    category: 'special',
    source: 'jobtypes.ini 25 "trader"',
  },
  { key: 'soldier', jobType: JOB_SOLDIER, category: 'military', source: 'jobtypes.ini 31 "soldier_unarmed"' },
];

/** The whole soldier band's label, resolved at module load so a roster edit dropping it fails loudly. */
const SOLDIER_PROFESSION = professionByKey('soldier');

function professionByKey(key: ProfessionDef['key']): ProfessionDef {
  const def = PROFESSIONS.find((p) => p.key === key);
  if (def === undefined) throw new Error(`professions: no roster row keyed "${key}"`);
  return def;
}

/**
 * The profession a job belongs to. Any soldier-band job resolves to the one soldier profession;
 * `undefined` for a job off the roster, which the caller labels itself.
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

/** The localized picker list, top to bottom: a `header` entry at every category boundary. */
export function pickerEntries(locale?: Locale): PickerEntry[] {
  // The civilist job (`jobtypes.ini` 6) leads the list but is not a roster row: no workplace employs
  // it, so assigning it means the settler does nothing until re-traded.
  const entries: PickerEntry[] = [
    { kind: 'profession', jobType: JOB_CIVILIST, label: professionLabel('idle', locale) },
  ];
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
