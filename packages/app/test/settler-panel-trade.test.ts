import { describe, expect, it } from 'vitest';
import type { TradePanelModel } from '../src/hud/details-panel/model/index.js';
import { bodyOf } from '../src/hud/dom/settler-panel/trade.js';
import { slotState } from '../src/hud/dom/settler-panel/trade-stops.js';
import {
  fitTransferLines,
  transferSummary,
  transferTooltip,
} from '../src/hud/dom/settler-panel/trade-transfers.js';
import { formatMessage, messages, pluralForm } from '../src/i18n/index.js';
import { ownRoute, SWORD, transfer } from './support/trade-route.js';

const CEILING = 10;
const RESERVE = 2;
const LINE_PX = 22;
const TRANSFERS = 12;

describe('the settler panel’s Handel summary', () => {
  it('offers the trade window only for two own stops, the agreement for a foreign one', () => {
    expect(bodyOf(ownRoute())).toEqual({ own: true, agreement: false });
    const foreign: TradePanelModel = { ...ownRoute(), stock: null, foreign: true };
    expect(bodyOf(foreign)).toEqual({ own: false, agreement: true });
    const one: TradePanelModel = {
      ...ownRoute(),
      stops: ownRoute().stops.slice(0, 1),
      stock: null,
      attachSlot: 1,
    };
    expect(bodyOf(one)).toEqual({ own: false, agreement: false });
  });

  it('reads "Dodaj punkt handlowy" on both free slots, also while A is empty', () => {
    const empty: TradePanelModel = { ...ownRoute(), stops: [], stock: null, attachSlot: 0 };
    expect([slotState(empty, 0).kind, slotState(empty, 1).kind]).toEqual(['attach', 'attach']);
    const onlyB: TradePanelModel = {
      ...ownRoute(),
      stops: ownRoute().stops.slice(1),
      stock: null,
      attachSlot: 0,
    };
    expect([slotState(onlyB, 0).kind, slotState(onlyB, 1).kind]).toEqual(['attach', 'stop']);
    expect(messages().hud.settlerPanel.tradeAddStop).toBe('Dodaj punkt handlowy');
  });

  it('writes a transfer as its direction and its limits, and says it in words in the tooltip', () => {
    const limited = transfer(SWORD, 'toB', { upTo: CEILING, keep: RESERVE });
    expect(transferSummary(limited)).toBe('A → B · do 10 · zostaw 2');
    expect(transferSummary(transfer(SWORD, 'toA'))).toBe('B → A');
    expect(transferSummary(transfer(SWORD, 'both'))).toBe('A ⇄ B');
    expect(transferTooltip(limited)).toBe(
      `${limited.label}: wieź z A do B, aż w B będzie 10, zawsze zostaw 2 w A`,
    );
  });

  it('keeps the transfer lines that fit and turns the last one kept into the link for the rest', () => {
    expect(fitTransferLines(TRANSFERS, 0, LINE_PX)).toEqual({ lines: TRANSFERS, more: 0 });
    // Five lines' worth past the plane (the last partly): five go, and the seventh line is the link.
    const fiveLines = 4 * LINE_PX + 1;
    expect(fitTransferLines(TRANSFERS, fiveLines, LINE_PX)).toEqual({ lines: 6, more: 6 });
    // One line too many: the eleventh place links to the last two.
    expect(fitTransferLines(TRANSFERS, 1, LINE_PX)).toEqual({ lines: 10, more: 2 });
    // Room for one line only: the link alone.
    expect(fitTransferLines(TRANSFERS, (TRANSFERS - 1) * LINE_PX, LINE_PX)).toEqual({
      lines: 0,
      more: TRANSFERS,
    });
    // No room even for the link: the section folds.
    expect(fitTransferLines(TRANSFERS, TRANSFERS * LINE_PX, LINE_PX)).toBeNull();
  });

  it('counts the transfers the link leaves out in the locale’s plural', () => {
    const copy = messages().hud.settlerPanel;
    const more = (count: number) =>
      formatMessage(pluralForm(count, copy.tradeTransferCount, 'pl'), { count });
    expect([1, 3, 6].map(more)).toEqual(['jeszcze 1 przewóz', 'jeszcze 3 przewozy', 'jeszcze 6 przewozów']);
  });
});
