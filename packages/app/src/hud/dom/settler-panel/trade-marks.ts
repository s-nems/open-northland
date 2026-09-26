import type {
  TradeCategoryModel,
  TradeDirection,
  TradeGoodModel,
  TradePanelModel,
  TradeStopModel,
} from '../../details-panel/model/index.js';
import { TRADE_LIMIT_NONE, TRADE_SLOT_A, TRADE_SLOT_B } from '../../details-panel/model/index.js';
import type { TradeMarkChange } from './actions.js';

/** Where each direction puts the good's marks: at A (carried into A), at B, or both (balanced). */
const MARKED_AT: Readonly<Record<TradeDirection, { readonly a: boolean; readonly b: boolean }>> = {
  none: { a: false, b: false },
  toA: { a: true, b: false },
  toB: { a: false, b: true },
  both: { a: true, b: true },
};

/** The houses of a two-stop route by slot, or null while the route is shorter. */
export function routeHouses(
  stops: readonly TradeStopModel[],
): { readonly a: number; readonly b: number } | null {
  const a = stops.find((stop) => stop.slot === TRADE_SLOT_A)?.house;
  const b = stops.find((stop) => stop.slot === TRADE_SLOT_B)?.house;
  return a === undefined || b === undefined ? null : { a, b };
}

/** Whether the good can move `direction`: every house it is carried into must store it. */
export function directionAllowed(good: TradeGoodModel, direction: TradeDirection): boolean {
  const marks = MARKED_AT[direction];
  return (!marks.a || good.storedA) && (!marks.b || good.storedB);
}

/**
 * The mark changes that turn `good` to `to`. A mark kept for the balance is cleared and set again when
 * it had limits: the balanced flow shows no counters, so it must carry none.
 */
export function directionChanges(
  good: TradeGoodModel,
  to: TradeDirection,
  houses: { readonly a: number; readonly b: number },
): TradeMarkChange[] {
  const was = MARKED_AT[good.direction];
  const will = MARKED_AT[to];
  const limited = good.upTo !== TRADE_LIMIT_NONE || good.keep !== TRADE_LIMIT_NONE;
  const changes: TradeMarkChange[] = [];
  for (const side of ['a', 'b'] as const) {
    const house = houses[side];
    if (was[side] !== will[side]) changes.push({ house, goodType: good.goodType, on: will[side] });
    else if (will[side] && to === 'both' && limited) {
      changes.push(
        { house, goodType: good.goodType, on: false },
        { house, goodType: good.goodType, on: true },
      );
    }
  }
  return changes;
}

/** A direction segment's press: the lit one clears the good, another one sets it. */
export function pressedDirection(current: TradeDirection, pressed: TradeDirection): TradeDirection {
  return current === pressed ? 'none' : pressed;
}

/** A good chip's modifier press: Ctrl toggles the balance, Shift toggles "→ B"; null for a plain press. */
export function chipShortcut(
  current: TradeDirection,
  keys: { readonly ctrl: boolean; readonly shift: boolean },
): TradeDirection | null {
  if (keys.ctrl) return pressedDirection(current, 'both');
  if (keys.shift) return pressedDirection(current, 'toB');
  return null;
}

/** The goods of a category Ctrl + click on its tab sends "→ B": those B stores. */
export function categoryTargets(category: TradeCategoryModel): readonly TradeGoodModel[] {
  return category.goods.filter((good) => good.storedB);
}

/** Ctrl + click on a tab: every good to B, or back to none when every one already goes to B. */
export function categoryDirection(category: TradeCategoryModel): TradeDirection {
  const targets = categoryTargets(category);
  return targets.length > 0 && targets.every((good) => good.direction === 'toB') ? 'none' : 'toB';
}

/** The route's good of `goodType`, in whichever category it sits. */
export function goodOf(trade: TradePanelModel, goodType: number | null): TradeGoodModel | undefined {
  if (goodType === null) return undefined;
  for (const category of trade.categories) {
    const good = category.goods.find((candidate) => candidate.goodType === goodType);
    if (good !== undefined) return good;
  }
  return undefined;
}

export function markedGoods(categories: readonly TradeCategoryModel[]): number {
  let marked = 0;
  for (const category of categories) {
    for (const good of category.goods) if (good.direction !== 'none') marked++;
  }
  return marked;
}
