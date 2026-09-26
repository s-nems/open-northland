import { describe, expect, it } from 'vitest';
import {
  amountText,
  type StockBrowserRow,
  stockFirst,
  stockGoodsKey,
} from '../src/hud/dom/parts/stock-browser.js';

const SHELF = 45;

function row(goodType: number, amount: number): StockBrowserRow {
  return { goodType, label: `good ${goodType}`, amount, capacity: SHELF, tooltip: '', action: null };
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
});
