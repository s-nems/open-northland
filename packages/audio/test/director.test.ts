import type { GfxPattern, SoundBank, TerrainPattern } from '@vinland/data';
import type { Camera } from '@vinland/render/data';
import { ONE } from '@vinland/render/data';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import {
  type AudioTerrain,
  JINGLE_GAIN,
  buildSoundIndex,
  defaultBindings,
  directAudio,
} from '../src/index.js';

/**
 * The pure director: sim events + snapshot + camera → the sounds that should be audible. Jingles fire
 * non-spatially; action SFX are viewport-culled + positioned; unbound events are ignored; on-screen
 * terrain drives ambient loops. All headless — no AudioContext.
 */
const bank: SoundBank = {
  staticGroups: [
    { name: 'Hammer Wood', sfx: [{ file: 'static/hammer01.wav', params: [80] }] },
    { name: 'Woodcutter Axe', sfx: [{ file: 'static/axe01.wav', params: [80] }] },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow1.wav', params: [0, 0, 0] }],
    },
  ],
  jingles: [
    { name: '', musicType: 26, sfx: [{ file: 'jingles/jingles_housebuilt.wav', params: [] }] },
    { name: '', musicType: 23, sfx: [{ file: 'jingles/jingles_birth.wav', params: [] }] },
  ],
};
const gfxPatterns = [{ id: 5, editGroups: ['meadow green'] }] as unknown as GfxPattern[];
const terrainPatterns = [{ typeId: 1, patternId: 5 }] as unknown as TerrainPattern[];

const CHOP_ATOMIC = 9;
const index = buildSoundIndex(bank, gfxPatterns, terrainPatterns);
const bindings = defaultBindings({ chopAtomicId: CHOP_ATOMIC });

const CANVAS_W = 800;
const CANVAS_H = 600;
// tileToScreen(5,5) = (0,160); this offset places it at the screen centre.
const camera: Camera = { offsetX: 400, offsetY: 140, scale: 1 };

/** A snapshot with a settler (id 3) and a building (id 7), both at tile (5,5). */
function snapshotAt(events: readonly SimEvent[] = []): WorldSnapshot {
  const at = { x: 5 * ONE, y: 5 * ONE };
  return {
    tick: 1,
    entities: [
      { id: 3, components: { Position: at, Settler: {} } },
      { id: 7, components: { Position: at, Building: { buildingType: 2 } } },
    ],
    events,
  };
}

function direct(events: readonly SimEvent[], terrain?: AudioTerrain) {
  return directAudio({
    events,
    snapshot: snapshotAt(events),
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings,
    ...(terrain ? { terrain } : {}),
  });
}

describe('directAudio one-shots', () => {
  it('fires a positioned action SFX for an on-screen building placement', () => {
    const frame = direct([{ kind: 'buildingPlaced', entity: 7, at: { x: 5, y: 5 } }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['static/hammer01.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.pan).toBeCloseTo(0, 5); // centred emitter
    expect(shot?.key).toBe('buildingPlaced:5,5');
  });

  it('fires a non-spatial jingle for a building finishing', () => {
    const frame = direct([{ kind: 'buildingFinished', entity: 7 }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['jingles/jingles_housebuilt.wav']);
    expect(frame.oneShots[0]?.gain).toBeCloseTo(JINGLE_GAIN, 5);
    expect(frame.oneShots[0]?.pan).toBe(0);
    expect(frame.oneShots[0]?.key).toBe('buildingFinished:7');
  });

  it('positions a chop SFX at the working settler via the atomic binding', () => {
    const frame = direct([{ kind: 'atomicCompleted', entity: 3, atomicId: CHOP_ATOMIC }]);
    expect(frame.oneShots).toHaveLength(1);
    expect(frame.oneShots[0]?.files).toEqual(['static/axe01.wav']);
    expect(frame.oneShots[0]?.key).toBe('atomicCompleted:3');
  });

  it('stays silent for an off-screen emitter', () => {
    const frame = direct([{ kind: 'buildingPlaced', entity: 7, at: { x: 100, y: 100 } }]);
    expect(frame.oneShots).toHaveLength(0);
  });

  it('ignores events with no binding and bindings with no bank group', () => {
    const frame = direct([
      { kind: 'buildingUpgraded', entity: 7, level: 2 }, // no binding
      { kind: 'goodProduced', building: 7, goodType: 2, amount: 1 }, // bound to a group absent from the fixture bank
      { kind: 'atomicCompleted', entity: 3, atomicId: 999 }, // no atomic binding
    ]);
    expect(frame.oneShots).toHaveLength(0);
  });
});

describe('directAudio ambient', () => {
  const meadow: AudioTerrain = { width: 10, height: 10, typeIds: new Array(100).fill(1) };

  it('activates the terrain ambient bed under the viewport with a positive gain', () => {
    const frame = direct([], meadow);
    expect(frame.ambient).toHaveLength(1);
    expect(frame.ambient[0]?.name).toBe('Meadow Green');
    expect(frame.ambient[0]?.file).toBe('ambient/meadow1.wav');
    expect(frame.ambient[0]?.gain).toBeGreaterThan(0);
  });

  it('produces no ambient without a terrain grid', () => {
    expect(direct([]).ambient).toHaveLength(0);
  });

  it('produces no ambient when the visible terrain has no bound bed', () => {
    const bare: AudioTerrain = { width: 10, height: 10, typeIds: new Array(100).fill(42) };
    expect(direct([], bare).ambient).toHaveLength(0);
  });

  it('produces no ambient when the camera frames only empty space off the map', () => {
    // Pan the map far off the right edge so the viewport no longer overlaps the grid's projected box.
    const offMap = directAudio({
      events: [],
      snapshot: snapshotAt(),
      camera: { offsetX: 100_000, offsetY: 0, scale: 1 },
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      index,
      bindings,
      terrain: meadow,
    });
    expect(offMap.ambient).toHaveLength(0);
  });
});
