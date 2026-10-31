import { PersonalNamesFile } from '@open-northland/data';
import { diag } from '../../diag/index.js';
import { installLocalizedNames, type LocalizedNames } from '../../game/character-names/localized-names.js';
import type { Locale } from '../../i18n/index.js';
import { fetchJsonOrNull } from '../net.js';

/**
 * The localized personal names, which the pipeline writes beside the strings from the `names`
 * translation overlays. A checkout without `content/` or a language with nothing translated yet has no
 * file: either reads as no names, and every settler keeps the raw name its pool gave it.
 */

const GUI_ROOT = '/gui';

const byLocale = new Map<Locale, Promise<LocalizedNames>>();

/** `locale`'s localized names by pool, fetched once; an absent or rejected file reads as none. */
export function loadPersonalNames(locale: Locale): Promise<LocalizedNames> {
  const cached = byLocale.get(locale);
  if (cached !== undefined) return cached;
  const loading = fetchJsonOrNull<unknown>(`${GUI_ROOT}/names/${locale}.json`).then((raw) => {
    if (raw === null) return new Map();
    const parsed = PersonalNamesFile.safeParse(raw);
    if (!parsed.success) {
      diag.warn('content', `loadPersonalNames: rejected /gui/names/${locale}.json (${parsed.error.message})`);
      return new Map();
    }
    return new Map(
      Object.entries(parsed.data).map(([pool, names]) => [pool, new Map(Object.entries(names))]),
    );
  });
  byLocale.set(locale, loading);
  return loading;
}

/** Show `locale`'s localized personal names; a failed load keeps the raw ones and never fails the boot. */
export async function installPersonalNames(locale: Locale): Promise<void> {
  try {
    installLocalizedNames(locale, await loadPersonalNames(locale));
  } catch (err) {
    diag.warn('content', 'personal names failed to load; the raw names stay', err);
  }
}
