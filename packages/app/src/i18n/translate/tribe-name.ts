import type { LocalizedMapString } from '../../game/map/strings.js';
import { type Locale, messages, tribeName } from '../index.js';

/** A tribe name translated from the English catalogue, with the localized catalogue name as fallback. */
export function translatedTribeName(
  tribe: number | undefined,
  translate: (found: LocalizedMapString) => string,
  target: Locale | null,
  enabled: boolean,
): string {
  if (tribe === undefined) return '-';
  const fallback = tribeName(tribe);
  if (!enabled || target === null) return fallback;
  const original = messages('eng').tribeNames[tribe];
  if (original === undefined) return fallback;
  // English is already the requested language; no engine round-trip is needed.
  if (target === 'eng') return original;
  const translated = translate({ text: original, lang: 'eng' });
  // While a batch is pending or unavailable, keep the game's own localized name.
  return translated === original ? fallback : translated;
}
