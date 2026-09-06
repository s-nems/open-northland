import { z } from 'zod';

/** The text colours a page's `<color:…\font_*.pcx>` carrier selects, named after the font palettes the
 *  HUD draws them through. */
export const HypertextColor = z.enum(['dark', 'red', 'white', 'dimmed']);
export type HypertextColor = z.infer<typeof HypertextColor>;

/** One rendered run of a hypertext page: headline or body text, inner line breaks kept. */
export const HypertextParagraph = z.strictObject({
  kind: z.literal('text'),
  style: z.enum(['title', 'body']),
  text: z.string(),
  /** Centred run (the hypertext `<block:2>` runs: headlines and links); absent reads left-aligned. */
  align: z.enum(['center']).optional(),
  color: HypertextColor.optional(),
  /** The page id a click on this run opens (`<globaljump:<file>.hlt,…>`), for a page in a book. */
  link: z.string().optional(),
});
export type HypertextParagraph = z.infer<typeof HypertextParagraph>;

/** A picture a page draws between its paragraphs (`<picture:$local$\graphics\<file>>`). */
export const HypertextPicture = z.strictObject({
  kind: z.literal('picture'),
  /** File name under the `/gui/hypertext/` route: the digest the pipeline names the picture by. */
  file: z.string().regex(/^[0-9a-f]+\.png$/),
  /** The decoded picture's own size; the window fits it to the text column and keeps the ratio. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  align: z.enum(['center']).optional(),
});
export type HypertextPicture = z.infer<typeof HypertextPicture>;

/** One block of a rendered page, stacked top-down in page order. */
export const HypertextBlock = z.discriminatedUnion('kind', [HypertextParagraph, HypertextPicture]);
export type HypertextBlock = z.infer<typeof HypertextBlock>;

/**
 * A rendered hypertext book (`gui/history/<lang>.json`): the pages of one `text/<lang>/hypertext/<book>/`
 * folder keyed by file stem, opened on `start`; a paragraph's `link` names another page of the book.
 */
export const HypertextBook = z.strictObject({
  start: z.string(),
  pages: z.record(z.string(), z.array(HypertextBlock)),
});
export type HypertextBook = z.infer<typeof HypertextBook>;
