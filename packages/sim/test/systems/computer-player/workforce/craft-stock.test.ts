import { describe, expect, it } from 'vitest';
import {
  ARMY_RESERVE_UNITS,
  type ArmyNeed,
  OPERATOR_SHARE_UNITS,
  REST_SEAT,
  STOCK_BAND_DIVISOR,
  type StockCraftPlan,
  type StockReads,
  stockSeats,
} from '../../../../src/systems/computer-player/workforce/craft-stock.js';

const PLATE = 1;
const SWORD = 2;
const SPEAR = 3;
const SHORT = 4;
const GOODS: Readonly<Record<string, number>> = { plate: PLATE, sword: SWORD, spear: SPEAR, short: SHORT };
const PRODUCTS = [PLATE, SWORD, SPEAR, SHORT];
/** Operators of the workshops consuming {@link SHORT} in the fake seat. */
const SHORT_CONSUMERS = 3;

const PLAN: StockCraftPlan = {
  wants: [
    { goods: ['plate'], target: { kind: 'army', need: 'armour' } },
    { goods: ['sword'], target: { kind: 'army', need: 'sword' } },
    { goods: ['spear'], target: { kind: 'army', need: 'spear' } },
    { goods: ['short'], target: { kind: 'army', need: 'sword' }, until: 'sword' },
    { goods: ['short'], target: { kind: 'consumers', perConsumer: 1 } },
  ],
  overflow: [['sword', 'spear'], ['plate']],
};

function reads(
  stock: Readonly<Partial<Record<number, number>>> = {},
  recruits: Readonly<Partial<Record<ArmyNeed, number>>> = {},
  unearned: readonly string[] = [],
  readying = false,
): StockReads {
  return {
    typeOf: (id) => GOODS[id],
    units: (good) => stock[good] ?? 0,
    consumers: (good) => (good === SHORT ? SHORT_CONSUMERS : 0),
    recruits: (need) => recruits[need] ?? 0,
    earned: (id) => !unearned.includes(id),
    readying: () => readying,
  };
}

/** The seats of a crew of `crew` operators with nothing selected yet. */
function fresh(crew: number): (readonly number[])[] {
  return Array.from({ length: crew }, () => []);
}

describe('stock-driven craft seats', () => {
  it('gives every army want a man first, the most lacking first, then the inputs, then the larger lack', () => {
    const r = reads({}, { armour: 10, sword: 2 });
    expect(stockSeats(PLAN, r, PRODUCTS, fresh(2)).seats).toEqual([['plate'], ['sword']]);
    // Five men: one each on the three army wants and the input buffer, and a second on the armour, which
    // lacks the most beyond the share its first man covers; the places fill in rank order.
    expect(stockSeats(PLAN, r, PRODUCTS, fresh(5)).seats).toEqual([
      ['plate'],
      ['plate'],
      ['sword'],
      ['spear'],
      ['short'],
    ]);
  });

  it('holds the army wants to the recruits still to arm and a reserve', () => {
    const target = 7 + ARMY_RESERVE_UNITS;
    expect(stockSeats(PLAN, reads({ [SWORD]: target - 1 }, { sword: 7 }), [SWORD], [[SWORD]]).seats).toEqual([
      ['sword'],
    ]);
    // At the line every want is met and the man works the overflow.
    expect(stockSeats(PLAN, reads({ [SWORD]: target }, { sword: 7 }), [SWORD], [[SWORD]]).seats).toEqual([
      ['sword', 'spear'],
    ]);
  });

  it('stocks a ready want past the reserve once the seat readies for its deadline', () => {
    const READY = 3 * ARMY_RESERVE_UNITS;
    const plan: StockCraftPlan = {
      wants: [{ goods: ['sword'], target: { kind: 'army', need: 'sword', readyStock: READY } }],
      overflow: [],
    };
    const work = (readying: boolean) =>
      stockSeats(
        plan,
        reads({ [SWORD]: ARMY_RESERVE_UNITS + 1 }, { sword: 1 }, [], readying),
        [SWORD],
        [[SWORD]],
      ).seats;
    expect(work(false)).toEqual([REST_SEAT]);
    expect(work(true)).toEqual([['sword']]);
  });

  it('takes a want nobody works up again only under its band', () => {
    const band = Math.ceil(ARMY_RESERVE_UNITS / STOCK_BAND_DIVISOR);
    const work = (units: number) =>
      stockSeats(PLAN, reads({ [SPEAR]: units }), [SPEAR], [[SWORD, SPEAR]]).seats;
    expect(work(ARMY_RESERVE_UNITS - band)).toEqual([['sword', 'spear']]);
    expect(work(ARMY_RESERVE_UNITS - band - 1)).toEqual([['spear']]);
  });

  it('keeps an operator on the want he works while it has a place for him', () => {
    const r = reads({}, { armour: 10 });
    expect(stockSeats(PLAN, r, PRODUCTS, [[SPEAR], [PLATE]]).seats).toEqual([['spear'], ['plate']]);
  });

  it('sizes an input buffer to its consumers and drops a want once its better product is earned', () => {
    const short = (stock: number, unearned: readonly string[]) =>
      stockSeats(PLAN, reads({ [SHORT]: stock }, {}, unearned), [SHORT], [[SHORT]]).seats;
    expect(short(SHORT_CONSUMERS - 1, [])).toEqual([['short']]);
    // The buffer full: the lone short-sword smith turns to the overflow.
    expect(short(SHORT_CONSUMERS, [])).toEqual([['sword', 'spear']]);
    // While the long sword is unearned the short sword arms the swordsmen too.
    expect(short(SHORT_CONSUMERS, ['sword'])).toEqual([['short']]);
  });

  it('works the overflow seats in turn past every want, and rests a plan without any', () => {
    const met = reads({ [PLATE]: 10, [SWORD]: 10, [SPEAR]: 10, [SHORT]: 10 });
    expect(stockSeats(PLAN, met, PRODUCTS, fresh(3)).seats).toEqual([
      ['sword', 'spear'],
      ['plate'],
      ['sword', 'spear'],
    ]);
    expect(stockSeats({ ...PLAN, overflow: [] }, met, PRODUCTS, fresh(2)).seats).toEqual([
      REST_SEAT,
      REST_SEAT,
    ]);
  });

  it('lists the useful wants as surplus, the army first, each goods list once', () => {
    const met = reads({ [PLATE]: 10, [SWORD]: 10, [SPEAR]: 10, [SHORT]: 10 });
    // The army short sword ended by the long sword shares its goods with the input buffer: listed once.
    expect(stockSeats(PLAN, met, PRODUCTS, fresh(1)).surplus).toEqual([
      ['plate'],
      ['sword'],
      ['spear'],
      ['short'],
    ]);
    const inputFirst: StockCraftPlan = {
      wants: [
        { goods: ['short'], target: { kind: 'consumers', perConsumer: 1 } },
        { goods: ['plate'], target: { kind: 'army', need: 'armour' } },
      ],
      overflow: [],
    };
    expect(stockSeats(inputFirst, met, PRODUCTS, fresh(1)).surplus).toEqual([['plate'], ['short']]);
    // A good the seat may not make is no surplus, nor an input nobody consumes.
    expect(stockSeats(inputFirst, met, [SHORT], fresh(1)).surplus).toEqual([['short']]);
    const noConsumers: StockReads = { ...met, consumers: () => 0 };
    expect(stockSeats(inputFirst, noConsumers, PRODUCTS, fresh(1)).surplus).toEqual([['plate']]);
  });

  it('counts a spare operator against the share each man already covers', () => {
    // Lacks of four shares and one: the first man of each covers his share, so the third and fourth both
    // go to the armour.
    const armour = 4 * OPERATOR_SHARE_UNITS;
    const r = reads(
      { [SWORD]: ARMY_RESERVE_UNITS - OPERATOR_SHARE_UNITS },
      { armour: armour - ARMY_RESERVE_UNITS },
    );
    expect(stockSeats(PLAN, r, [PLATE, SWORD], fresh(4)).seats).toEqual([
      ['plate'],
      ['plate'],
      ['plate'],
      ['sword'],
    ]);
  });
});
