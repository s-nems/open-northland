import {
  type components,
  type Entity,
  type systems,
  TICKS_PER_SECOND,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { formatMessage, messages } from '../../../src/i18n/index.js';
import {
  intelTables,
  intentTables,
  militaryTable,
  pupilsBySeat,
  readSeatMind,
  type SeatMind,
  triggerMinutes,
} from '../../../src/view/admin-debug/ai-mind.js';

const msgs = messages();
const copy = msgs.admin.ai;
const MINUTE = 60 * TICKS_PER_SECOND;
const NOW = 10 * MINUTE;

const MILITARY: components.MilitaryStrategyState = {
  plan: 'harasser',
  posture: 'harass',
  evidence: ['harasserPlan', 'raidTargetKnown'],
  ownPoints: 90,
  targetOwner: 3,
  targetPoints: 60,
  strongestPoints: 200,
  threatInTicks: 3 * MINUTE,
  decidedAt: 400,
  challenger: { posture: 'defend', reviews: 1 },
};

// Two zones across, 32 nodes each: seat 2 starts in zone 0, seat 3 in zone 1, seat 4 in zone 3.
const BRIEF = {
  zoneNodes: 32,
  zonesWide: 2,
  zonesHigh: 2,
  seats: [
    { player: 2, hx: 5, hy: 5, component: 1, buildings: [] },
    { player: 3, hx: 40, hy: 5, component: 1, buildings: [] },
    { player: 4, hx: 40, hy: 40, component: 1, buildings: [] },
  ],
} as unknown as components.MapBriefView;

const INTEL: components.ComputerIntelState = {
  buildings: [
    {
      entity: 50 as Entity,
      owner: 3,
      buildingType: 1,
      hx: 40,
      hy: 5,
      seenAt: 100,
      posted: 2,
      postedPoints: 20,
    },
    {
      entity: 51 as Entity,
      owner: 3,
      buildingType: 2,
      hx: 42,
      hy: 5,
      seenAt: -1,
      posted: 0,
      postedPoints: 0,
    },
  ],
  forces: [
    {
      player: 3,
      peak: 4,
      peakAt: NOW,
      peakPoints: 40,
      peakPointsAt: NOW,
      lastSeenAt: NOW - 3 * MINUTE,
      lastZone: 1,
    },
  ],
  zoneSeenAt: [NOW, NOW - 2 * MINUTE, NOW, -1],
  scout: null,
  scoutLostAt: [-1, -1, -1, -1],
  scoutTurnedBackAt: [-1, -1, -1, -1],
};

describe('AI mind rows', () => {
  it('shows the posture with its orders: a harasser raids, a defender holds its waves', () => {
    const harass = militaryTable(MILITARY, false, msgs).rows;
    expect(harass).toContainEqual([copy.evidence, 'harasserPlan, raidTargetKnown']);
    expect(harass).toContainEqual([copy.raids, copy.yes]);
    expect(harass).toContainEqual([copy.threatIn, '3.0']);
    expect(harass).toContainEqual([
      copy.target,
      formatMessage(copy.targetValue, { player: 3, points: '60' }),
    ]);
    expect(harass.find((row) => row[0] === copy.launchRatio)?.[1]).toMatch(/^\d+\/\d+$/);
    expect(harass.find((row) => row[0] === copy.towerRadius)?.[1]).toMatch(/^\d+%$/);

    const defend = militaryTable({ ...MILITARY, posture: 'defend', challenger: null }, false, msgs).rows;
    expect(defend).toContainEqual([copy.launchRatio, '-']);
    expect(defend).toContainEqual([copy.raids, copy.no]);
    expect(defend.some((row) => row[0] === copy.challenger)).toBe(false);

    const building = { ...MILITARY, plan: 'balanced' as const, posture: 'attack' as const };
    expect(militaryTable(building, false, msgs).rows).toContainEqual([copy.raids, copy.no]);
    expect(militaryTable(building, true, msgs).rows, 'a flank seat raids').toContainEqual([
      copy.raids,
      copy.yes,
    ]);
  });

  it('weighs own points against each remembered seat and lists the stalest start zones', () => {
    const mind = readSeatMind(
      NOW,
      { id: 1, components: { ComputerIntel: INTEL } },
      2,
      BRIEF,
      null,
      undefined,
    );
    // Seat 4's zone was never seen, so it leads; seat 3's is two minutes stale.
    expect(mind.staleZones).toEqual([
      { player: 4, zone: 3, staleTicks: null },
      { player: 3, zone: 1, staleTicks: 2 * MINUTE },
    ]);
    const [forces, zones] = intelTables(mind, 90, msgs);
    expect(forces?.rows).toEqual([
      [copy.own, '90', '-', '-', '-', '-'],
      [
        formatMessage(copy.player, { player: 3 }),
        '40',
        '4',
        formatMessage(copy.buildingsValue, { buildings: 2, unseen: 1 }),
        '1',
        '3.0',
      ],
    ]);
    expect(zones?.rows).toEqual([
      [copy.zonesSeen, '-', '3/4'],
      [formatMessage(copy.player, { player: 4 }), '3', copy.never],
      [formatMessage(copy.player, { player: 3 }), '1', '2.0'],
    ]);
  });

  it('counts each seat its pupils by the trade they learn', () => {
    const snapshot: WorldSnapshot = {
      tick: 0,
      events: [],
      entities: [
        {
          id: 1,
          components: { Owner: { player: 2 }, TrainingOrder: { lesson: { kind: 'job', typeId: 7 } } },
        },
        {
          id: 2,
          components: { Owner: { player: 2 }, TrainingOrder: { lesson: { kind: 'job', typeId: 7 } } },
        },
        // A good lesson is not a trade, and a man of another seat counts for that seat.
        {
          id: 3,
          components: { Owner: { player: 2 }, TrainingOrder: { lesson: { kind: 'good', typeId: 7 } } },
        },
        {
          id: 4,
          components: { Owner: { player: 3 }, TrainingOrder: { lesson: { kind: 'job', typeId: 9 } } },
        },
      ],
    };
    const bySeat = pupilsBySeat(snapshot);
    expect([...(bySeat.get(2) ?? [])]).toEqual([[7, 2]]);
    expect([...(bySeat.get(3) ?? [])]).toEqual([[9, 1]]);
  });

  it('gives a forecast attack its minutes to go: 0 inside a window, a dash once past or untimed', () => {
    expect(triggerMinutes({ kind: 'atTick', tick: NOW + 90 * TICKS_PER_SECOND, repeats: false }, NOW)).toBe(
      '1.5',
    );
    expect(triggerMinutes({ kind: 'atTick', tick: NOW - 1, repeats: false }, NOW)).toBe('-');
    expect(triggerMinutes({ kind: 'window', fromTick: NOW - 1, toTick: NOW + 1, repeats: false }, NOW)).toBe(
      '0.0',
    );
    expect(triggerMinutes({ kind: 'conditional', match: 'all', conditions: [] }, NOW)).toBe('-');
  });

  it('lists the objectives and the attacks forecast to reach the seat', () => {
    const threat: systems.SeatThreat = {
      source: 'mapAiAttack',
      player: 1,
      target: { hx: 5, hy: 5 },
      range: 10,
      units: [],
      soldiers: { min: 4, max: 8 },
      rally: null,
      from: [],
      trigger: { kind: 'atTick', tick: NOW + 2 * MINUTE, repeats: false },
      mission: null,
      task: 3,
      waves: [],
      distance: 4,
    };
    const mind: SeatMind = {
      tick: NOW,
      intel: null,
      staleZones: [],
      pupils: [],
      intent: {
        seat: 2,
        objectives: [
          { verdict: 'win', role: 'decides', mission: 4, objective: { kind: 'defeatPlayers', players: [1] } },
          {
            verdict: 'win',
            role: 'supply',
            mission: 5,
            objective: {
              kind: 'holdArea',
              player: 2,
              area: { point: { hx: 179, hy: 179 }, range: 13 },
              minUnits: 1,
              reward: { everyTicks: 5 * MINUTE, checks: 10, feeds: 4 },
            },
          },
        ],
        threats: [threat],
        program: [],
      },
    };
    const [objectives, threats] = intentTables(mind, msgs);
    expect(objectives?.rows).toEqual([
      ['defeatPlayers', 'win', 'decides', '4'],
      ['holdArea 179,179 r13 /5.0 x10', 'win', 'supply', '5'],
    ]);
    expect(threats?.rows).toEqual([
      ['mapAiAttack', formatMessage(copy.player, { player: 1 }), 'atTick', '2.0'],
    ]);
  });
});
