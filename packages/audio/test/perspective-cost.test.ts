import type { GfxPattern, SoundBank, TerrainPattern } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import {
  type Entity,
  type EntitySnapshot,
  ONE,
  type SimEvent,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_MAX_SAMPLES,
  type AudioTerrain,
  buildSoundIndex,
  computeSpatial,
  defaultBindings,
  directAudio,
  FAR_ZOOM_SCALE,
  type OneShot,
  SHOT_LAYERS,
  SoundDriver,
  WebAudioEngine,
} from '../src/index.js';
import { FakeBiquad, FakeContext, flush } from './helpers/fake-audio.js';

/**
 * The listening perspective's cost on a busy, zoomed-out screen, counted rather than timed: the
 * director spatialises each frame event once and culls past the fade band, the ambient scan stays
 * inside its sample cap, and a zoom step touches the shared layer gains, never a playing shot.
 */

const WORK_SOUND = 1;
const MEADOW = 1;
const VIKING = 1;
const bank: SoundBank = {
  staticGroups: [
    { name: 'Hammer Wood', logicSoundType: WORK_SOUND, sfx: [{ file: 'static/hammer01.wav', params: [] }] },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow1.wav', params: [0, 0, 0] }],
    },
  ],
  jingles: [],
  humanVoices: [],
  animalCalls: [],
};
const MEADOW_PATTERN = 5;
const LAND = 2;
const index = buildSoundIndex(
  bank,
  [{ id: MEADOW_PATTERN, editGroups: ['meadow green'] }] as unknown as GfxPattern[],
  [{ typeId: MEADOW, patternId: MEADOW_PATTERN, logicType: LAND }] as unknown as TerrainPattern[],
);

/** A wide screen at the widest zoom: the most map a player hears at once. */
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const camera: Camera = { offsetX: 0, offsetY: 0, scale: FAR_ZOOM_SCALE };
/** The busy patch: a block of working settlers inside the screen. */
const BUSY_FROM = 10;
const BUSY_SIDE = 20;
/** As many again, working far off screen. */
const FAR_COL = 2000;

function settler(id: number, col: number, row: number): EntitySnapshot {
  return {
    id,
    components: {
      Position: { x: col * ONE, y: row * ONE },
      Settler: { tribe: VIKING },
      Person: { person: true },
      Owner: { player: 0 },
    },
  };
}

interface Scene {
  readonly snapshot: WorldSnapshot;
  readonly events: SimEvent[];
  readonly onScreen: number;
}

/** `BUSY_SIDE`² working settlers on screen, as many far off it, and `idle` more that do nothing. */
function busyScene(idle: number): Scene {
  const entities: EntitySnapshot[] = [];
  const events: SimEvent[] = [];
  let id = 1;
  let onScreen = 0;
  for (let i = 0; i < BUSY_SIDE * BUSY_SIDE; i++) {
    const col = BUSY_FROM + (i % BUSY_SIDE);
    const row = BUSY_FROM + Math.floor(i / BUSY_SIDE);
    entities.push(settler(id, col, row));
    events.push({ kind: 'atomicSound', entity: id as Entity, soundType: WORK_SOUND });
    if (computeSpatial(col, row, camera, CANVAS_W, CANVAS_H) !== null) onScreen++;
    id++;
    entities.push(settler(id, FAR_COL + col, row));
    events.push({ kind: 'atomicSound', entity: id as Entity, soundType: WORK_SOUND });
    id++;
  }
  for (let i = 0; i < idle; i++) entities.push(settler(id++, BUSY_FROM, BUSY_FROM));
  return { snapshot: { tick: 1, entities, events }, events, onScreen };
}

function decide(scene: Scene, terrain?: AudioTerrain): { shots: readonly OneShot[]; fogChecks: number } {
  let fogChecks = 0;
  const frame = directAudio({
    events: scene.events,
    snapshot: scene.snapshot,
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings: defaultBindings(),
    visibleTile: () => {
      fogChecks++;
      return true;
    },
    ...(terrain !== undefined ? { terrain } : {}),
  });
  return { shots: frame.oneShots, fogChecks };
}

describe('listening perspective cost on a busy screen', () => {
  it('hears the on-screen workers and none of the far ones', () => {
    const scene = busyScene(0);
    // Premise: the patch is on screen, several hundred strong, matched by as many far workers.
    expect(scene.onScreen).toBe(BUSY_SIDE * BUSY_SIDE);
    const { shots } = decide(scene);
    expect(shots).toHaveLength(scene.onScreen);
    const farKeys = shots.filter((s) => Number(s.key.split(':').at(-1)) % 2 === 0);
    expect(farKeys).toEqual([]);
  });

  it('spatialises each frame event once, however many idle settlers the snapshot holds', () => {
    const quiet = decide(busyScene(0));
    const crowded = decide(busyScene(20_000));
    expect(quiet.fogChecks).toBe(2 * BUSY_SIDE * BUSY_SIDE);
    expect(crowded.fogChecks).toBe(quiet.fogChecks);
    expect(crowded.shots).toHaveLength(quiet.shots.length);
  });

  it('samples at most its cap of terrain tiles at the widest zoom over a huge map', () => {
    const side = 1024;
    const terrain: AudioTerrain = {
      width: side,
      height: side,
      typeIds: new Array<number>(side * side).fill(MEADOW),
    };
    const scene: Scene = { snapshot: { tick: 1, entities: [], events: [] }, events: [], onScreen: 0 };
    const { fogChecks } = decide(scene, terrain);
    expect(fogChecks).toBeGreaterThan(0);
    expect(fogChecks).toBeLessThanOrEqual(AMBIENT_MAX_SAMPLES);
  });

  it('moves the same few layer params on a zoom step whether ten shots or hundreds are playing', async () => {
    const zoomStepAutomation = async (shotCount: number): Promise<number> => {
      const ctx = new FakeContext();
      const engine = new WebAudioEngine({
        createContext: () => ctx as unknown as AudioContext,
        fetchBytes: async () => new ArrayBuffer(4),
      });
      await engine.resume();
      const shots = decide(busyScene(0)).shots.slice(0, shotCount);
      engine.apply({ oneShots: shots, ambient: [] });
      await flush();
      expect(ctx.sources).toHaveLength(shotCount);
      const before = automationCount(ctx);
      engine.setCameraScale(FAR_ZOOM_SCALE);
      return automationCount(ctx) - before;
    };
    const few = await zoomStepAutomation(10);
    const many = await zoomStepAutomation(BUSY_SIDE * BUSY_SIDE);
    expect(many).toBe(few);
    // Each zoom-following layer gain and each muffle filter: anchor, cancel, ramp.
    const layerParams = 2 * SHOT_LAYERS.length + 1 + 2;
    expect(few).toBe(layerParams * AUTOMATION_CALLS_PER_RAMP);
  });

  it('sends the camera zoom from the driver once per change, not every frame', async () => {
    const ctx = new FakeContext();
    const driver = new SoundDriver(index, defaultBindings(), {
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async () => new ArrayBuffer(4),
    });
    await driver.resume();
    const frame = (scale: number): void =>
      driver.update({
        events: [],
        snapshot: { tick: 1, entities: [], events: [] },
        camera: { ...camera, scale },
        canvasW: CANVAS_W,
        canvasH: CANVAS_H,
      });
    frame(FAR_ZOOM_SCALE);
    const first = automationCount(ctx);
    expect(first).toBeGreaterThan(0);
    frame(FAR_ZOOM_SCALE);
    frame(FAR_ZOOM_SCALE);
    expect(automationCount(ctx)).toBe(first);
  });
});

/** `rampParam` records a cancel, an anchoring set and a ramp. */
const AUTOMATION_CALLS_PER_RAMP = 3;

/** Every automation call scheduled on the context's gains and filters so far. */
function automationCount(ctx: FakeContext): number {
  let calls = 0;
  for (const g of ctx.gains) calls += g.gain.events.length;
  for (const node of ctx.created) if (node instanceof FakeBiquad) calls += node.frequency.events.length;
  return calls;
}
