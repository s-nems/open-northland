/** news.css's `--news-fit`: the panel content's size against its full size. */
const FIT_PROPERTY = '--news-fit';
const FIT_STEP = 0.05;
/** The search stops here at the latest; news.css's floors usually hold above it. */
const MIN_FIT = 0.3;

const childElements = (parent: HTMLElement): HTMLElement[] =>
  [...parent.children].filter((child): child is HTMLElement => child instanceof HTMLElement);

const overflows = (column: HTMLElement): boolean => column.scrollHeight > column.clientHeight;

/** Hides, and takes out of Tab order and the accessibility tree, each block that reaches past its
 *  column's height cap and every block after it, so a short window drops whole blocks instead of
 *  cutting one. The heading stays while it fits itself, so a column unfolded without room for a
 *  block can still be folded again. */
function retireHiddenBlocks(column: HTMLElement): void {
  const [heading, body] = childElements(column);
  if (heading === undefined || body === undefined) return;
  const limit = column.getBoundingClientRect().bottom;
  heading.inert = heading.getBoundingClientRect().bottom > limit;
  if (body.hidden) return;
  let fits = !heading.inert;
  for (const block of childElements(body)) {
    fits &&= block.getBoundingClientRect().bottom <= limit;
    block.inert = !fits;
  }
}

/** Shrinks the panel's content and its margins step by step while a column overflows its room, the
 *  same in both columns, until everything fits or news.css's floors hold; then drops the blocks that
 *  still reach past their column. */
export function fitPanel(panel: HTMLElement): void {
  const columns = childElements(panel);
  const sizes = (): string => columns.map((column) => `${column.scrollHeight}/${column.clientHeight}`).join();
  panel.style.removeProperty(FIT_PROPERTY);
  let fit = 1;
  let shown = sizes();
  while (fit > MIN_FIT && columns.some(overflows)) {
    fit = Math.round((fit - FIT_STEP) / FIT_STEP) * FIT_STEP;
    panel.style.setProperty(FIT_PROPERTY, fit.toFixed(2));
    const next = sizes();
    // Every floor holds: a smaller fit no longer changes anything.
    if (next === shown) break;
    shown = next;
  }
  for (const column of columns) retireHiddenBlocks(column);
}
