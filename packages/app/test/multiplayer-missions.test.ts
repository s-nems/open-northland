import { MapScript } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { assertMultiplayerMap } from '../src/game/multiplayer-map.js';
import { mapScriptWorld } from '../src/game/world/mission-script.js';

function script(opcode: string, multiplayer = true) {
  return MapScript.parse({
    ...(multiplayer ? { multiplayer: {} } : {}),
    missions: [{ results: [{ key: 'result', values: [opcode, '0', '0'] }] }],
  });
}

describe('multiplayer mission policy', () => {
  it('requires an authored multiplayer table even if a story map has several seats', () => {
    expect(() => assertMultiplayerMap(script('None', false))).toThrow('single-player');
    expect(() => assertMultiplayerMap(script('None'))).not.toThrow();
  });
  it.each(['StartSubMission', ' endsubmission '])('rejects network world transitions: %s', (opcode) => {
    expect(() => assertMultiplayerMap(script(opcode))).toThrow('transitions');
  });
  it('plays a multiplayer map by its goal table and a story map by its script', () => {
    expect(mapScriptWorld(script('None'), {})).toMatchObject({
      victory: 'goals',
      goals: [{ kind: 'lastStanding' }],
    });
    expect(mapScriptWorld(script('None', false), {}).victory).toBe('script');
    expect(mapScriptWorld(script('MissionWon'), {})).toMatchObject({
      victory: 'goals',
      goals: [{ kind: 'wonByMission' }],
    });
    const tabled = MapScript.parse({ multiplayer: {}, multiplayerGoals: [{ kind: 'wonByMission' }] });
    expect(mapScriptWorld(tabled, null)).toMatchObject({
      victory: 'goals',
      goals: [{ kind: 'wonByMission' }, { kind: 'lastStanding' }],
    });
    expect(mapScriptWorld(MapScript.parse({ multiplayerGoals: [] }), null).victory).toBeUndefined();
  });
});
