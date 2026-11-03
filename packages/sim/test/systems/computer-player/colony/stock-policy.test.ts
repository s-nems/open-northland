import { describe, expect, it } from 'vitest';
import {
  type ColonyStockPolicy,
  colonyStockPolicy,
  keepPastSites,
  type StockPolicyRead,
  WORKSHOP_INPUT_FLOOR,
} from '../../../../src/systems/computer-player/colony/stock-policy.js';

const WOOD = 1;
const BRICK = 2;
const SHOES = 3;
const MEAD = 4;
const LEATHER = 5;
const SWORD = 6;
const HANDCART = 7;
const GOLD = 8;
const WOOD_FLOOR = 20;
const BRICK_FLOOR = 15;
const SHOES_RESERVE = 4;
const HOME_KEEPS = 9;

function read(overrides: Partial<StockPolicyRead> = {}): StockPolicyRead {
  return {
    buildingFloor: new Map([
      [WOOD, WOOD_FLOOR],
      [BRICK, BRICK_FLOOR],
    ]),
    settlerReserve: new Map([[SHOES, SHOES_RESERVE]]),
    wants: new Map(),
    workshopInputs: new Map(),
    makes: new Set(),
    held: new Map(),
    keptOnColony: new Set(),
    outboundNow: new Set(),
    homeKeep: () => HOME_KEEPS,
    homeWants: new Set(),
    ...overrides,
  };
}

const inboundOf = (policy: ColonyStockPolicy, good: number) => policy.inbound.find((m) => m.good === good);
const outboundOf = (policy: ColonyStockPolicy, good: number) => policy.outbound.find((m) => m.good === good);

describe('a colony stock policy', () => {
  it('fills the colony to its building floor and settler reserve, home keeping its own share', () => {
    const policy = colonyStockPolicy(read());
    expect(policy.inbound).toEqual([
      { good: WOOD, upTo: WOOD_FLOOR, keep: HOME_KEEPS },
      { good: BRICK, upTo: BRICK_FLOOR, keep: HOME_KEEPS },
      { good: SHOES, upTo: SHOES_RESERVE, keep: HOME_KEEPS },
    ]);
    expect(policy.outbound).toEqual([]);
  });

  it('asks nothing it makes but its building floor, and sends home what it makes above its floor', () => {
    const policy = colonyStockPolicy(
      read({
        makes: new Set([WOOD, SHOES, SWORD]),
        held: new Map([
          [WOOD, WOOD_FLOOR + 1],
          [SWORD, 3],
        ]),
      }),
    );
    expect(inboundOf(policy, SHOES)).toBeUndefined();
    expect(outboundOf(policy, SHOES)).toEqual({ good: SHOES, keep: SHOES_RESERVE });
    expect(outboundOf(policy, WOOD)).toEqual({ good: WOOD, keep: WOOD_FLOOR });
    expect(outboundOf(policy, SWORD)).toEqual({ good: SWORD, keep: 0 });
  });

  it("sends home what it holds above its floor of an input home's workshops lack, made there or not", () => {
    const held = new Map([[BRICK, BRICK_FLOOR + 2]]);
    expect(outboundOf(colonyStockPolicy(read({ held })), BRICK)).toBeUndefined();
    const policy = colonyStockPolicy(read({ held, homeWants: new Set([BRICK]) }));
    expect(outboundOf(policy, BRICK)).toEqual({ good: BRICK, keep: BRICK_FLOOR });
    expect(inboundOf(policy, BRICK)).toBeUndefined();
    const short = colonyStockPolicy(
      read({ held: new Map([[BRICK, BRICK_FLOOR - 1]]), homeWants: new Set([BRICK]) }),
    );
    expect(outboundOf(short, BRICK)).toBeUndefined();
  });

  it('moves a good it both makes and is filled up to one way at a time, meeting at the floor', () => {
    const at = (held: number, sending: boolean) =>
      colonyStockPolicy(
        read({
          makes: new Set([WOOD]),
          held: new Map([[WOOD, held]]),
          outboundNow: new Set(sending ? [WOOD] : []),
        }),
      );
    for (const policy of [at(WOOD_FLOOR - 1, true), at(WOOD_FLOOR, false)]) {
      expect(inboundOf(policy, WOOD)?.upTo).toBe(WOOD_FLOOR);
      expect(outboundOf(policy, WOOD)).toBeUndefined();
    }
    for (const policy of [at(WOOD_FLOOR + 1, false), at(WOOD_FLOOR, true)]) {
      expect(outboundOf(policy, WOOD)?.keep).toBe(WOOD_FLOOR);
      expect(inboundOf(policy, WOOD)).toBeUndefined();
    }
  });

  it('keeps at the colony what it fills the colony up to, for every good it moves either way', () => {
    const reads = [0, WOOD_FLOOR, 2 * WOOD_FLOOR].flatMap((held) =>
      [true, false].map((sending) =>
        read({
          makes: new Set([WOOD, BRICK, MEAD]),
          workshopInputs: new Map([
            [LEATHER, 0],
            [WOOD, 0],
          ]),
          settlerReserve: new Map([
            [SHOES, SHOES_RESERVE],
            [MEAD, 2],
          ]),
          held: new Map([
            [WOOD, held],
            [BRICK, held],
            [MEAD, held],
          ]),
          outboundNow: new Set(sending ? [WOOD, BRICK, MEAD] : []),
        }),
      ),
    );
    const upTo = new Map<number, number>();
    const keep = new Map<number, number>();
    for (const r of reads) {
      const policy = colonyStockPolicy(r);
      for (const m of policy.inbound) upTo.set(m.good, m.upTo);
      for (const m of policy.outbound) keep.set(m.good, m.keep);
      for (const m of policy.inbound) expect(outboundOf(policy, m.good)).toBeUndefined();
    }
    for (const [good, units] of keep) if (upTo.has(good)) expect(units).toBe(upTo.get(good));
    expect([...keep.keys()].filter((good) => upTo.has(good)).sort()).toEqual([WOOD, BRICK].sort());
  });

  it('brings in the inputs of its workshops at a small floor, unless it makes them', () => {
    const policy = colonyStockPolicy(
      read({
        workshopInputs: new Map([
          [LEATHER, 0],
          [GOLD, 0],
        ]),
        makes: new Set([GOLD]),
      }),
    );
    expect(inboundOf(policy, LEATHER)).toEqual({
      good: LEATHER,
      upTo: WORKSHOP_INPUT_FLOOR,
      keep: HOME_KEEPS,
    });
    expect(inboundOf(policy, GOLD)).toBeUndefined();
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: WORKSHOP_INPUT_FLOOR });
  });

  it('keeps an input its own workshops use up to their shelves before sending the rest home', () => {
    const shelves = 12;
    const policy = colonyStockPolicy(
      read({
        workshopInputs: new Map([[GOLD, shelves]]),
        makes: new Set([GOLD]),
        held: new Map([[GOLD, 20]]),
      }),
    );
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: shelves });
  });

  it('brings in what its buildings want past the rules, unless it makes it', () => {
    const oil = 9;
    const policy = colonyStockPolicy(read({ wants: new Map([[oil, 1]]) }));
    expect(inboundOf(policy, oil)).toEqual({ good: oil, upTo: 1, keep: HOME_KEEPS });
    expect(
      inboundOf(colonyStockPolicy(read({ wants: new Map([[oil, 1]]), makes: new Set([oil]) })), oil),
    ).toBeUndefined();
  });

  it('never sends what it keeps or what home brought it, and sends what it gathered', () => {
    const policy = colonyStockPolicy(
      read({
        makes: new Set([HANDCART]),
        keptOnColony: new Set([HANDCART]),
        held: new Map([
          [HANDCART, 2],
          [SHOES, 2 * SHOES_RESERVE],
          [GOLD, 3],
        ]),
      }),
    );
    expect(outboundOf(policy, HANDCART)).toBeUndefined();
    expect(outboundOf(policy, SHOES)).toBeUndefined();
    expect(outboundOf(policy, GOLD)).toEqual({ good: GOLD, keep: 0 });
  });
});

describe("home's keep for a colony's sites", () => {
  it('gives up what the standing sites lack past the colony store, never below none', () => {
    const lacking = new Map([[BRICK, 2]]);
    const keep = keepPastSites(() => HOME_KEEPS, lacking, new Map());
    expect(keep(BRICK)).toBe(HOME_KEEPS - 2);
    expect(keep(WOOD)).toBe(HOME_KEEPS);
    expect(keepPastSites(() => HOME_KEEPS, lacking, new Map([[BRICK, 2]]))(BRICK)).toBe(HOME_KEEPS);
    expect(keepPastSites(() => 1, lacking, new Map())(BRICK)).toBe(0);
  });
});
