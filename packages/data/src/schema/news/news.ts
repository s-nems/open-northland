import { z } from 'zod';
import type { Language } from '../../languages.js';
import { httpsUrl, type Validated, validated } from './validated.js';

/** The main menu's news the API serves at `/v1/news` from its data directory's `news.json`. */
export const NEWS_SCHEMA_VERSION = 1;
export const NEWS_TITLE_MAX_CHARS = 80;
export const NEWS_TEXT_MAX_CHARS = 280;
export const NEWS_LABEL_MAX_CHARS = 40;
export const NEWS_MAX_ENTRIES = 20;
const KIB = 1024;
export const NEWS_FILE_MAX_BYTES = 64 * KIB;

const line = (max: number) => z.string().trim().min(1).max(max);

/** One text per game language; English is the one every reader can fall back to. */
const localizedText = (max: number) =>
  z.strictObject({
    pol: line(max).optional(),
    eng: line(max),
    ger: line(max).optional(),
    rus: line(max).optional(),
    ita: line(max).optional(),
    chs: line(max).optional(),
    cht: line(max).optional(),
  } satisfies Record<Language, z.ZodType>);

export type NewsText = z.infer<ReturnType<typeof localizedText>>;

export const NewsLink = z.strictObject({
  url: httpsUrl,
  label: localizedText(NEWS_LABEL_MAX_CHARS).optional(),
});
export type NewsLink = z.infer<typeof NewsLink>;

/** An instant with its offset, so the owner's local time cannot be read in the player's zone. */
const instant = z.iso.datetime({ offset: true });

export const NewsEntry = z
  .strictObject({
    title: localizedText(NEWS_TITLE_MAX_CHARS),
    text: localizedText(NEWS_TEXT_MAX_CHARS).optional(),
    link: NewsLink.optional(),
    startsAt: instant.optional(),
    until: instant.optional(),
  })
  .refine(
    ({ startsAt, until }) =>
      startsAt === undefined || until === undefined || Date.parse(until) > Date.parse(startsAt),
    { message: 'until must be later than startsAt', path: ['until'] },
  );
export type NewsEntry = z.infer<typeof NewsEntry>;

export const NewsDocument = z.strictObject({
  schema: z.literal(NEWS_SCHEMA_VERSION),
  entries: z.array(NewsEntry).max(NEWS_MAX_ENTRIES),
});
export type NewsDocument = z.infer<typeof NewsDocument>;

export const EMPTY_NEWS_DOCUMENT: NewsDocument = { schema: NEWS_SCHEMA_VERSION, entries: [] };

/** Validates parsed JSON; `value` has its texts trimmed. The byte cap is the reader's to check. */
export function validateNewsDocument(raw: unknown): Validated<NewsDocument> {
  return validated(NewsDocument, raw);
}
