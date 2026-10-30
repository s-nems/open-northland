import type { AssistantCounterKind } from '../../../components/index.js';
import { WAVE_MIN_SOLDIERS } from '../military/muster.js';
import type { CraftSeat } from './craft.js';

/** The army demand a want's target follows: the recruits the seat's assistant counters still have to arm
 *  in a weapon class, or for armour in every class. */
export type ArmyNeed = 'armour' | 'sword' | 'spear' | 'bow';

/** What a want holds its stock to. */
export type StockTarget =
  /** The recruits still to arm ({@link ArmyNeed}) plus {@link ARMY_RESERVE_UNITS}. */
  | { readonly kind: 'army'; readonly need: ArmyNeed }
  /** `perConsumer` units per planned operator of the seat's built workshops that consume the good. */
  | { readonly kind: 'consumers'; readonly perConsumer: number }
  | { readonly kind: 'units'; readonly units: number };

/** One good, or goods worked together in rotation, a stock-driven type makes while their stock lies under
 *  its target. */
export interface StockWant {
  readonly goods: readonly string[];
  readonly target: StockTarget;
  /** The goods whose stock the target reads, by default `goods`: armour reads every armour in store, since a
   *  recruit takes whichever there is. */
  readonly counts?: readonly string[];
  /** A good whose earning ends the want: a weaker product made only while the better one is unearned. */
  readonly until?: string;
}

/**
 * A workplace type whose crew is shared out over its wants by stock each decision. Every want under its
 * target takes one operator, the most lacking army want first, then each spare operator goes to the want
 * that lacks the most beyond {@link OPERATOR_SHARE_UNITS} per operator it already has. Operators past every
 * want work the `overflow` seats in turn, or rest while there are none.
 */
export interface StockCraftPlan {
  readonly wants: readonly StockWant[];
  readonly overflow: readonly CraftSeat[];
  /** A stock plan has no sink: its wants size the crew's work. */
  readonly sink?: never;
}

/** The seat's reads a stock plan takes, each once per decision. */
export interface StockReads {
  /** The good type of a stable content id, or undefined where the content has no such good. */
  typeOf(id: string): number | undefined;
  units(good: number): number;
  /** The planned operators of the seat's built workshops whose recipes consume the good. */
  consumers(good: number): number;
  /** The recruits the seat's assistant counters still have to arm for `need`. */
  recruits(need: ArmyNeed): number;
  /** Whether the seat may make the good with this content id (its experience gates). */
  earned(id: string): boolean;
}

/** The arms a stock-driven type keeps in hand beyond the recruits still to arm (authored): a wave's draft,
 *  so the next draft finds them. */
export const ARMY_RESERVE_UNITS = WAVE_MIN_SOLDIERS;

/** The units one operator counts for against a want's lack once every want has one (authored): the crew's
 *  spare men follow the larger lack, a few cycles each. */
export const OPERATOR_SHARE_UNITS = 4;

/** A want held by an operator keeps him to its target; one nobody holds is taken up again only under its
 *  target by this share of the target, at least a unit (authored), so a stock at the line does not flip
 *  the crew with every unit made. */
export const STOCK_BAND_DIVISOR = 4;

/** The assistant counters each army need reads. */
const NEED_COUNTERS: Readonly<Record<ArmyNeed, readonly AssistantCounterKind[]>> = {
  sword: ['trainSword'],
  spear: ['trainSpear'],
  bow: ['trainBow'],
  armour: ['trainSword', 'trainSpear', 'trainBow'],
};

/** The counters an army need reads. */
export function needCounters(need: ArmyNeed): readonly AssistantCounterKind[] {
  return NEED_COUNTERS[need];
}

/** A want live this decision: its goods the type may make, by type id ascending, and its stock's lack. */
interface LiveWant {
  readonly want: StockWant;
  readonly goods: readonly number[];
  readonly army: boolean;
  readonly lack: number;
}

/** The units `target` asks for this decision. */
function targetUnits(reads: StockReads, target: StockTarget, goods: readonly number[]): number {
  switch (target.kind) {
    case 'army':
      return reads.recruits(target.need) + ARMY_RESERVE_UNITS;
    case 'consumers': {
      let consumers = 0;
      for (const good of goods) consumers = Math.max(consumers, reads.consumers(good));
      return consumers * target.perConsumer;
    }
    case 'units':
      return target.units;
  }
}

function typesOf(reads: StockReads, ids: readonly string[], products?: readonly number[]): number[] {
  const goods: number[] = [];
  for (const id of ids) {
    const good = reads.typeOf(id);
    if (good !== undefined && (products === undefined || products.includes(good)) && !goods.includes(good))
      goods.push(good);
  }
  return goods.sort((a, b) => a - b);
}

/** The plan's wants the seat lacks this decision, in priority order: the army wants by lack, the most
 *  first, then the rest by lack, authored order on a tie. A want an operator already works (`current`)
 *  reads its target, any other its target less the band, and ranks one share higher. */
function liveWants(
  plan: StockCraftPlan,
  reads: StockReads,
  products: readonly number[],
  current: readonly (readonly number[])[],
): LiveWant[] {
  const live: (LiveWant & { readonly rank: number; readonly order: number })[] = [];
  for (const [order, want] of plan.wants.entries()) {
    if (want.until !== undefined && reads.earned(want.until)) continue;
    const goods = typesOf(reads, want.goods, products);
    if (goods.length === 0) continue;
    const target = targetUnits(reads, want.target, goods);
    if (target <= 0) continue;
    let stock = 0;
    for (const good of typesOf(reads, want.counts ?? want.goods)) stock += reads.units(good);
    const held = current.some((selected) => sameGoods(selected, goods));
    const line = held ? target : target - Math.max(1, Math.ceil(target / STOCK_BAND_DIVISOR));
    if (stock >= line) continue;
    const lack = target - stock;
    const army = want.target.kind === 'army';
    live.push({ want, goods, army, lack, rank: lack + (held ? OPERATOR_SHARE_UNITS : 0), order });
  }
  return live.sort((a, b) => Number(b.army) - Number(a.army) || b.rank - a.rank || a.order - b.order);
}

/** A stock plan's seats this decision. */
export interface StockSeats {
  /** Each operator's seat, index for index with the crew: a want's goods, an overflow seat, or rest. */
  readonly seats: readonly CraftSeat[];
  /** What an operator whose seat lacks its inputs turns to: the live wants by rank, then the overflow. */
  readonly fallbacks: readonly CraftSeat[];
}

/**
 * The seat each operator of a stock-driven type works this decision, index for index with `current`,
 * the crew's live selections. An operator keeps the want he works while it still has a place for him, so
 * the crew moves only as the wants change.
 */
export function stockSeats(
  plan: StockCraftPlan,
  reads: StockReads,
  products: readonly number[],
  current: readonly (readonly number[])[],
): StockSeats {
  const wants = liveWants(plan, reads, products, current);
  const places = wants.map(() => 0);
  let left = current.length;
  for (let i = 0; i < wants.length && left > 0; i++, left--) places[i] = 1;
  while (left > 0) {
    let best = -1;
    let bestLack = 0;
    for (const [i, want] of wants.entries()) {
      const lack = want.lack - (places[i] ?? 0) * OPERATOR_SHARE_UNITS;
      if (lack > bestLack) {
        best = i;
        bestLack = lack;
      }
    }
    if (best < 0) break;
    places[best] = (places[best] ?? 0) + 1;
    left--;
  }
  const seats: (CraftSeat | undefined)[] = current.map(() => undefined);
  // First every operator already on a want with a place left keeps it, then the rest fill the places in
  // priority order, and whoever is left over works the overflow.
  for (const [op, selected] of current.entries()) {
    const i = wants.findIndex((want, w) => (places[w] ?? 0) > 0 && sameGoods(want.goods, selected));
    if (i < 0) continue;
    places[i] = (places[i] ?? 0) - 1;
    seats[op] = wants[i]?.want.goods;
  }
  let overflow = 0;
  for (const op of current.keys()) {
    if (seats[op] !== undefined) continue;
    const i = places.findIndex((n) => n > 0);
    if (i >= 0) {
      places[i] = (places[i] ?? 0) - 1;
      seats[op] = wants[i]?.want.goods;
      continue;
    }
    seats[op] = plan.overflow[overflow++ % Math.max(1, plan.overflow.length)] ?? REST_SEAT;
  }
  return {
    seats: seats.map((seat) => seat ?? REST_SEAT),
    fallbacks: [...wants.map((want) => want.want.goods), ...plan.overflow],
  };
}

/** The seat of an operator with nothing worth making: every product of his stopped. */
export const REST_SEAT = { rest: true } as const;

function sameGoods(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((g, i) => g === b[i]);
}
