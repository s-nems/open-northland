import { describe, expect, it } from 'vitest';
import {
  type SettlerPanelModel,
  TRADE_LIMIT_MAX,
  TRADE_LIMIT_NONE,
  TRADE_SLOT_A,
  TRADE_SLOT_B,
  type TradePanelModel,
} from '../src/hud/details-panel/model/index.js';
import { GLYPH } from '../src/hud/dom/icons.js';
import type { TradeMarkChange } from '../src/hud/dom/settler-panel/actions.js';
import { createTradeCommands } from '../src/hud/dom/trade-window/commands.js';
import {
  categoryTabs,
  firstStockedTab,
  houseRows,
  transferLine,
  UP_TO_UNLIMITED,
  windowRoute,
} from '../src/hud/dom/trade-window/model.js';
import {
  flowAllowed,
  flowChanges,
  rowPress,
  type TradeGood,
  tradeGood,
} from '../src/hud/dom/trade-window/route.js';
import {
  FOOD,
  FOOD_TAB,
  HOUSE_A,
  HOUSE_B,
  MILITARY_TAB,
  ownRoute,
  SWORD,
  SWORDS_AT_A,
  transfer,
} from './support/trade-route.js';

const CEILING = 10;
const RESERVE = 2;
const TRADER = 5;

function good(flow: TradeGood['flow'], extra: Partial<TradeGood> = {}): TradeGood {
  return {
    goodType: SWORD,
    flow,
    upTo: TRADE_LIMIT_NONE,
    keep: TRADE_LIMIT_NONE,
    storedA: true,
    storedB: true,
    ...extra,
  };
}

/** The commands against `trade`, with every order the window sends recorded. */
function recorded(trade: TradePanelModel) {
  const marks: TradeMarkChange[][] = [];
  const limits: { house: number; goodType: number; upTo: number; keep: number }[] = [];
  const commands = createTradeCommands(
    {
      setTradeMarks: (_id, changes) => marks.push([...changes]),
      setTradeImportLimits: (_id, house, goodType, upTo, keep) =>
        limits.push({ house, goodType, upTo, keep }),
    },
    () => ({ trader: TRADER, trade }),
  );
  return { commands, marks, limits };
}

describe('trade route marks', () => {
  const houses = { a: HOUSE_A, b: HOUSE_B };

  it('moves only the marks that change', () => {
    expect(flowChanges(good('none'), 'toB', houses)).toEqual([{ house: HOUSE_B, goodType: SWORD, on: true }]);
    expect(flowChanges(good('toA'), 'toB', houses)).toEqual([
      { house: HOUSE_A, goodType: SWORD, on: false },
      { house: HOUSE_B, goodType: SWORD, on: true },
    ]);
    expect(flowChanges(good('both'), 'none', houses)).toEqual([
      { house: HOUSE_A, goodType: SWORD, on: false },
      { house: HOUSE_B, goodType: SWORD, on: false },
    ]);
  });

  it('sets a kept mark again when the good turns balanced, so it sheds the limits it no longer shows', () => {
    expect(flowChanges(good('toB', { upTo: CEILING }), 'both', houses)).toEqual([
      { house: HOUSE_A, goodType: SWORD, on: true },
      { house: HOUSE_B, goodType: SWORD, on: false },
      { house: HOUSE_B, goodType: SWORD, on: true },
    ]);
    expect(flowChanges(good('toB'), 'both', houses)).toEqual([{ house: HOUSE_A, goodType: SWORD, on: true }]);
  });

  it('refuses a flow into a house that does not store the good', () => {
    const onlyA = good('none', { storedB: false });
    expect(flowAllowed(onlyA, 'toA')).toBe(true);
    expect(flowAllowed(onlyA, 'toB')).toBe(false);
    expect(flowAllowed(onlyA, 'both')).toBe(false);
    expect(flowAllowed(onlyA, 'none')).toBe(true);
  });

  it('adds a transfer out of the row’s house, balances on Ctrl and drops a transfer on a lit arrow', () => {
    expect(rowPress('none', TRADE_SLOT_A, false)).toBe('toB');
    expect(rowPress('none', TRADE_SLOT_B, false)).toBe('toA');
    expect(rowPress('toA', TRADE_SLOT_A, false)).toBe('none');
    expect(rowPress('both', TRADE_SLOT_B, false)).toBe('none');
    expect(rowPress('none', TRADE_SLOT_A, true)).toBe('both');
    expect(rowPress('toB', TRADE_SLOT_A, true)).toBe('both');
    expect(rowPress('both', TRADE_SLOT_A, true)).toBe('none');
  });

  it('reads a good’s flow and stores off the route', () => {
    expect(tradeGood(ownRoute([transfer(SWORD, 'toB')]), SWORD)).toMatchObject({
      flow: 'toB',
      storedA: true,
      storedB: true,
    });
    expect(tradeGood(ownRoute(), FOOD)).toMatchObject({ flow: 'none', storedA: true, storedB: false });
  });
});

describe('trade window model', () => {
  it('shows only a route of two own houses', () => {
    const settler = (trade: TradePanelModel | null) => ({ trade }) as SettlerPanelModel;
    expect(windowRoute(settler(ownRoute()))).not.toBeNull();
    expect(windowRoute(settler({ ...ownRoute(), stock: null }))).toBeNull();
    expect(windowRoute(settler(null))).toBeNull();
  });

  it('counts the kinds in stock per tab, lights a tab with a transfer and opens on the first stocked one', () => {
    const tabs = categoryTabs(ownRoute([transfer(SWORD, 'toB')]));
    expect(tabs[FOOD_TAB]).toMatchObject({ count: 1, marked: false });
    expect(tabs[MILITARY_TAB]).toMatchObject({ count: 1, marked: true });
    expect(tabs[MILITARY_TAB]?.tooltip).toContain(tabs[MILITARY_TAB]?.label ?? '?');
    expect(tabs.filter((tab) => tab.count === 0)).toHaveLength(tabs.length - 2);
    expect(firstStockedTab(ownRoute())).toBe(FOOD_TAB);
  });

  it('lists a house’s goods of the open tab with an arrow into the other house', () => {
    const trade = ownRoute();
    const [sword] = houseRows(trade, TRADE_SLOT_A, MILITARY_TAB);
    expect(sword).toMatchObject({ goodType: SWORD, amount: SWORDS_AT_A });
    expect(sword?.action).toMatchObject({ glyph: GLYPH.arrow, pressed: false, enabled: true });
    expect(sword?.tooltip).toContain(`A ${SWORDS_AT_A}`);
    // B stores no food, so A's food cannot go there.
    expect(houseRows(trade, TRADE_SLOT_A, FOOD_TAB)[0]?.action?.enabled).toBe(false);
    expect(houseRows(trade, TRADE_SLOT_B, MILITARY_TAB)[0]?.action?.glyph).toBe(GLYPH.arrowLeft);
    expect(houseRows(trade, TRADE_SLOT_B, FOOD_TAB)).toEqual([]);
  });

  it('lights the arrow of a good in a transfer on both sides, pointing the way it goes', () => {
    const trade = ownRoute([transfer(SWORD, 'toB')]);
    expect(houseRows(trade, TRADE_SLOT_A, MILITARY_TAB)[0]?.action).toMatchObject({
      glyph: GLYPH.arrow,
      pressed: true,
    });
    expect(houseRows(trade, TRADE_SLOT_B, MILITARY_TAB)[0]?.action).toMatchObject({
      glyph: GLYPH.arrow,
      pressed: true,
    });
    const balanced = ownRoute([transfer(SWORD, 'both')]);
    expect(houseRows(balanced, TRADE_SLOT_B, MILITARY_TAB)[0]?.action?.glyph).toBe(GLYPH.swap);
  });

  it('gives a transfer line its lit direction, the refused ones and the one-way limits', () => {
    const line = transferLine(ownRoute(), transfer(SWORD, 'toB', { upTo: CEILING, keep: RESERVE }));
    expect(line.directions.map((option) => [option.direction, option.pressed, option.enabled])).toEqual([
      ['toB', true, true],
      ['both', false, true],
      ['toA', false, true],
    ]);
    expect(line.limits).toMatchObject({ upTo: CEILING, keep: RESERVE });
    expect(line.limits?.upToTooltip).toContain('Koszary');
    expect(line.limits?.keepTooltip).toContain('Magazyn');
    expect(transferLine(ownRoute(), transfer(SWORD, 'toB')).limits?.upTo).toBe(UP_TO_UNLIMITED);
    expect(transferLine(ownRoute(), transfer(SWORD, 'both')).limits).toBeNull();
    const food = transferLine(ownRoute(), transfer(FOOD, 'toA'));
    expect(food.directions.filter((option) => !option.enabled).map((option) => option.direction)).toEqual([
      'toB',
      'both',
    ]);
  });
});

describe('trade window commands', () => {
  it('adds a transfer into the other house from a row’s arrow, and a balance with Ctrl', () => {
    const { commands, marks } = recorded(ownRoute());
    commands.arrow(TRADE_SLOT_A, SWORD, false);
    commands.arrow(TRADE_SLOT_B, SWORD, true);
    expect(marks).toEqual([
      [{ house: HOUSE_B, goodType: SWORD, on: true }],
      [
        { house: HOUSE_A, goodType: SWORD, on: true },
        { house: HOUSE_B, goodType: SWORD, on: true },
      ],
    ]);
  });

  it('refuses an arrow into a house that does not store the good', () => {
    const { commands, marks } = recorded(ownRoute());
    commands.arrow(TRADE_SLOT_A, FOOD, false);
    expect(marks).toEqual([]);
  });

  it('turns a transfer with the direction strip and removes it with ✕', () => {
    const { commands, marks } = recorded(ownRoute([transfer(SWORD, 'toB')]));
    commands.setFlow(SWORD, 'toA');
    commands.setFlow(SWORD, 'none');
    expect(marks).toEqual([
      [
        { house: HOUSE_A, goodType: SWORD, on: true },
        { house: HOUSE_B, goodType: SWORD, on: false },
      ],
      [{ house: HOUSE_B, goodType: SWORD, on: false }],
    ]);
  });

  it('sends the counters to the house the transfer fills, ∞ as no ceiling', () => {
    const { commands, limits } = recorded(ownRoute([transfer(SWORD, 'toB')]));
    commands.setLimits(SWORD, CEILING, RESERVE);
    commands.setLimits(SWORD, UP_TO_UNLIMITED, TRADE_LIMIT_MAX);
    expect(limits).toEqual([
      { house: HOUSE_B, goodType: SWORD, upTo: CEILING, keep: RESERVE },
      { house: HOUSE_B, goodType: SWORD, upTo: TRADE_LIMIT_NONE, keep: TRADE_LIMIT_MAX },
    ]);
    const balanced = recorded(ownRoute([transfer(SWORD, 'both')]));
    balanced.commands.setLimits(SWORD, CEILING, RESERVE);
    expect(balanced.limits).toEqual([]);
  });
});
