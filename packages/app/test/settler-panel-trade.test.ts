import { describe, expect, it } from 'vitest';
import {
  TRADE_LIMIT_NONE,
  type TradeCategoryModel,
  type TradeDirection,
  type TradeGoodModel,
} from '../src/hud/details-panel/model/index.js';
import { reservedChipRows, TRADE_CHIPS_PER_ROW } from '../src/hud/dom/settler-panel/trade-goods.js';
import {
  categoryDirection,
  chipShortcut,
  directionAllowed,
  directionChanges,
  markedGoods,
  pressedDirection,
} from '../src/hud/dom/settler-panel/trade-marks.js';

const HOUSES = { a: 10, b: 20 };
const SWORD = 42;
const CEILING = 5;

function good(direction: TradeDirection, extra: Partial<TradeGoodModel> = {}): TradeGoodModel {
  return {
    goodType: SWORD,
    label: 'Sword',
    stockA: 12,
    stockB: 0,
    storedA: true,
    storedB: true,
    direction,
    upTo: TRADE_LIMIT_NONE,
    keep: TRADE_LIMIT_NONE,
    ...extra,
  };
}

function category(goods: readonly TradeGoodModel[]): TradeCategoryModel {
  return { tab: 0, label: 'Wojsko', goods };
}

describe('the Handel direction', () => {
  it('moves only the marks that change', () => {
    expect(directionChanges(good('none'), 'toB', HOUSES)).toEqual([{ house: 20, goodType: SWORD, on: true }]);
    expect(directionChanges(good('toA'), 'toB', HOUSES)).toEqual([
      { house: 10, goodType: SWORD, on: false },
      { house: 20, goodType: SWORD, on: true },
    ]);
    expect(directionChanges(good('both'), 'none', HOUSES)).toEqual([
      { house: 10, goodType: SWORD, on: false },
      { house: 20, goodType: SWORD, on: false },
    ]);
  });

  it('sets a kept mark again when the good turns balanced, so it sheds the limits it no longer shows', () => {
    expect(directionChanges(good('toB', { upTo: CEILING }), 'both', HOUSES)).toEqual([
      { house: 10, goodType: SWORD, on: true },
      { house: 20, goodType: SWORD, on: false },
      { house: 20, goodType: SWORD, on: true },
    ]);
    expect(directionChanges(good('toB'), 'both', HOUSES)).toEqual([{ house: 10, goodType: SWORD, on: true }]);
  });

  it('clears the good when the lit segment is pressed again', () => {
    expect(pressedDirection('toB', 'toB')).toBe('none');
    expect(pressedDirection('toB', 'both')).toBe('both');
  });

  it('toggles the balance on Ctrl and "→ B" on Shift, and leaves a plain press to choosing', () => {
    expect(chipShortcut('none', { ctrl: true, shift: false })).toBe('both');
    expect(chipShortcut('both', { ctrl: true, shift: false })).toBe('none');
    expect(chipShortcut('toA', { ctrl: false, shift: true })).toBe('toB');
    expect(chipShortcut('toB', { ctrl: false, shift: true })).toBe('none');
    expect(chipShortcut('toB', { ctrl: false, shift: false })).toBeNull();
  });

  it('refuses a direction into a house that does not store the good', () => {
    const onlyA = good('none', { storedB: false });
    expect(directionAllowed(onlyA, 'toA')).toBe(true);
    expect(directionAllowed(onlyA, 'toB')).toBe(false);
    expect(directionAllowed(onlyA, 'both')).toBe(false);
    expect(directionAllowed(onlyA, 'none')).toBe(true);
  });

  it('sends a whole tab to B on Ctrl, and clears it once every good already goes there', () => {
    expect(categoryDirection(category([good('toB'), good('none')]))).toBe('toB');
    expect(categoryDirection(category([good('toB'), good('toB')]))).toBe('none');
    expect(markedGoods([category([good('toB'), good('none'), good('both')])])).toBe(2);
  });

  it('reserves the chip rows of the fullest tab', () => {
    const many = Array.from({ length: TRADE_CHIPS_PER_ROW + 1 }, () => good('none'));
    expect(reservedChipRows([category([good('none')]), category(many)])).toBe(2);
    expect(reservedChipRows([category([])])).toBe(1);
  });
});
