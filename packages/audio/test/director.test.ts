import type { GfxPattern, SoundBank, TerrainPattern } from '@vinland/data';
import type { Camera } from '@vinland/render/data';
import { ONE, tileToScreen } from '@vinland/render/data';
import type { SimEvent, WorldSnapshot } from '@vinland/sim';
import { describe, expect, it } from 'vitest';
import {
  type AudioTerrain,
  JINGLE_GAIN,
  buildSoundIndex,
  defaultBindings,
  directAudio,
  onScreenSettlers,
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
// Centre the camera on tile (5,5) — computed through the live projection so the fixture stays
// valid whatever the calibrated pitch/model is (a hand-baked offset broke on every recalibration).
const centre = tileToScreen(5, 5);
const camera: Camera = {
  offsetX: CANVAS_W / 2 - centre.x,
  offsetY: CANVAS_H / 2 - centre.y,
  scale: 1,
};

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
    // `at` is a HALF-CELL NODE: cell (5,5) anchors at node (11,10) — the same screen point as tile (5,5).
    const frame = direct([{ kind: 'buildingPlaced', entity: 7, at: { x: 11, y: 10 } }]);
    expect(frame.oneShots).toHaveLength(1);
    const shot = frame.oneShots[0];
    expect(shot?.files).toEqual(['static/hammer01.wav']);
    expect(shot?.gain).toBeGreaterThan(0);
    expect(shot?.pan).toBeCloseTo(0, 5); // centred emitter
    expect(shot?.key).toBe('buildingPlaced:11,10');
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
    const frame = direct([{ kind: 'buildingPlaced', entity: 7, at: { x: 200, y: 200 } }]);
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

describe('onScreenSettlers', () => {
  it('returns only on-screen settlers, spatialised, with their sex/age classifiers', () => {
    const snap: WorldSnapshot = {
      tick: 1,
      entities: [
        { id: 3, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Settler: { jobType: 0 } } }, // adult male
        {
          id: 5,
          components: { Position: { x: 5 * ONE, y: 5 * ONE }, Settler: { jobType: 5 } }, // adult woman (job 5)
        },
        {
          id: 6,
          components: { Position: { x: 5 * ONE, y: 5 * ONE }, Settler: { jobType: 4 }, Age: { ticks: 10 } }, // child
        },
        { id: 4, components: { Position: { x: 100 * ONE, y: 100 * ONE }, Settler: {} } }, // far off screen
        { id: 7, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Building: {} } }, // not a settler
      ],
      events: [],
    };
    const found = onScreenSettlers(snap, camera, CANVAS_W, CANVAS_H);
    expect(found.map((s) => s.entity)).toEqual([3, 5, 6]);
    expect(found[0]?.gain).toBeGreaterThan(0);
    expect(found[0]?.pan).toBeCloseTo(0, 5); // centred
    // jobType is read off the snapshot; the Age component marks a young settler.
    expect(found.map((s) => s.jobType)).toEqual([0, 5, 4]);
    expect(found.map((s) => s.young)).toEqual([false, false, true]);
  });

  it('returns nothing when the crowd is off screen', () => {
    const snap: WorldSnapshot = {
      tick: 1,
      entities: [{ id: 3, components: { Position: { x: 100 * ONE, y: 100 * ONE }, Settler: {} } }],
      events: [],
    };
    expect(onScreenSettlers(snap, camera, CANVAS_W, CANVAS_H)).toHaveLength(0);
  });
});
