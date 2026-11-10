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
 * professions; the sea variants (23, 26) need a harbour, and the jester (28) is not in this game.
 */

/** The picker's ordered groups. */
export type ProfessionCategory = keyof Messages['category'];

export interface ProfessionDef {
  readonly key: keyof Messages['profession'];
  readonly jobType: number;
  readonly category: ProfessionCategory;
  /** The good whose icon stands for the trade where professions are picked, by slug: a presentation
   *  choice of a product or tool the trade is known by. Absent where no good reads as the trade. */
  readonly icon?: string;
  /** Goods shown together in profession pickers, in trade unlock order. */
  readonly goods?: readonly string[];
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
  {
    key: 'builder',
    jobType: JOB_BUILDER,
    category: 'basic',
    source: 'jobtypes.ini 7 "builder"',
  },
  {
    key: 'collector',
    goods: ['wood', 'mud', 'stone', 'iron', 'gold', 'mushroom'],
    jobType: JOB_COLLECTOR,
    category: 'basic',
    icon: 'wood',
    source: 'jobtypes.ini 8 "collector"',
  },
  { key: 'carrier', jobType: JOB_CARRIER, category: 'basic', source: 'jobtypes.ini 24 "carrier"' },
  {
    key: 'joiner',
    goods: [
      'tool_wooden',
      'tool_iron',
      'furniture',
      'handcart',
      'oxcart',
      'ship_small',
      'ship_big',
      'catapult',
    ],
    jobType: JOB_JOINER,
    category: 'production',
    icon: 'furniture',
    source: 'jobtypes.ini 9 "joiner"',
  },
  {
    key: 'armorer',
    goods: ['bow_short', 'bow_long', 'spear_wooden'],
    jobType: JOB_ARMORER,
    category: 'production',
    icon: 'bow_long',
    source: 'jobtypes.ini 10 "armorer"',
  },
  {
    key: 'potter',
    goods: ['brick', 'tile', 'crockery'],
    jobType: JOB_POTTER,
    category: 'production',
    icon: 'crockery',
    source: 'jobtypes.ini 11 "potter"',
  },
  {
    key: 'mason',
    goods: ['pillar', 'ornament'],
    jobType: JOB_MASON,
    category: 'production',
    icon: 'pillar',
    source: 'jobtypes.ini 12 "mason"',
  },
  {
    key: 'smith',
    goods: ['spear_iron', 'sword_shord', 'armor_chain', 'armor_plate', 'sword_long'],
    jobType: JOB_SMITH,
    category: 'production',
    icon: 'sword_long',
    source: 'jobtypes.ini 13 "smith"',
  },
  {
    key: 'coin_maker',
    goods: [
      'coin',
      'amulet_food',
      'amulet_stamina',
      'amulet_strength',
      'amulet_defense',
      'amulet_crithit',
      'amulet_speed',
    ],
    jobType: JOB_COIN_MAKER,
    category: 'production',
    icon: 'coin',
    source: 'jobtypes.ini 14 "coin maker"',
  },
  {
    key: 'hunter',
    goods: ['meat', 'leather'],
    jobType: JOB_HUNTER,
    category: 'production',
    icon: 'meat',
    source: 'jobtypes.ini 15 "hunter"',
  },
  {
    key: 'breeder',
    goods: ['cattle', 'sheep'],
    jobType: JOB_BREEDER,
    category: 'production',
    icon: 'sheep',
    source: 'jobtypes.ini 16 "breeder"',
  },
  {
    key: 'tailor',
    goods: ['shoes', 'armor_leather', 'armor_wool'],
    jobType: JOB_TAILOR,
    category: 'production',
    icon: 'shoes',
    source: 'jobtypes.ini 17 "sewer"',
  },
  {
    key: 'farmer',
    jobType: JOB_FARMER,
    category: 'production',
    icon: 'wheat',
    source: 'jobtypes.ini 18 "farmer"',
  },
  {
    key: 'miller',
    jobType: JOB_MILLER,
    category: 'production',
    icon: 'flour',
    source: 'jobtypes.ini 19 "miller"',
  },
  {
    key: 'baker',
    goods: ['bread', 'candy'],
    jobType: JOB_BAKER,
    category: 'production',
    icon: 'bread',
    source: 'jobtypes.ini 20 "baker"',
  },
  {
    key: 'brewer',
    jobType: JOB_BREWER,
    category: 'production',
    icon: 'mead',
    source: 'jobtypes.ini 21 "brewer"',
  },
  {
    key: 'fisher',
    jobType: JOB_FISHER,
    category: 'production',
    icon: 'fish',
    source: 'jobtypes.ini 22 "fisher"',
  },
  {
    key: 'herbalist',
    jobType: JOB_HERBALIST,
    category: 'production',
    icon: 'herb',
    source: 'jobtypes.ini 29 "herb & mush guy"',
  },
  {
    key: 'druid',
    goods: [
      'holy_oil',
      'potion_food_small',
      'potion_food_big',
      'potion_stamina_small',
      'potion_stamina_big',
      'potion_heal_small',
      'potion_heal_big',
    ],
    jobType: JOB_DRUID,
    category: 'production',
    icon: 'holy_oil',
    source: 'jobtypes.ini 30 "druid"',
  },
  { key: 'scout', jobType: JOB_SCOUT, category: 'special', source: 'jobtypes.ini 27 "scout"' },
  {
    key: 'trader',
    jobType: JOB_TRADER,
    category: 'special',
    icon: 'handcart',
    source: 'jobtypes.ini 25 "trader"',
  },
  {
    key: 'soldier',
    jobType: JOB_SOLDIER,
    category: 'military',
    icon: 'sword_shord',
    source: 'jobtypes.ini 31 "soldier_unarmed"',
  },
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

/** The profession the picker lists first, above the rest of its group by name: a layout choice of
 *  this project, putting the trade every settlement needs at hand. */
export const LEADING_PROFESSION = JOB_BUILDER;

/** The localized picker list, top to bottom: a `header` entry opens every category. */
export function pickerEntries(locale?: Locale): PickerEntry[] {
  // The civilist job (`jobtypes.ini` 6) is in the basic group but is not a roster row: no workplace
  // employs it, so assigning it means the settler does nothing until re-traded.
  const entries: PickerEntry[] = [
    { kind: 'header', label: categoryLabel('basic', locale) },
    { kind: 'profession', jobType: JOB_CIVILIST, label: professionLabel('idle', locale) },
  ];
  let group: ProfessionCategory = 'basic';
  for (const p of PROFESSIONS) {
    if (p.category !== group) {
      group = p.category;
      entries.push({ kind: 'header', label: categoryLabel(p.category, locale) });
    }
    entries.push({ kind: 'profession', jobType: p.jobType, label: professionLabel(p.key, locale) });
  }
  return entries;
}

export function professionGoods(jobType: number): readonly string[] {
  const profession = professionDefForJob(jobType);
  return profession?.goods ?? (profession?.icon === undefined ? [] : [profession.icon]);
}
