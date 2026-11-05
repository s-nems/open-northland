import { type Entity, TRADE_LIMIT_NONE, type TraderView, type TradeStopView } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createPendingTradeMarks } from '../../../../src/view/unit-controls/panels/pending-trade-marks.js';

const TRADER = 4 as Entity;
const HOUSE_A = 10 as Entity;
const HOUSE_B = 11 as Entity;
const SWORD = 7;
const SPEAR = 8;
/** Past the overlay's hold of a press the sim never confirms. */
const LONG_AFTER = 100;

function stop(house: Entity, slot: number, imports: TradeStopView['imports'] = []): TradeStopView {
  return {
    slot,
    house,
    foreign: false,
    imports,
    offers: [],
    settlement: false,
    settles: true,
    sharesSettlement: false,
    settlementSuspended: false,
  };
}

function route(a: TradeStopView['imports'] = [], b: TradeStopView['imports'] = []): TraderView {
  return {
    stops: [stop(HOUSE_A, 0, a), stop(HOUSE_B, 1, b)],
    current: 0,
    agreement: -1,
    agreementHolds: false,
    given: 0,
    received: 0,
    giveKeep: TRADE_LIMIT_NONE,
    takeUpTo: TRADE_LIMIT_NONE,
    cart: null,
    cargo: [],
    ship: null,
    shipCargo: [],
    shipState: 'notNeeded',
  };
}

const unlimited = (good: number) => ({ good, upTo: TRADE_LIMIT_NONE, keep: TRADE_LIMIT_NONE });

describe('pending trade marks', () => {
  it('shows a pressed mark until the press could have applied, then gives way to the live route', () => {
    const pending = createPendingTradeMarks();
    const live = route();
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_B, good: SWORD, on: true }, 5);

    expect(pending.view(TRADER, live, 5)?.stops[1]?.imports).toEqual([unlimited(SWORD)]);
    expect(pending.view(TRADER, live, 6)?.stops[1]?.imports).toEqual([unlimited(SWORD)]);
    expect(pending.view(TRADER, live, 5 + LONG_AFTER)).toBe(live);
  });

  it('holds a press and its undo over a delayed route that still shows neither', () => {
    const pending = createPendingTradeMarks();
    const before = route();
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_B, good: SWORD, on: true }, 5);
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_B, good: SWORD, on: false }, 6);
    pending.view(TRADER, before, 7);

    // The first press lands alone a few ticks later; the window keeps showing the undo.
    expect(pending.view(TRADER, route([], [unlimited(SWORD)]), 8)?.stops[1]?.imports).toEqual([]);
  });

  it('clears the limits of a mark set again after a press cleared it, as the sim does', () => {
    const pending = createPendingTradeMarks();
    const live = route([{ good: SWORD, upTo: 20, keep: 3 }]);
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_A, good: SWORD, on: false }, 5);
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_A, good: SWORD, on: true }, 5);

    expect(pending.view(TRADER, live, 5)?.stops[0]?.imports).toEqual([unlimited(SWORD)]);
  });

  it('applies limits over a mark still pending, sorted among the live ones', () => {
    const pending = createPendingTradeMarks();
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_A, good: SWORD, on: true }, 5);
    pending.record(
      { kind: 'setTradeImportLimits', entity: TRADER, house: HOUSE_A, good: SWORD, upTo: 20, keep: 3 },
      5,
    );

    expect(pending.view(TRADER, route([unlimited(SPEAR)]), 5)?.stops[0]?.imports).toEqual([
      { good: SWORD, upTo: 20, keep: 3 },
      unlimited(SPEAR),
    ]);
  });

  it('snaps back to the live route when the sim never takes the press', () => {
    const pending = createPendingTradeMarks();
    const live = route([unlimited(SWORD)]);
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_A, good: SWORD, on: false }, 5);

    expect(pending.view(TRADER, live, 5)?.stops[0]?.imports).toEqual([]);
    expect(pending.view(TRADER, live, 5 + LONG_AFTER)).toBe(live);
  });

  it("leaves another trader's route and other commands alone", () => {
    const pending = createPendingTradeMarks();
    const live = route();
    pending.record({ kind: 'setTradeImport', entity: TRADER, house: HOUSE_A, good: SWORD, on: true }, 5);
    pending.record({ kind: 'marry', entity: TRADER }, 5);

    expect(pending.view(99, live, 5)).toBe(live);
  });
});
