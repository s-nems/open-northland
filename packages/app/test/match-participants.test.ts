import type { MapScript } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  hasEliminationGoal,
  matchParticipants,
  multiplayerMatchGoals,
  neverDiesSeats,
  scriptMatchParticipants,
} from '../src/game/match-participants.js';

const line = (...values: string[]): { key: string; values: string[] } => ({ key: 'x', values });

function script(over: Partial<MapScript> = {}): MapScript {
  return {
    players: [],
    diplomacy: [],
    relationFlags: [],
    ai: [],
    specialItems: [],
    misc: [],
    humanNames: [],
    humanPalettes: [],
    tradeAgreements: [],
    weather: [],
    missions: [],
    ...over,
  };
}

describe('neverDiesSeats and matchParticipants', () => {
  it('reads the playerneverdies rows and drops those seats from the match', () => {
    const s = script({
      misc: [
        line('nametribe', '0', '50'),
        { key: 'playerneverdies', values: ['7'] },
        { key: 'playerneverdies', values: ['2'] },
      ],
    });
    expect(neverDiesSeats(s)).toEqual([2, 7]);
    expect(matchParticipants({ controlled: [0], aiSeats: [2, 3, 0], neverDies: neverDiesSeats(s) })).toEqual([
      0, 3,
    ]);
  });

  it('a read-only observer controls no seat, so only the AI plays', () => {
    expect(matchParticipants({ controlled: [], aiSeats: [1, 2], neverDies: [] })).toEqual([1, 2]);
  });
});

it('takes passive authored seats into account and exempts never-dying seats', () => {
  expect(
    scriptMatchParticipants(
      script({
        players: [0, 1, 2].map((player) => ({ player, type: 'ai', tribeId: 1, colorId: 0 })),
        misc: [{ key: 'playerneverdies', values: ['1'] }],
      }),
    ),
  ).toEqual([0, 2]);
});
it('never promises an elimination goal for scripted or spectator seats', () => {
  expect(hasEliminationGoal({ participants: [0, 2], victory: 'script', lastStanding: false }, 0)).toBe(false);
  expect(hasEliminationGoal({ participants: [0, 2], victory: 'elimination', lastStanding: true }, 1)).toBe(
    false,
  );
  expect(hasEliminationGoal({ participants: [0, 2], victory: 'elimination', lastStanding: true }, 0)).toBe(
    true,
  );
  expect(hasEliminationGoal({ participants: [0, 2], victory: 'goals', lastStanding: true }, 0)).toBe(true);
  expect(hasEliminationGoal({ participants: [0, 2], victory: 'goals', lastStanding: false }, 0)).toBe(false);
});

describe('multiplayerMatchGoals', () => {
  it('keeps the authored rows and reads a verdict the table leaves unread', () => {
    expect(multiplayerMatchGoals([{ kind: 'wonByMission' }], { won: true, failed: false })).toEqual([
      { kind: 'wonByMission' },
    ]);
    expect(multiplayerMatchGoals([], { won: true, failed: true })).toEqual([
      { kind: 'wonByMission' },
      { kind: 'lostByMission' },
    ]);
  });

  it('lets the last seats standing win only where nothing else can decide', () => {
    expect(multiplayerMatchGoals([{ kind: 'wonByMission' }], { won: false, failed: false })).toEqual([
      { kind: 'wonByMission' },
      { kind: 'lastStanding' },
    ]);
    const counted = [{ kind: 'inhabitants', count: 50, soldiers: false }] as const;
    expect(multiplayerMatchGoals(counted, { won: false, failed: false })).toEqual(counted);
    expect(multiplayerMatchGoals([], { won: false, failed: true })).toEqual([{ kind: 'lostByMission' }]);
  });
});
