import { LANGUAGE_INFO, type Language } from '@open-northland/data';
import { TRANSLATE_MODELS } from './model-files.js';

/**
 * How a map text in one language reaches a reader of another: through the pinned Firefox Translate
 * models. Mozilla ships en-centred pairs, so a translation without a direct model routes through
 * English, which the engine chains itself (`translateViaPivoting`).
 */

/** The language code Mozilla's model registry names each game language by. */
const MODEL_CODES: Readonly<Record<Language, string>> = {
  pol: 'pl',
  eng: 'en',
  ger: 'de',
  rus: 'ru',
  ita: 'it',
  chs: 'zh',
  cht: 'zh_hant',
};

/** The language every pair without a direct model routes through. */
const PIVOT = 'en';

/** A translation from one map text language to another: one model, or two chained over the pivot. */
export interface TranslateRoute {
  /** The language the text is written in. */
  readonly from: Language;
  /** The language the reader asked for. */
  readonly to: Language;
  /** The pair ids to load, first leg first (`pl-de` reads `['pl-en', 'en-de']`). */
  readonly pairs: readonly string[];
}

/** The pair id a direct registry model answers, or null when the route needs the pivot. */
function directPair(from: Language, to: Language): string | null {
  const id = `${MODEL_CODES[from]}-${MODEL_CODES[to]}`;
  return id in TRANSLATE_MODELS ? id : null;
}

/**
 * The route `from` → `to` runs over, or null when no pinned model chain answers it. A text already
 * in the reader's language (or in one of its own fallbacks that is not English, which the reader
 * reads by choice) never reaches here: `mission-translate` keeps it as authored.
 */
export function translateRoute(from: Language, to: Language): TranslateRoute | null {
  if (from === to) return null;
  const direct = directPair(from, to);
  if (direct !== null) return { from, to, pairs: [direct] };
  if (MODEL_CODES[from] === PIVOT || MODEL_CODES[to] === PIVOT) return null;
  const first = `${MODEL_CODES[from]}-${PIVOT}`;
  const second = `${PIVOT}-${MODEL_CODES[to]}`;
  if (!(first in TRANSLATE_MODELS) || !(second in TRANSLATE_MODELS)) return null;
  return { from, to, pairs: [first, second] };
}

/**
 * Whether a text in `lang` reads as foreign to a reader of `locale`: another language the reader's
 * own fallbacks do not answer — except English, which every map ships as its fallback table, so it
 * must read translated in every other language (`cht` readers read `chs` by script, and that stays
 * theirs by choice; English is a last resort they did not choose).
 */
export function readsForeign(lang: Language, locale: Language): boolean {
  if (lang === locale) return false;
  if (lang === 'eng') return true;
  return !(LANGUAGE_INFO[locale].fallbacks ?? []).includes(lang);
}
