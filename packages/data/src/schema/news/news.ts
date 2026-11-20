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

/** An instant with its offset, so the owner's local time cannot be read in the player's zone;
 *  seconds are optional. */
const instant = z.union([z.iso.datetime({ offset: true }), z.iso.datetime({ offset: true, precision: -1 })], {
  error: 'expected a real date-time with an offset, like 2026-11-25T19:00+01:00',
});

/** The owner's file refuses unknown keys, so a typo fails the check; the game strips them, so an older
 *  build keeps reading a document that grew a field or a language. */
type UnknownKeys = 'refuse' | 'strip';

function newsDocumentSchema(unknownKeys: UnknownKeys) {
  const object = <S extends z.core.$ZodLooseShape>(shape: S) =>
    unknownKeys === 'refuse' ? z.strictObject(shape) : z.object(shape);
  /** One text per game language. The owner writes Polish and English; the other languages fall back
   *  to English. */
  const localizedText = (max: number) =>
    object({
      pol: line(max),
      eng: line(max),
      ger: line(max).optional(),
      rus: line(max).optional(),
      ita: line(max).optional(),
      chs: line(max).optional(),
      cht: line(max).optional(),
    } satisfies Record<Language, z.ZodType>);
  const link = object({
    url: httpsUrl,
    label: localizedText(NEWS_LABEL_MAX_CHARS).optional(),
  });
  const entry = object({
    title: localizedText(NEWS_TITLE_MAX_CHARS),
    text: localizedText(NEWS_TEXT_MAX_CHARS).optional(),
    link: link.optional(),
    startsAt: instant.optional(),
    until: instant.optional(),
  }).refine(
    ({ startsAt, until }) =>
      startsAt === undefined || until === undefined || Date.parse(until) > Date.parse(startsAt),
    { message: 'until must be later than startsAt', path: ['until'] },
  );
  return object({
    schema: z.literal(NEWS_SCHEMA_VERSION),
    entries: z.array(entry).max(NEWS_MAX_ENTRIES),
  });
}

const NewsFileDocument = newsDocumentSchema('refuse');
const ServedNewsDocument = newsDocumentSchema('strip');

export type NewsDocument = z.infer<typeof ServedNewsDocument>;
export type NewsEntry = NewsDocument['entries'][number];
export type NewsText = NewsEntry['title'];

export const EMPTY_NEWS_DOCUMENT: NewsDocument = { schema: NEWS_SCHEMA_VERSION, entries: [] };

/** Validates the owner's parsed file, as the server and the check CLI read it; `value` has its texts
 *  trimmed. The byte cap is the reader's to check. */
export function validateNewsDocument(raw: unknown): Validated<NewsDocument> {
  return validated(NewsFileDocument, raw);
}

/** Validates the document the API serves, as the game reads it. */
export function validateServedNewsDocument(raw: unknown): Validated<NewsDocument> {
  return validated(ServedNewsDocument, raw);
}
