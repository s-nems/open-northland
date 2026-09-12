import { describe, expect, it } from 'vitest';
import { MAP_SCENES, mapSceneParams } from '../src/scenes/map-scenes.js';
import { firedMissionRows } from '../src/view/runtime/mission-trace.js';
import { relaunchSearch } from '../src/view/runtime/save-load/relaunch.js';

describe('the real map acceptance entry', () => {
  it('runs the decoded map route with scripts and diagnostics, preserving player overrides', () => {
    const scene = MAP_SCENES[0];
    if (scene === undefined) throw new Error('missing map scene');
    const params = mapSceneParams(scene, new URLSearchParams('scene=mission-map&debug=perf&fog=off'));
    expect(params.get('map')).toBe('wielkie_sprzatanie');
    expect(params.has('scene')).toBe(false);
    expect(params.get('missions')).toBeNull();
    expect(params.get('fog')).toBe('off');
    expect(params.get('debug')).toBe('perf,missions');
    const entry = `?${params.toString()}`;
    expect(relaunchSearch({ mapId: scene.mapId, entry })).toBe(entry);
    expect(mapSceneParams(scene, new URLSearchParams('missions=off')).get('missions')).toBe('off');
  });

  it('shows execution ticks even when a later check cleared the done flag', () => {
    const base = {
      description: undefined,
      visible: false,
      active: false,
      done: false,
      firstFiredTick: undefined,
      lastFiredTick: undefined,
      fireCount: 0,
    };
    expect(
      firedMissionRows([
        { ...base, index: 0, done: true },
        { ...base, index: 1, firstFiredTick: 36, lastFiredTick: 72, fireCount: 2 },
        { ...base, index: 2, firstFiredTick: 36, lastFiredTick: 36, fireCount: 1 },
      ]).map((row) => row.index),
    ).toEqual([1, 2]);
  });
});
