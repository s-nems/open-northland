import { type Paper, type PaperKind, PLACING_PAPER_KINDS } from '@open-northland/sim';

/** The papers list's sim seam: the seat's papers in slot order, re-read once a tick while the
 *  construction window is open. */
export interface PapersSeam {
  read(): readonly Paper[];
}

/** The kinds the papers page lists: a plan the seat spends on a placement. The other four kinds
 *  (the indulgence, the build, learn and produce permits) are not listed: the original's papers
 *  window offers no action for them, and no chest or map hands them out. */
export type PlacingPaperKind = Extract<PaperKind, 'placeAny' | 'placeHouse' | 'placeStockedHouse'>;

const isPlacing = (paper: Paper): paper is Paper & { readonly kind: PlacingPaperKind } =>
  PLACING_PAPER_KINDS.has(paper.kind);

/** One card of the papers page: the plan, how many alike the seat holds, and the house it names
 *  (null for a place-any plan, which names one in the catalogue). */
export interface PaperCard {
  readonly paper: Paper & { readonly kind: PlacingPaperKind };
  readonly count: number;
  readonly house: number | null;
}

/** The plans in first-slot order, alike plans folded into one card with a count; a spent plan
 *  frees its slot, so the count drops and the card goes when the last one is spent. */
export function paperCards(papers: readonly Paper[]): PaperCard[] {
  const cards = new Map<string, PaperCard>();
  for (const paper of papers) {
    if (!isPlacing(paper)) continue;
    const key = `${paper.kind}:${paper.param}`;
    const known = cards.get(key);
    if (known !== undefined) cards.set(key, { ...known, count: known.count + 1 });
    else cards.set(key, { paper, count: 1, house: paper.kind === 'placeAny' ? null : paper.param });
  }
  return [...cards.values()];
}

/** A change key over the cards, so the page rebuilds only when a plan is found or spent. */
export function paperCardsKey(cards: readonly PaperCard[]): string {
  return cards.map((card) => `${card.paper.kind}:${card.paper.param}×${card.count}`).join(',');
}

/** How many plans a pick could spend: the Papiery button's count. */
export function plansCount(cards: readonly PaperCard[]): number {
  return cards.reduce((sum, card) => sum + card.count, 0);
}
