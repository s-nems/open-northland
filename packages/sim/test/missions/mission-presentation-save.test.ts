import { describe, expect, it } from 'vitest';
import { MissionPresentation, retainMissionPresentation } from '../../src/components/mission-presentation.js';
import { Simulation } from '../../src/index.js';
import { testContent } from '../fixtures/content.js';
import { firingSim, LOAD_PASS, roundTrip } from './support.js';

const POINT = { hx: 12, hy: 14 };

describe('persistent mission presentation', () => {
  it('keeps unused worlds and read probes free of presentation state', () => {
    const sim = new Simulation({ seed: 1, content: testContent() });
    const before = sim.hashState();
    expect(sim.missionPresentation()).toEqual({ guiMarkers: [], groundMarkers: [], weather: [] });
    expect(sim.world.lowestEntityWith(MissionPresentation)).toBeNull();
    expect(sim.hashState()).toBe(before);
  });

  it('saves executor-created overlays without replaying one-shot events on restore', () => {
    const sim = firingSim([
      { opcode: 'SetGuiMarker', objectId: 3, point: POINT },
      { opcode: 'SetImportLandscapeMarker', point: POINT, flag: true },
      { opcode: 'SetMapAreaMarkerMagic', point: POINT, range: 2, index: 1, flag: true },
      { opcode: 'SetWeather', point: POINT, range: 5, amount: 25, flag: false },
    ]);
    sim.run(LOAD_PASS);
    const before = sim.missionPresentation();
    expect(before.guiMarkers).toEqual([{ marker: 3, point: POINT }]);
    expect(before.groundMarkers).toHaveLength(13);
    expect(before.weather).toEqual([
      { weather: 'rain', min: { hx: 7, hy: 9 }, max: { hx: 17, hy: 19 }, density: 2500 },
    ]);
    const restored = roundTrip(sim);
    expect(restored.missionPresentation()).toEqual(before);
    expect(restored.events.current()).toEqual([]);
    sim.step();
    restored.step();
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('keeps snapshots and event payloads detached from saved state', () => {
    const sim = firingSim([]);
    const point = { ...POINT };
    retainMissionPresentation(sim.world, { kind: 'missionGuiMarker', marker: 0, point, placed: true });
    retainMissionPresentation(sim.world, { kind: 'missionImportMarker', point, placed: true });
    retainMissionPresentation(sim.world, {
      kind: 'missionWeather',
      weather: 'snow',
      min: point,
      max: point,
      density: 4,
    });
    point.hx = 0;
    const view = sim.missionPresentation();
    const hash = sim.hashState();
    for (const marker of view.guiMarkers) Object.assign(marker.point, { hx: -1 });
    for (const marker of view.groundMarkers) Object.assign(marker.point, { hy: -1 });
    for (const region of view.weather) {
      Object.assign(region.min, { hx: -1 });
      Object.assign(region.max, { hy: -1 });
    }
    expect(sim.hashState()).toBe(hash);
    expect(sim.missionPresentation().guiMarkers[0]?.point).toEqual(POINT);
    expect(roundTrip(sim).missionPresentation()).toEqual(sim.missionPresentation());
  });

  it('restores marker replacement and removal without resurrecting older styles or slots', () => {
    const sim = firingSim([]);
    retainMissionPresentation(sim.world, { kind: 'missionGuiMarker', marker: 0, point: POINT, placed: true });
    retainMissionPresentation(sim.world, {
      kind: 'missionGuiMarker',
      marker: 0,
      point: { hx: 0, hy: 0 },
      placed: false,
    });
    retainMissionPresentation(sim.world, {
      kind: 'missionAreaMarkers',
      magic: false,
      points: [POINT],
      placed: true,
    });
    retainMissionPresentation(sim.world, { kind: 'missionImportMarker', point: POINT, placed: true });
    expect(sim.missionPresentation().groundMarkers).toEqual([{ style: 'import', point: POINT }]);
    retainMissionPresentation(sim.world, {
      kind: 'missionAreaMarkers',
      magic: true,
      points: [POINT],
      placed: false,
    });
    expect(roundTrip(sim).missionPresentation()).toEqual({ guiMarkers: [], groundMarkers: [], weather: [] });
  });

  it('preserves overlapping weather write order, repeated extents and zero-density clears', () => {
    const sim = firingSim([]);
    const broad = {
      kind: 'missionWeather',
      weather: 'rain',
      min: { hx: 0, hy: 0 },
      max: { hx: 20, hy: 20 },
      density: 1000,
    } as const;
    const narrow = { ...broad, min: { ...POINT }, max: { ...POINT }, density: 0 };
    retainMissionPresentation(sim.world, broad);
    retainMissionPresentation(sim.world, narrow);
    retainMissionPresentation(sim.world, { ...broad, density: 2000 });
    expect(sim.missionPresentation().weather.map((region) => region.density)).toEqual([0, 2000]);
    retainMissionPresentation(sim.world, narrow);
    expect(sim.missionPresentation().weather.map((region) => region.density)).toEqual([2000, 0]);
    expect(sim.missionPresentation().weather).toHaveLength(2);
    expect(roundTrip(sim).missionPresentation()).toEqual(sim.missionPresentation());
  });
});
