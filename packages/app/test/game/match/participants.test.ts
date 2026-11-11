import type { MapScript } from '@open-northland/data';
import type { MatchOutcome } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  hasEliminationGoal,
  matchParticipants,
  multiplayerMatchGoals,
  neverDiesSeats,
  playersDecidedBeforeEnd,
  scriptMatchParticipants,
} from '../../../src/game/match/participants.js';

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
    expect(
      matchParticipants({ controlled: [0], machineSeats: [2, 3, 0], neverDies: neverDiesSeats(s) }),
    ).toEqual([0, 3]);
  });

  it('a read-only observer controls no seat, so only the AI plays', () => {
    expect(matchParticipants({ controlled: [], machineSeats: [1, 2], neverDies: [] })).toEqual([1, 2]);
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

it('ends the match for its people once every seat a person holds is decided and a rival plays on', () => {
  const outcomes =
    (...list: MatchOutcome[]) =>
    (seat: number) =>
      list[seat] ?? 'undecided';
  // People in seats 0, 1 and 3, a computer in 2; seat 3 cannot die, so only a goal row decides it.
  const people = [0, 1, 3];
  const participants = [0, 1, 2];
  const decided = (list: MatchOutcome[], left: readonly number[] = []): boolean =>
    playersDecidedBeforeEnd(people, participants, outcomes(...list), (seat) => !left.includes(seat));
  expect(decided(['victory', 'defeat', 'undecided', 'defeat'])).toBe(true);
  expect(decided(['victory', 'defeat'])).toBe(false);
  expect(decided(['defeat', 'undecided', 'undecided', 'defeat'])).toBe(false);
  // A person who left waits for no verdict, yet someone must have one.
  expect(decided(['defeat', 'undecided', 'undecided', 'defeat'], [1])).toBe(true);
  expect(decided([], [0, 1, 3])).toBe(false);
  // Every participant decided: the match's own end reports it.
  expect(decided(['victory', 'defeat', 'defeat', 'defeat'])).toBe(false);
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
