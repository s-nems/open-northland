import {
  JOB_CARRIER,
  JOB_GATHERER_GOLD,
  JOB_GATHERER_IRON,
  JOB_GATHERER_MUD,
  JOB_GATHERER_MUSHROOM,
  JOB_GATHERER_STONE,
  JOB_GATHERER_WOOD,
  JOB_SOLDIER,
} from '../game/sandbox/ids.js';
import { categoryLabel, type Locale, professionLabel } from '../i18n/index.js';
import type { Messages } from '../i18n/pl.js';

/**
 * The committed clean-room PROFESSION roster — the complete set of jobs a player can assign a settler to,
 * transcribed from the original `Data/logic/jobtypes.ini` (`[jobtype]` records). This is the source of
 * truth for BOTH the profession picker (what it offers + which job each row assigns) and the settler
 * details-panel label (a settler's profession name), so the two can never drift.
 *
 * Faithfulness to the original's job model:
 *  - **One soldier.** `jobtypes.ini` splits soldiers into an unarmed base (type 31) plus ten weapon
 *    classes (32..41: spear/sword/saber/axe/bow). A settler's soldier CLASS is its weapon, not a separate
 *    profession — so the picker offers a single "Żołnierz" that assigns the unarmed base ({@link JOB_SOLDIER}
 *    = 31); the weapon (a later step) specializes it. Only a soldier ever carries a weapon (weapons resolve
 *    by `(tribe, jobType)`, and no civilian trade has a binding), so a civilian is always unarmed.
 *  - **Life stages, animals, vehicles, and named heroes are not professions** (jobtypes 1..6, 42..55) and
 *    are omitted. Sea variants (`fisher_sea` 23, `trader_sea` 26) and the generic `collector` (8) are
 *    omitted too: the sandbox realizes collecting as the six concrete resource gatherers below (a settler
 *    can actually harvest with those today), and the sea trades need a harbour/ship the sandbox lacks.
 *
 * jobType numbering: the six gatherers, the carrier, and the soldier use the sandbox's live job ids
 * (`game/sandbox/ids.ts`); the added production trades use their REAL `jobtypes.ini` ids where the
 * sandbox's synthetic gatherer band (20..25) does not shadow them, and a placeholder id
 * ({@link SHADOWED_TRADE_BASE}) for the four trades whose real ids that band occupies. Every id is a
 * placeholder until the global-content re-key (`docs/plans/global-content.md`) runs the sim on real
 * `ir.json`; the fidelity anchor is each row's `jobtypes.ini` `source`, not the number.
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

/**
 * Real `jobtypes.ini` ids for the production trades the sandbox's gatherer band (20..25) does NOT shadow.
 * Named (no bare numbers) so a reader sees the transcription; grouped here as the trade id space.
 */
const JOB_BUILDER = 7;
const JOB_JOINER = 9;
const JOB_ARMORER = 10;
const JOB_POTTER = 11;
const JOB_MASON = 12;
const JOB_SMITH = 13;
const JOB_COIN_MAKER = 14;
const JOB_HUNTER = 15;
const JOB_BREEDER = 16;
const JOB_TAILOR = 17; // jobtypes.ini "sewer"
const JOB_FARMER = 18;
const JOB_MILLER = 19;
const JOB_SCOUT = 27;
const JOB_JESTER = 28;
const JOB_HERBALIST = 29; // jobtypes.ini "herb & mush guy"
const JOB_DRUID = 30;

/**
 * The four trades whose real `jobtypes.ini` ids (baker 20, brewer 21, fisher 22, trader 25) are shadowed
 * by the sandbox's synthetic gatherer band (20..25). They take a placeholder id here until the
 * global-content re-key frees the real ids; the picker still assigns them (any id in `content.jobs` works),
 * they just render as the civilian body like every other trade.
 */
const SHADOWED_TRADE_BASE = 200;
const JOB_BAKER = SHADOWED_TRADE_BASE + 0;
const JOB_BREWER = SHADOWED_TRADE_BASE + 1;
const JOB_FISHER = SHADOWED_TRADE_BASE + 2;
const JOB_TRADER = SHADOWED_TRADE_BASE + 3;

/** The `jobtypes.ini` soldier band (unarmed base + weapon classes) — every one reads as "Żołnierz". */
const SOLDIER_JOB_MIN = 31;
const SOLDIER_JOB_MAX = 41;

/** True for any job in the `jobtypes.ini` soldier band (31..41) — all collapse to the one soldier label. */
export function isSoldierJob(jobType: number): boolean {
  return jobType >= SOLDIER_JOB_MIN && jobType <= SOLDIER_JOB_MAX;
}

/**
 * The complete roster, in picker order (gathering → transport → production → special → military). The
 * order here IS the list order; `pickerEntries` inserts a group header wherever the category changes.
 */
export const PROFESSIONS: readonly ProfessionDef[] = [
  { key: 'gatherer_wood', jobType: JOB_GATHERER_WOOD, category: 'gathering', source: 'collector (wood)' },
  { key: 'gatherer_stone', jobType: JOB_GATHERER_STONE, category: 'gathering', source: 'collector (stone)' },
  { key: 'gatherer_mud', jobType: JOB_GATHERER_MUD, category: 'gathering', source: 'collector (clay)' },
  { key: 'gatherer_iron', jobType: JOB_GATHERER_IRON, category: 'gathering', source: 'collector (iron)' },
  { key: 'gatherer_gold', jobType: JOB_GATHERER_GOLD, category: 'gathering', source: 'collector (gold)' },
  {
    key: 'gatherer_mushroom',
    jobType: JOB_GATHERER_MUSHROOM,
    category: 'gathering',
    source: 'collector (mushroom)',
  },
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
    source: 'jobtypes.ini 20 "baker" (id shadowed)',
  },
  {
    key: 'brewer',
    jobType: JOB_BREWER,
    category: 'production',
    source: 'jobtypes.ini 21 "brewer" (id shadowed)',
  },
  {
    key: 'fisher',
    jobType: JOB_FISHER,
    category: 'production',
    source: 'jobtypes.ini 22 "fisher" (id shadowed)',
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
    source: 'jobtypes.ini 25 "trader" (id shadowed)',
  },
  { key: 'soldier', jobType: JOB_SOLDIER, category: 'military', source: 'jobtypes.ini 31 "soldier_unarmed"' },
];

/** The one soldier profession (the picker's single "Żołnierz" row / the whole soldier band's label). */
const SOLDIER_PROFESSION = PROFESSIONS.find((p) => p.key === 'soldier') as ProfessionDef;

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
