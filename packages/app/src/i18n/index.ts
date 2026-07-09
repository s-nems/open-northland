import { DEFAULT_UI_LANG } from '../content/gui-gfx.js';
import { type Messages, pl } from './pl.js';

/**
 * The app's tiny message-catalog seam — enough i18n to keep player-facing strings out of the widgets and
 * ready for a second language, without pulling in a framework. The game ships **Polish only** for now
 * (`pol`, the same default the decoded-string HUD uses via {@link DEFAULT_UI_LANG}); adding a language is
 * adding one sibling table to {@link LOCALES} with the same {@link Messages} shape.
 *
 * This covers the app's OWN clean-room strings (profession names, group headers, small UI labels). The
 * original game's decoded string tables are a separate concern (`content/gui-gfx.ts` `loadGuiStrings`).
 */

/** The shipped locales. Extend this (and add a table) to ship another language. */
export type Locale = 'pol';

const LOCALES: Readonly<Record<Locale, Messages>> = { pol: pl };

/** The default locale — the same one the decoded-string HUD falls back to, so all HUD text agrees. */
export const DEFAULT_LOCALE: Locale = DEFAULT_UI_LANG as Locale;

function table(locale: Locale): Messages {
  return LOCALES[locale] ?? pl;
}

/**
 * A profession's localized display name, by its `catalog/professions.ts` `key`. Falls back to the raw key
 * (never blank) if a table somehow lacks it — a visible "missing translation" beats an empty row.
 */
export function professionLabel(key: keyof Messages['profession'], locale: Locale = DEFAULT_LOCALE): string {
  return table(locale).profession[key] ?? key;
}

/** A profession-group header (the picker's section separators). */
export function categoryLabel(key: keyof Messages['category'], locale: Locale = DEFAULT_LOCALE): string {
  return table(locale).category[key] ?? key;
}

/** A short UI-chrome label (window titles, buttons). */
export function uiLabel(key: keyof Messages['ui'], locale: Locale = DEFAULT_LOCALE): string {
  return table(locale).ui[key] ?? key;
}
