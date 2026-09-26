import {
  TRADE_LIMIT_NONE,
  type TradeDirection,
  type TradePanelModel,
  type TradeStockRow,
  type TradeTransferModel,
} from '../../src/hud/details-panel/model/index.js';

/** The houses of the fixture route: A and B, both the player's own. */
export const HOUSE_A = 10;
export const HOUSE_B = 20;
/** The fixture's goods: swords both houses store, food only A stores. */
export const SWORD = 42;
export const FOOD = 7;
/** The stock categories the fixture's goods sit in (food, military). */
export const FOOD_TAB = 0;
export const MILITARY_TAB = 6;
const SHELF = 45;
export const SWORDS_AT_A = 12;
export const FOOD_AT_A = 20;

export function stockRow(goodType: number, category: number, amount: number): TradeStockRow {
  return { goodType, label: `good ${goodType}`, category, amount, capacity: SHELF };
}

export function transfer(
  goodType: number,
  direction: TradeDirection,
  extra: Partial<TradeTransferModel> = {},
): TradeTransferModel {
  return {
    goodType,
    label: `good ${goodType}`,
    category: goodType === FOOD ? FOOD_TAB : MILITARY_TAB,
    direction,
    upTo: TRADE_LIMIT_NONE,
    keep: TRADE_LIMIT_NONE,
    ...extra,
  };
}

/** A two-stop own route: A holds swords and food, B stores swords only and holds none. */
export function ownRoute(transfers: readonly TradeTransferModel[] = []): TradePanelModel {
  return {
    stops: [
      { slot: 0, house: HOUSE_A, label: 'Magazyn', foreign: false, heading: true },
      { slot: 1, house: HOUSE_B, label: 'Koszary', foreign: false, heading: false },
    ],
    attachSlot: null,
    foreign: false,
    stock: {
      a: [stockRow(SWORD, MILITARY_TAB, SWORDS_AT_A), stockRow(FOOD, FOOD_TAB, FOOD_AT_A)],
      b: [stockRow(SWORD, MILITARY_TAB, 0)],
    },
    transfers,
    offers: [],
    agreementHolds: false,
  };
}
