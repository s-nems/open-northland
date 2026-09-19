import type { Paper } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { paperCards, paperCardsKey, plansCount } from '../src/hud/tool-panel/paper-cards.js';

/** The papers page model: which papers become cards, how alike plans fold, and the change key. */

const WELL = 10;
const STORE = 9;

describe('paper cards', () => {
  it('lists the placing kinds only, in first-slot order, alike plans folded with a count', () => {
    const papers: Paper[] = [
      { kind: 'placeAny', param: 0 },
      { kind: 'indulgence', param: 0 },
      { kind: 'placeHouse', param: WELL },
      { kind: 'buildPermit', param: WELL },
      { kind: 'placeAny', param: 0 },
      { kind: 'placeStockedHouse', param: STORE },
      { kind: 'learnPermit', param: 3 },
      { kind: 'producePermit', param: 4 },
      { kind: 'placeAny', param: 0 },
      { kind: 'placeHouse', param: WELL },
    ];
    const cards = paperCards(papers);
    expect(cards.map((card) => [card.paper.kind, card.count, card.house])).toEqual([
      ['placeAny', 3, null],
      ['placeHouse', 2, WELL],
      ['placeStockedHouse', 1, STORE],
    ]);
    expect(plansCount(cards)).toBe(6); // the Papiery button counts every plan, not every card
    expect(paperCards([{ kind: 'indulgence', param: 0 }])).toEqual([]);
  });

  it('keeps two houses apart and changes its key only when a plan is found or spent', () => {
    const before = paperCards([
      { kind: 'placeHouse', param: WELL },
      { kind: 'placeHouse', param: STORE },
      { kind: 'placeHouse', param: WELL },
    ]);
    expect(before.map((card) => [card.house, card.count])).toEqual([
      [WELL, 2],
      [STORE, 1],
    ]);
    // A spent well plan frees its slot: the list order survives, the count drops.
    const spent = paperCards([
      { kind: 'placeHouse', param: WELL },
      { kind: 'placeHouse', param: STORE },
    ]);
    expect(paperCardsKey(spent)).not.toBe(paperCardsKey(before));
    // An inert paper found between the plans changes nothing on the page.
    const withPermit = paperCards([
      { kind: 'placeHouse', param: WELL },
      { kind: 'producePermit', param: 4 },
      { kind: 'placeHouse', param: STORE },
    ]);
    expect(paperCardsKey(withPermit)).toBe(paperCardsKey(spent));
  });
});
