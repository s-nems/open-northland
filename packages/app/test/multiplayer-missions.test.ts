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
  it('keeps elimination for multiplayer setup scripts and scripted victory for story maps', () => {
    expect(mapScriptWorld(script('None'), {}).victory).toBe('elimination');
    expect(mapScriptWorld(script('None', false), {}).victory).toBe('script');
    expect(mapScriptWorld(script('MissionWon'), {}).victory).toBe('script');
  });
});
