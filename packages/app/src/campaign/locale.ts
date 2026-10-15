import {
  type Campaign,
  type CampaignLanguageMovies,
  type LocalizedText,
  MAP_TEXT_LANGUAGES,
  type MapTextLanguage,
} from '@open-northland/data';
import { type Locale, mapTextLanguage } from '../i18n/index.js';

/** Campaign content falls back to English, then to the first language it has. */
const FALLBACK_LANGUAGE: MapTextLanguage = 'eng';
const NO_MOVIES: CampaignLanguageMovies = { videos: [] };

function fallbackLanguage(
  present: readonly MapTextLanguage[],
  requested: MapTextLanguage,
): MapTextLanguage | undefined {
  if (present.includes(requested)) return requested;
  if (present.includes(FALLBACK_LANGUAGE)) return FALLBACK_LANGUAGE;
  return present[0];
}

function presentIn(record: Partial<Record<MapTextLanguage, unknown>>): MapTextLanguage[] {
  return MAP_TEXT_LANGUAGES.filter((language) => record[language] !== undefined);
}

/** The text language a campaign plays in for a UI locale. */
export function campaignLanguage(campaign: Pick<Campaign, 'languages'>, locale: Locale): MapTextLanguage {
  return fallbackLanguage(campaign.languages, mapTextLanguage(locale)) ?? FALLBACK_LANGUAGE;
}

export function localizedText(text: LocalizedText, language: MapTextLanguage): string {
  const chosen = fallbackLanguage(presentIn(text), language);
  return (chosen === undefined ? undefined : text[chosen]) ?? '';
}

export function campaignMovies(
  campaign: Pick<Campaign, 'movies'>,
  language: MapTextLanguage,
): CampaignLanguageMovies {
  const chosen = fallbackLanguage(presentIn(campaign.movies), language);
  return (chosen === undefined ? undefined : campaign.movies[chosen]) ?? NO_MOVIES;
}
