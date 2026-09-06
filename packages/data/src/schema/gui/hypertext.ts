import { z } from 'zod';

/** One rendered run of a hypertext page: headline or body text, inner line breaks kept. */
export const HypertextParagraph = z.strictObject({
  style: z.enum(['title', 'body']),
  text: z.string(),
  /** Centred run (the hypertext `<block:2>` runs: headlines and links); absent reads left-aligned. */
  align: z.enum(['center']).optional(),
  /** The page id a click on this run opens (`<globaljump:<file>.hlt,…>`), for a page in a book. */
  link: z.string().optional(),
});
export type HypertextParagraph = z.infer<typeof HypertextParagraph>;

/**
 * A rendered hypertext book (`gui/history/<lang>.json`): the pages of one `text/<lang>/hypertext/<book>/`
 * folder keyed by file stem, opened on `start`; a paragraph's `link` names another page of the book.
 */
export const HypertextBook = z.strictObject({
  start: z.string(),
  pages: z.record(z.string(), z.array(HypertextParagraph)),
});
export type HypertextBook = z.infer<typeof HypertextBook>;
