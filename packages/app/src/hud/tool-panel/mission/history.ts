import { BRIEFING_HISTORY_LIMIT } from '@open-northland/sim';

/** The shown page and the pages shown so far, carried across a remount. */
export interface ShownPagesState {
  readonly page: number | null;
  readonly pages: readonly number[];
}

/**
 * The briefing pages the window has shown, oldest first, and the one on display: the prev/next pair
 * walks the list, which drops its oldest page past {@link BRIEFING_HISTORY_LIMIT} (reading).
 */
export class ShownPages {
  /** The page the task tab shows; null shows the map's fallback text. */
  page: number | null = null;
  private pages: number[] = [];

  /** Whether two pages have been shown, which is when the prev/next pair appears. */
  get walkable(): boolean {
    return this.pages.length >= 2;
  }

  /** Fold the sim's own delivered history in, so a page shown before this window mounted is walkable. */
  fold(recorded: readonly number[]): void {
    for (const page of recorded) this.add(page);
  }

  show(page: number): void {
    this.page = page;
    this.add(page);
  }

  /** The page `direction` steps from the shown one, or null at either end or off the list. */
  neighbour(direction: -1 | 1): number | null {
    if (this.page === null) return null;
    const at = this.pages.indexOf(this.page);
    if (at < 0) return null;
    return this.pages[at + direction] ?? null;
  }

  state(): ShownPagesState {
    return { page: this.page, pages: [...this.pages] };
  }

  restore(state: ShownPagesState): void {
    this.page = state.page;
    this.pages = [...state.pages];
  }

  /** A page already in the list stays where it was, a new one goes on the end. */
  private add(page: number): void {
    if (this.pages.includes(page)) return;
    this.pages.push(page);
    if (this.pages.length > BRIEFING_HISTORY_LIMIT)
      this.pages.splice(0, this.pages.length - BRIEFING_HISTORY_LIMIT);
  }
}
