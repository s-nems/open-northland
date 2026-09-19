import { z } from 'zod';

/** The text colours a page's `<color:…\font_*.pcx>` carrier selects, named after the font palettes the
 *  HUD draws them through. */
export const HypertextColor = z.enum(['dark', 'red', 'white', 'dimmed']);
export type HypertextColor = z.infer<typeof HypertextColor>;

/** A line's alignment from the `<block:N>` in force when it ends: `1` justifies, `2` centres, `3`
 *  right-aligns; absent is block `0`, left-aligned. */
export const HypertextAlign = z.enum(['justify', 'center', 'right']);
export type HypertextAlign = z.infer<typeof HypertextAlign>;

/** Consecutive lines of one style, alignment, colour and link. Each `\n` in `text` is a hard line end;
 *  a line wider than the column wraps. */
export const HypertextParagraph = z.strictObject({
  kind: z.literal('text'),
  style: z.enum(['title', 'body']),
  text: z.string(),
  align: HypertextAlign.optional(),
  color: HypertextColor.optional(),
  /** The page id a click on this run opens (`<globaljump:<file>.hlt,…>`), for a page in a book. */
  link: z.string().optional(),
});
export type HypertextParagraph = z.infer<typeof HypertextParagraph>;

/** Empty lines between two runs: a line end on a line that holds nothing yet. */
export const HypertextBlank = z.strictObject({
  kind: z.literal('blank'),
  lines: z.number().int().positive(),
});
export type HypertextBlank = z.infer<typeof HypertextBlank>;

/** A picture a page draws on a line of its own, centred (`<picture:$local$\graphics\<file>>`). */
export const HypertextPicture = z.strictObject({
  kind: z.literal('picture'),
  /** File name under the `/gui/hypertext/` route: the digest the pipeline names the picture by. */
  file: z.string().regex(/^[0-9a-f]+\.png$/),
  /** The decoded picture's own size in px. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type HypertextPicture = z.infer<typeof HypertextPicture>;

/** One `<usericon:…>` tag: the up to four integers the hosting window's bitmap callback receives, the
 *  first choosing what it draws. Missing or non-numeric arguments read 0. */
export const HypertextUserIcon = z.tuple([
  z.number().int(),
  z.number().int(),
  z.number().int(),
  z.number().int(),
]);
export type HypertextUserIcon = z.infer<typeof HypertextUserIcon>;

/** User icons that shared one line, laid out inline and wrapped like words. */
export const HypertextIconRow = z.strictObject({
  kind: z.literal('icons'),
  icons: z.array(HypertextUserIcon).min(1),
  align: HypertextAlign.optional(),
});
export type HypertextIconRow = z.infer<typeof HypertextIconRow>;

/** One block of a rendered page, stacked top-down in page order. */
export const HypertextBlock = z.discriminatedUnion('kind', [
  HypertextParagraph,
  HypertextBlank,
  HypertextPicture,
  HypertextIconRow,
]);
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
