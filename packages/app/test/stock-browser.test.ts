import { describe, expect, it } from 'vitest';
import { amountText } from '../src/hud/dom/parts/amount.js';
import {
  OVERVIEW_LINES,
  OVERVIEW_TAB,
  type StockBrowserRow,
  stockFirst,
  stockGoodsKey,
  stockTabRows,
  stockTabStates,
} from '../src/hud/dom/parts/stock-browser.js';

const SHELF = 45;
const CATEGORIES = 3;
const DRINKS = 1;
const OTHER = 2;

function row(goodType: number, amount: number, category = 0, marked = false): StockBrowserRow {
  return {
    goodType,
    label: `good ${goodType}`,
    category,
    marked,
    amount,
    capacity: SHELF,
    tooltip: '',
    action: null,
  };
}

describe('stock browser', () => {
  it('puts the goods in stock first and keeps the owner’s order within each group', () => {
    expect(stockFirst([row(3, 0), row(1, 5), row(9, 0), row(4, 2)])).toEqual([1, 4, 3, 9]);
  });

  it('takes its order afresh only when the set of goods changes, never for an amount', () => {
    const before = stockGoodsKey([row(3, 0), row(1, 5)]);
    expect(stockGoodsKey([row(1, 0), row(3, 7)])).toBe(before);
    expect(stockGoodsKey([row(1, 0), row(4, 7)])).not.toBe(before);
  });

  it('writes whole units bare and a banked fraction with one decimal', () => {
    expect(amountText(12)).toBe('12');
    expect(amountText(7.3)).toBe('7.3');
  });

  it('counts each tab’s kinds in stock and dots a tab holding a marked good', () => {
    const rows = [row(1, 0, DRINKS), row(2, 3, OTHER), row(3, 4, OTHER, true), row(4, 0, DRINKS, true)];
    expect(stockTabStates(rows, CATEGORIES)).toEqual([
      { stocked: 0, marked: false },
      { stocked: 0, marked: true },
      { stocked: 2, marked: true },
    ]);
  });

  it('lists the largest stocks under the overview, most first, then one category per tab', () => {
    const rows = [row(1, 2, DRINKS), row(2, 0, OTHER), row(3, 9, OTHER), row(4, 2, OTHER)];
    expect(stockTabRows(rows, OVERVIEW_TAB).map((entry) => entry.goodType)).toEqual([3, 1, 4]);
    expect(stockTabRows(rows, OVERVIEW_TAB + 1 + OTHER).map((entry) => entry.goodType)).toEqual([2, 3, 4]);
    const many = Array.from({ length: OVERVIEW_LINES + 2 }, (_, index) => row(index, index + 1));
    expect(stockTabRows(many, OVERVIEW_TAB)).toHaveLength(OVERVIEW_LINES);
  });
});
