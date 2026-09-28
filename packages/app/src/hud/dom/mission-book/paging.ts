/**
 * The book turns its text instead of scrolling it: a chapter is laid out in CSS columns one page wide,
 * and spread `k` shows columns `2k` (left page) and `2k + 1` (right page).
 */

/** How many page-wide columns a flow of `scrollWidth` px holds, at least one. */
export function columnCount(scrollWidth: number, columnWidth: number, gap: number): number {
  const step = columnWidth + gap;
  return step <= 0 ? 1 : Math.max(1, Math.round((scrollWidth + gap) / step));
}

export function spreadCount(columns: number): number {
  return Math.max(1, Math.ceil(columns / 2));
}

/** Where the reader stands: a chapter, and a spread in it; `last` lands on its final spread once the
 *  chapter has been laid out. */
export interface BookPosition {
  readonly chapter: number;
  readonly spread: number | 'last';
}

/**
 * The position one turn in `direction` leads to: the next or previous spread, across into the
 * neighbouring chapter at either end, or null at the book's first or last page.
 */
export function turnPage(
  at: { readonly chapter: number; readonly spread: number },
  direction: -1 | 1,
  spreads: number,
  chapters: number,
): BookPosition | null {
  if (direction > 0) {
    if (at.spread < spreads - 1) return { chapter: at.chapter, spread: at.spread + 1 };
    return at.chapter < chapters - 1 ? { chapter: at.chapter + 1, spread: 0 } : null;
  }
  if (at.spread > 0) return { chapter: at.chapter, spread: at.spread - 1 };
  return at.chapter > 0 ? { chapter: at.chapter - 1, spread: 'last' } : null;
}
