import type { MapAiSeat, MapAiTask } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  MissionTiming,
  type SeatTerritory,
  scriptedThreats,
  TERRITORY_MARGIN_NODES,
  threatsToward,
} from '../../../../../src/systems/computer-player/knowledge/map-intent/index.js';
import {
  type MissionDefinition,
  type MissionScript,
  SUCCESSFUL_IF,
} from '../../../../../src/systems/missions/index.js';
import { testContent } from '../../../../fixtures/content.js';

const SEAT = 0;
const RAIDER = 6;
const HOME: SeatTerritory = { anchor: { hx: 40, hy: 40 }, buildings: [] };
const FAR = { hx: 300, hy: 300 };
/** Fixture jobs: a soldier and a woodcutter. */
const SOLDIER = 31;
const WOODCUTTER = 1;
const ALWAYS_SLOT = 100000;

const content = testContent();

function attack(over: Partial<Extract<MapAiTask, { kind: 'attack' }>> = {}): MapAiTask {
  return {
    kind: 'attack',
    priority: 100,
    condition: ALWAYS_SLOT,
    x: HOME.anchor.hx,
    y: HOME.anchor.hy,
    range: 50,
    min: 1,
    max: 11,
    rallyX: HOME.anchor.hx,
    rallyY: HOME.anchor.hy,
    stance: 1,
    ...over,
  };
}

function program(player: number, tasks: readonly MapAiTask[], over: Partial<MapAiSeat> = {}): MapAiSeat {
  return {
    player,
    allDisabled: false,
    computerDisabled: true,
    disabledComputerModules: [],
    conditions: [],
    tasks: [...tasks],
    ...over,
  };
}

function mission(over: Partial<MissionDefinition>): MissionDefinition {
  return { successfullIf: SUCCESSFUL_IF.all, active: true, visible: false, goals: [], results: [], ...over };
}

function towardSeat(mapAi: readonly MapAiSeat[], missions: readonly MissionDefinition[] = []) {
  const script: MissionScript = { missions };
  return threatsToward(scriptedThreats(content, script, new MissionTiming(script), mapAi), SEAT, HOME);
}

describe('scripted threats toward a seat', () => {
  it('keeps another seat`s attack on the seat`s home and drops a far one and the seat`s own', () => {
    const found = towardSeat([
      program(RAIDER, [attack(), attack({ x: FAR.hx, y: FAR.hy })]),
      program(SEAT, [attack()]),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      source: 'mapAiAttack',
      player: RAIDER,
      task: 0,
      trigger: { kind: 'always' },
      distance: 0,
    });
  });

  it('reaches past the attack`s target by half its range and the territory margin', () => {
    const range = 50;
    const edge = { hx: HOME.anchor.hx, hy: HOME.anchor.hy + range / 2 + TERRITORY_MARGIN_NODES };
    expect(towardSeat([program(RAIDER, [attack({ y: edge.hy, range })])])).toHaveLength(1);
    expect(towardSeat([program(RAIDER, [attack({ y: edge.hy + 1, range })])])).toHaveLength(0);
  });

  it('ignores a program the map disables', () => {
    expect(towardSeat([program(RAIDER, [attack()], { allDisabled: true })])).toEqual([]);
  });

  it('attaches the fighters an attacking program creates as its waves', () => {
    const creatures: MapAiTask = {
      kind: 'createCreatures',
      priority: 100,
      condition: ALWAYS_SLOT,
      tribe: 1,
      job: SOLDIER,
      x: FAR.hx,
      y: FAR.hy,
      missionId: 0,
      count: 4,
      once: false,
    };
    const [threat] = towardSeat([program(RAIDER, [attack(), creatures, { ...creatures, job: WOODCUTTER }])]);
    expect(threat?.waves).toEqual([
      { task: 1, job: SOLDIER, count: 4, point: FAR, trigger: { kind: 'always' } },
    ]);
  });

  it('follows a mission`s spawned fighters to where it sends them', () => {
    const found = towardSeat(
      [],
      [
        mission({
          goals: [{ opcode: 'TimeGone', seconds: 10 }],
          results: [
            {
              opcode: 'SetHumanX',
              player: RAIDER,
              tribe: 1,
              job: SOLDIER,
              point: FAR,
              humanId: 100,
              behaviour: 0,
              amount: 6,
            },
            {
              opcode: 'SetHuman',
              player: RAIDER,
              tribe: 1,
              job: WOODCUTTER,
              point: FAR,
              humanId: 100,
              behaviour: 0,
            },
            { opcode: 'SendHuman', humanId: 100, point: HOME.anchor },
          ],
        }),
      ],
    );
    expect(found).toEqual([
      expect.objectContaining({
        source: 'missionSend',
        player: RAIDER,
        units: [{ job: SOLDIER, count: 6 }],
        from: [FAR],
        trigger: { kind: 'atTick', tick: 120, repeats: false },
        mission: 0,
      }),
    ]);
  });

  it('reads MoveUnitsInArea as a teleport to its destination', () => {
    const found = towardSeat(
      [],
      [
        mission({
          results: [
            {
              opcode: 'MoveUnitsInArea',
              player: RAIDER,
              point: FAR,
              range: 10,
              index: HOME.anchor.hx,
              extra: HOME.anchor.hy,
            },
          ],
        }),
      ],
    );
    expect(found).toEqual([
      expect.objectContaining({ source: 'missionMove', player: RAIDER, target: HOME.anchor }),
    ]);
  });
});
