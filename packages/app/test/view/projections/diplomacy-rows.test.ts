import type { OpenTribute, TradeOffer } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../../../src/catalog/roster.js';
import {
  type DiplomacySimView,
  diplomacyMapNations,
  diplomacyMetSeats,
  diplomacyPanelRows,
  harshestStance,
} from '../../../src/view/projections/diplomacy-rows.js';

/** A sim stub over explicit met pairs, stances and locked pairs; unset pairs read the sim's `enemy`
 *  default. */
function simView(
  met: readonly [number, number][],
  stances: readonly [number, number, 'friend' | 'neutral' | 'enemy'][],
  owed: readonly OpenTribute[] = [],
  locked: readonly [number, number][] = [],
  traded: readonly [number, number, number][] = [],
  offers: ReadonlyMap<number, readonly TradeOffer[]> = new Map(),
): DiplomacySimView {
  const metSet = new Set(met.map(([v, o]) => `${v}:${o}`));
  const stanceMap = new Map(stances.map(([f, t, s]) => [`${f}:${t}`, s]));
  return {
    hasMetPlayer: (viewer, other) => viewer === other || metSet.has(`${viewer}:${other}`),
    diplomacyStance: (from, to) => stanceMap.get(`${from}:${to}`) ?? 'enemy',
    diplomacyLocked: (a, b) => locked.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
    openTributes: () => owed,
    goodsTradedWith: (player, partner) =>
      traded.find(([from, to]) => from === player && to === partner)?.[2] ?? 0,
    tradeOffersOf: (partner) => offers.get(partner) ?? [],
  };
}

describe('diplomacyPanelRows', () => {
  it('lists only discovered roster players, viewer excluded, with both directed stances', () => {
    const sim = simView(
      [[0, 2]],
      [
        [2, 0, 'friend'],
        [0, 2, 'neutral'],
      ],
    );
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2],
      observer: false,
      seatNameOf: (p) => (p === 2 ? 'Mieszkańcy Lasu' : undefined),
    });
    expect(rows).toEqual([
      {
        player: 2,
        name: 'Mieszkańcy Lasu',
        colour: PLAYER_SWATCH_COLORS[2],
        towardYou: 'friend',
        yourStance: 'neutral',
        canDeclare: true,
        tributes: [],
        tradeOffers: [],
      },
    ]);
  });

  it('carries the traded-goods tally only for a player both sides hold as friend', () => {
    const met: [number, number][] = [
      [0, 1],
      [0, 2],
    ];
    const sim = simView(
      met,
      [
        [0, 1, 'friend'],
        [1, 0, 'friend'],
        [0, 2, 'friend'],
        [2, 0, 'neutral'],
      ],
      [],
      [],
      [
        [0, 1, 12],
        [0, 2, 5],
      ],
    );
    const rows = diplomacyPanelRows(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: false });
    expect(rows.map((r) => [r.player, r.goodsTraded])).toEqual([
      [1, 12],
      [2, undefined],
    ]);
  });

  it("lists what each player trades in the goods' own names, numbered where a label is missing", () => {
    const FURNITURE = 29;
    const COIN = 8;
    const sim = simView(
      [[0, 1]],
      [],
      [],
      [],
      [],
      new Map([[1, [{ index: 0, giveGood: FURNITURE, giveAmount: 1, takeGood: COIN, takeAmount: 2 }]]]),
    );
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1],
      observer: false,
      goodLabelOf: (good) => (good === FURNITURE ? 'Meble' : undefined),
    });
    expect(rows[0]?.tradeOffers).toEqual([
      {
        index: 0,
        give: { goodType: FURNITURE, amount: 1, label: 'Meble' },
        take: { goodType: COIN, amount: 2, label: String(COIN) },
      },
    ]);
  });

  it('drops a pair the map hides and takes the stance buttons off a locked pair or a page it closes', () => {
    const met: [number, number][] = [1, 2, 3, 4].map((p) => [0, p]);
    const sim = simView(met, [], [], [[2, 0]]);
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2, 3, 4],
      observer: false,
      relationFlags: [
        { kind: 'hide', a: 1, b: 0 },
        { kind: 'hideDetails', a: 0, b: 3 },
        { kind: 'hide', a: 2, b: 4 }, // a pair the viewer is not part of
      ],
    });
    expect(rows.map((r) => [r.player, r.canDeclare])).toEqual([
      [2, false],
      [3, false],
      [4, true],
    ]);
    const spectator = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 4],
      observer: false,
      canDeclare: false,
    });
    expect(spectator.map((r) => r.canDeclare)).toEqual([false]);
  });

  it('hands each row the tributes owed to its player with the demanded good labels', () => {
    const owed: OpenTribute[] = [
      { slot: 3, receiver: 2, stringId: 930, demands: [{ good: 5, amount: 6, onHand: 8 }], payable: true },
      { slot: 1, receiver: 1, stringId: 931, demands: [{ good: 8, amount: 20, onHand: 5 }], payable: false },
    ];
    const sim = simView(
      [
        [0, 1],
        [0, 2],
      ],
      [],
      owed,
    );
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2],
      observer: false,
      goodLabelOf: (good) => (good === 5 ? 'Drewno' : undefined),
    });
    expect(rows.map((r) => r.tributes)).toEqual([
      [{ slot: 1, demands: [{ goodType: 8, label: '8', amount: 20, onHand: 5 }], payable: false }],
      [
        {
          slot: 3,
          demands: [{ goodType: 5, label: 'Drewno', amount: 6, onHand: 8 }],
          payable: true,
        },
      ],
    ]);
  });

  it('projects the sim`s payable flag and deadens every button for a seat that may not pay', () => {
    const owed: OpenTribute[] = [
      { slot: 2, receiver: 1, stringId: 1, demands: [{ good: 3, amount: 5, onHand: 4 }], payable: false },
      { slot: 5, receiver: 1, stringId: 2, demands: [{ good: 5, amount: 2, onHand: 4 }], payable: true },
    ];
    const sim = simView([[0, 1]], [], owed);
    const roster = { localPlayer: 0, rosterPlayers: [0, 1], observer: false };
    expect(diplomacyPanelRows(sim, roster)[0]?.tributes.map((t) => t.payable)).toEqual([false, true]);
    expect(diplomacyPanelRows(sim, { ...roster, canPay: false })[0]?.tributes.map((t) => t.payable)).toEqual([
      false,
      false,
    ]);
  });

  it('resolves tribute titles from map strings and omits missing or empty labels', () => {
    const owed: OpenTribute[] = [39, 40, 41].map((stringId, slot) => ({
      slot,
      stringId,
      receiver: 1,
      demands: [],
      payable: true,
    }));
    const sim = simView([[0, 1]], [], owed);
    const roster = { localPlayer: 0, rosterPlayers: [0, 1], observer: false };
    const rows = diplomacyPanelRows(sim, {
      ...roster,
      mapText: (id) => (id === 39 ? ' Castle reinforcements ' : id === 40 ? '  ' : undefined),
    });
    expect(rows[0]?.tributes).toEqual([
      { slot: 0, title: 'Castle reinforcements', demands: [], payable: true },
      { slot: 1, demands: [], payable: true },
      { slot: 2, demands: [], payable: true },
    ]);
    expect(diplomacyPanelRows(sim, roster)[0]?.tributes.every((row) => row.title === undefined)).toBe(true);
  });

  it('leaves the name off an unnamed slot and maps the colour through the roster colour slots', () => {
    const sim = simView([[0, 1]], []);
    const rows = diplomacyPanelRows(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1],
      observer: false,
      playerColourOf: () => 5,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('name');
    expect(rows[0]?.colour).toBe(PLAYER_SWATCH_COLORS[5]);
    expect(rows[0]?.towardYou).toBe('enemy'); // the sim default shows through untouched
  });

  it('skips the discovery gate for a spectator, who sees the whole map anyway', () => {
    const sim = simView([], []);
    expect(diplomacyPanelRows(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: false })).toEqual(
      [],
    );
    expect(
      diplomacyPanelRows(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: true }).map(
        (r) => r.player,
      ),
    ).toEqual([1, 2]);
  });
});

describe('diplomacyMetSeats', () => {
  it("lists the window's players and their stance without building the trade lines", () => {
    const sim: DiplomacySimView = {
      ...simView([[0, 2]], [[2, 0, 'friend']]),
      tradeOffersOf: () => {
        throw new Error('the per-tick read built the trade lines');
      },
    };
    expect(diplomacyMetSeats(sim, { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: false })).toEqual([
      { player: 2, towardYou: 'friend' },
    ]);
  });
});

describe('diplomacyMapNations', () => {
  it('puts the own nation first with no relation and keeps each direction of a met stance', () => {
    const sim = simView(
      [[0, 2]],
      [
        [2, 0, 'friend'],
        [0, 2, 'enemy'],
      ],
    );
    const nations = diplomacyMapNations(sim, {
      localPlayer: 0,
      rosterPlayers: [2, 0],
      observer: false,
      seatNameOf: (p) => (p === 2 ? 'Mieszkańcy Lasu' : undefined),
    });
    expect(nations).toEqual([
      { player: 0, colour: PLAYER_SWATCH_COLORS[0], own: true, hasPage: false },
      {
        player: 2,
        name: 'Mieszkańcy Lasu',
        colour: PLAYER_SWATCH_COLORS[2],
        own: false,
        hasPage: true,
        relation: { towardYou: 'friend', yourStance: 'enemy' },
      },
    ]);
  });

  it('leaves out an unmet nation and one the map hides', () => {
    const sim = simView(
      [
        [0, 1],
        [0, 2],
      ],
      [],
    );
    const nations = diplomacyMapNations(sim, {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2, 3],
      observer: false,
      relationFlags: [{ kind: 'hide', a: 2, b: 0 }],
    });
    expect(nations.map((nation) => nation.player)).toEqual([0, 1]);
  });

  it('names everyone without an own nation or a relation on a whole-map view', () => {
    const nations = diplomacyMapNations(simView([], []), {
      localPlayer: 0,
      rosterPlayers: [0, 1, 2],
      observer: true,
    });
    expect(nations.map((nation) => nation.player)).toEqual([0, 1, 2]);
    expect(nations.every((nation) => !nation.own && nation.relation === undefined)).toBe(true);
  });

  it("leaves out a whole-map view's reading seat when the map has no such nation", () => {
    const nations = diplomacyMapNations(simView([], []), {
      localPlayer: 9,
      rosterPlayers: [1, 2],
      observer: true,
    });
    expect(nations.map((nation) => nation.player)).toEqual([1, 2]);
  });
});

describe('harshestStance', () => {
  const roster = { localPlayer: 0, rosterPlayers: [0, 1, 2], observer: false };
  const both = (a: number, b: number, state: 'friend' | 'neutral' | 'enemy') =>
    [
      [a, b, state],
      [b, a, state],
    ] as [number, number, 'friend' | 'neutral' | 'enemy'][];

  it('reads enemy when either direction of any met pair is hostile', () => {
    const sim = simView(
      [
        [0, 1],
        [0, 2],
      ],
      [...both(0, 1, 'friend'), [0, 2, 'friend'], [2, 0, 'enemy']],
    );
    expect(harshestStance(sim, roster)).toBe('enemy');
  });

  it('reads friend only when every met player is friendly both ways', () => {
    const met: [number, number][] = [
      [0, 1],
      [0, 2],
    ];
    expect(harshestStance(simView(met, [...both(0, 1, 'friend'), ...both(0, 2, 'friend')]), roster)).toBe(
      'friend',
    );
    expect(harshestStance(simView(met, [...both(0, 1, 'friend'), ...both(0, 2, 'neutral')]), roster)).toBe(
      'neutral',
    );
  });

  it('reads neutral when nobody has been met, whatever the table says', () => {
    expect(harshestStance(simView([], both(0, 1, 'enemy')), roster)).toBe('neutral');
  });
});
