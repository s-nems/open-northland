import type { MapAiCondition, MapAiSeat } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../../../../../src/core/loop.js';
import {
  MissionTiming,
  slotTrigger,
} from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  type MissionDefinition,
  type MissionScript,
  SUCCESSFUL_IF,
} from '../../../../../src/systems/missions/index.js';

const POINT = { hx: 40, hy: 40 };
const RANGE = 10;

function mission(over: Partial<MissionDefinition>): MissionDefinition {
  return { successfullIf: SUCCESSFUL_IF.all, active: false, visible: false, goals: [], results: [], ...over };
}

function timing(missions: readonly MissionDefinition[]): MissionTiming {
  return new MissionTiming({ missions } satisfies MissionScript);
}

function seat(conditions: readonly MapAiCondition[]): MapAiSeat {
  return {
    player: 6,
    allDisabled: false,
    computerDisabled: true,
    disabledComputerModules: [],
    conditions: [...conditions],
    tasks: [],
  };
}

describe('mission fire timing', () => {
  it('adds a chained timer to its activator, an exact tick', () => {
    const t = timing([
      mission({
        active: true,
        goals: [{ opcode: 'TimeGone', seconds: 60 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 1 }],
      }),
      mission({ goals: [{ opcode: 'TimeGone', seconds: 30 }] }),
    ]);
    expect(t.fireOf(1)).toEqual({ kind: 'atTick', tick: 90 * TICKS_PER_SECOND, repeats: false });
  });

  it('reads a random timer as the bounded window it draws from', () => {
    const t = timing([mission({ active: true, goals: [{ opcode: 'RandomTimeGone', seconds: 20 }] })]);
    expect(t.fireOf(0)).toEqual({
      kind: 'window',
      fromTick: 10 * TICKS_PER_SECOND,
      toTick: 19 * TICKS_PER_SECOND,
      repeats: false,
    });
  });

  it('marks a mission that re-activates itself through its chain as repeating', () => {
    const t = timing([
      mission({
        active: true,
        goals: [{ opcode: 'TimeGone', seconds: 10 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 1 }],
      }),
      mission({
        goals: [{ opcode: 'TimeGone', seconds: 5 }],
        results: [{ opcode: 'ActivateMission', missionIndex: 1 }],
      }),
    ]);
    expect(t.fireOf(1)).toEqual({ kind: 'atTick', tick: 15 * TICKS_PER_SECOND, repeats: true });
  });

  it('waits on a world-state goal as a condition', () => {
    const t = timing([
      mission({
        active: true,
        goals: [{ opcode: 'FindPosByPlayersMapMoveable', player: 2, point: POINT, range: RANGE }],
      }),
    ]);
    expect(t.fireOf(0)).toEqual({
      kind: 'conditional',
      match: 'all',
      conditions: [
        { kind: 'unitsInRange', player: 2, point: POINT, range: RANGE, soldiersOnly: false, minUnits: 1 },
      ],
    });
  });

  it('never fires a mission nothing activates', () => {
    expect(timing([mission({ goals: [{ opcode: 'True' }] })]).fireOf(0)).toEqual({ kind: 'never' });
  });
});

describe('map-AI slot triggers', () => {
  it('reads True as always and OnTime as an exact tick', () => {
    const program = seat([
      { kind: 'true', slot: 0 },
      { kind: 'onTime', slot: 1, ticks: 7200 },
    ]);
    expect(slotTrigger(program, 0, null)).toEqual({ kind: 'always' });
    expect(slotTrigger(program, 1, null)).toEqual({ kind: 'atTick', tick: 7200, repeats: false });
  });

  it('combines OnConditions slots and negates the first under mode 3', () => {
    const creature: MapAiCondition = {
      kind: 'onCreatureInRange',
      slot: 0,
      sticky: false,
      x: POINT.hx,
      y: POINT.hy,
      range: RANGE,
      player: 20,
      enemiesOnly: true,
      soldiersOnly: true,
    };
    const program = seat([
      creature,
      { kind: 'onConditions', slot: 1, sticky: false, mode: 3, slots: [0] },
      { kind: 'onNumberOfSoldiers', slot: 2, sticky: false, count: 10, player: 0 },
      { kind: 'onConditions', slot: 3, sticky: false, mode: 1, slots: [1, 2] },
    ]);
    const near = {
      kind: 'unitsInRange',
      player: 20,
      point: POINT,
      range: RANGE,
      soldiersOnly: true,
      minUnits: 1,
    };
    expect(slotTrigger(program, 3, null)).toEqual({
      kind: 'conditional',
      match: 'all',
      conditions: [
        {
          kind: 'nested',
          trigger: {
            kind: 'conditional',
            match: 'notAny',
            conditions: [
              { kind: 'nested', trigger: { kind: 'conditional', match: 'all', conditions: [near] } },
            ],
          },
        },
        { kind: 'soldierCount', player: 0, count: 10 },
      ],
    });
  });

  it('resolves an external slot to the missions that raise it', () => {
    const t = timing([
      mission({
        active: true,
        goals: [{ opcode: 'TimeGone', seconds: 60 }],
        results: [{ opcode: 'SetExternalFlag', player: 6, flagId: 2, flag: true }],
      }),
    ]);
    expect(slotTrigger(seat([{ kind: 'onExternal', slot: 2, raised: false }]), 2, t)).toEqual({
      kind: 'conditional',
      match: 'all',
      conditions: [
        {
          kind: 'externalFlag',
          player: 6,
          slot: 2,
          raisedBy: { kind: 'atTick', tick: 60 * TICKS_PER_SECOND, repeats: false },
        },
      ],
    });
  });
});
