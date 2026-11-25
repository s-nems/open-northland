import type { LocalizedMapString } from '../../game/map/strings.js';
import { type Locale, tribeName as localizedTribeName } from '../index.js';

/** Translate a game-data tribe label, keeping the UI catalogue name until the device answer lands. */
export function translatedTribeName(
  tribe: number | undefined,
  original: string | undefined,
  translate: (found: LocalizedMapString) => string,
  target: Locale | null,
  enabled: boolean,
): string {
  if (tribe === undefined) return '-';
  const fallback = localizedTribeName(tribe);
  if (!enabled || target === null || original === undefined) return fallback;
  // English is already the requested language; no engine round-trip is needed.
  if (target === 'eng') return original;
  const translated = translate({ text: original, lang: 'eng' });
  return translated === original ? fallback : translated;
}
