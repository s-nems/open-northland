import { fx, type systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import type { SeatMind } from '../../../src/view/admin-debug/ai-mind.js';
import { type AiSeatReading, aiSeatRows, readAiSeats } from '../../../src/view/admin-debug/ai-seats.js';
import { NO_WORK } from '../../../src/view/admin-debug/ai-work.js';

const msgs = messages();
const copy = msgs.admin.ai;

function sums(free: number, wood: number): systems.ZoneSums {
  return {
    zones: 8,
    land: 7000,
    water: 0,
    free,
    clearable: 300,
    blocked: 40,
    plantable: 900,
    fish: 12,
    deposits: new Map([
      ['wood', wood],
      ['stone', 5],
      ['iron', 0],
    ]),
  };
}

const BRIEF: systems.SeatBrief = {
  player: 2,
  anchor: { hx: 40, hy: 40 },
  zone: 0,
  component: 1,
  home: sums(1200, 80),
  near: sums(4100, 250),
  continent: sums(9000, 600),
  access: new Map<string, systems.GoodAccess>([
    ['iron', { access: 'overSea', zones: 3 }],
    ['fish', { access: 'none', zones: null }],
  ]),
  others: [
    { player: 3, anchor: { hx: 90, hy: 40 }, direction: 'e', distance: fx.fromInt(25), sameLand: true },
    { player: 4, anchor: { hx: 40, hy: 140 }, direction: 's', distance: fx.fromInt(50), sameLand: false },
  ],
};

const NO_MIND: SeatMind = { tick: 0, intel: null, staleZones: [], intent: null, pupils: [] };

const DECIDED: AiSeatReading = {
  player: 2,
  difficulty: 'hard',
  strategy: {
    economy: {
      archetype: 'cramped',
      sides: ['naturalArms', 'fishing'],
      evidence: ['homeRoomSmall', 'ironOutOfReach'],
      decidedAt: 120,
      challenger: { archetype: 'rich', reviews: 2 },
    },
    military: {
      plan: 'balanced',
      posture: 'prepare',
      evidence: ['forecastThreat'],
      ownPoints: 120,
      targetOwner: 3,
      targetPoints: 300,
      strongestPoints: 300,
      threatInTicks: 600,
      decidedAt: 120,
      challenger: null,
    },
  },
  brief: BRIEF,
  mind: NO_MIND,
  work: NO_WORK,
};

describe('AI view rows', () => {
  it('lays out a decided seat: raw codes, the home and near bands, access and the other starts', () => {
    const [seat] = aiSeatRows([DECIDED], msgs);
    expect(seat?.title).toBe(
      formatMessage(copy.seat, { player: 2, difficulty: msgs.mainMenu.lobby.difficulty.hard }),
    );
    expect(seat?.note).toBeNull();
    const [strategy, military, forces, bands, access, others] = seat?.tables ?? [];
    expect(strategy?.rows).toContainEqual([copy.sides, 'naturalArms, fishing']);
    expect(strategy?.rows).toContainEqual([copy.evidence, 'homeRoomSmall, ironOutOfReach']);
    expect(strategy?.rows.find((row) => row[0] === copy.challenger)?.[1]).toContain('rich');
    expect(military?.rows).toContainEqual([copy.posture, 'prepare']);
    expect(forces?.rows).toEqual([[copy.own, '120', '-', '-', '-', '-']]);
    expect(bands?.head).toEqual([copy.band, copy.home, copy.near]);
    expect(bands?.rows).toContainEqual([copy.free, '1200', '4100']);
    expect(bands?.rows).toContainEqual([msgs.goods.wood, '80', '250']);
    // A good the brief does not track shows as a dash rather than a zero it never counted.
    expect(bands?.rows).toContainEqual([msgs.goods.mud, '-', '-']);
    expect(access?.rows).toEqual([
      [msgs.goods.iron, copy.accessClasses.overSea, '3'],
      [msgs.goods.fish, copy.accessClasses.none, '-'],
    ]);
    expect(others?.rows).toEqual([
      [formatMessage(copy.player, { player: 3 }), copy.directions.e, '25', copy.sameLand],
      [formatMessage(copy.player, { player: 4 }), copy.directions.s, '50', copy.overSea],
    ]);
  });

  it('names a seat the scan has not reached and one not decided yet', () => {
    const [seat] = aiSeatRows(
      [{ player: 5, difficulty: 'easy', strategy: null, brief: null, mind: NO_MIND, work: NO_WORK }],
      msgs,
    );
    expect(seat?.note).toBe(copy.noScan);
    expect(seat?.tables.slice(0, 2)).toEqual([
      { head: null, rows: [[copy.archetype, copy.undecided]] },
      { head: null, rows: [[copy.plan, copy.undecided]] },
    ]);
  });
});

describe('reading the running computer seats', () => {
  it('takes each seat from its lowest-id carrier and skips a seat whose controller is off', () => {
    const control = (player: number, computerEnabled: boolean) => ({
      AiControl: { player, computerEnabled, difficulty: 'medium', mapAiEnabled: true, modules: {} },
    });
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        { id: 1, components: control(3, true) },
        { id: 2, components: control(1, false) },
        // A later carrier of seat 3 does not override the first.
        { id: 3, components: control(3, false) },
        { id: 4, components: { Settler: {} } },
      ],
    };
    expect(readAiSeats(snapshot, null)).toEqual([
      { player: 3, difficulty: 'medium', strategy: null, brief: null, mind: NO_MIND, work: NO_WORK },
    ]);
  });
});
