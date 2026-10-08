import type { Camera } from '@open-northland/render/data';
import { type EntitySnapshot, ONE, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  defaultBindings,
  LANDSCAPE_REFERENCE_SCREEN_H,
  LANDSCAPE_REFERENCE_SCREEN_W,
  SoundDriver,
  type SoundIndex,
} from '../src/index.js';
import { FakeContext } from './helpers/fake-audio.js';

/** The driver rolls the object ambience on the audio clock: the game's speed and a held clock decide
 *  nothing but whether it rolls at all. */

const TREE_RECORD = 7;
const BIRDS = ['ambient/bird_01.wav'];
/** A chance that every roll fires, so the offered count is the rolls made. */
const SURE_CHANCE = 10_000;
const index: SoundIndex = {
  groupsByName: new Map(),
  groupsByLogicSoundType: new Map(),
  jinglesByMusicType: new Map(),
  ambientLoopByName: new Map(),
  ambientByGroundPattern: new Map(),
  ambientByTerrainType: new Map(),
  groundLogicTypeByTerrainType: new Map(),
  humanVoices: new Map(),
  heroJobs: new Set(),
  animalCalls: new Map(),
  landscapeAmbienceByRecord: new Map([
    [TREE_RECORD, { name: 'Trees', weight: 1, pools: [{ files: BIRDS, weight: 1, chance: SURE_CHANCE }] }],
  ]),
  murmurByTribe: new Map(),
  poolGains: new Map(),
  wavGains: new Map(),
};

const camera: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
const TREE_COL = 4;
const TREE_ROW = 6;
const tree: EntitySnapshot = {
  id: 1,
  components: {
    Position: { x: TREE_COL * ONE, y: TREE_ROW * ONE },
    Resource: { goodType: 1, remaining: 3, harvestAtomic: 24, gfxIndex: TREE_RECORD },
  },
};
const MAP_SIDE = 40;
const terrain = { width: MAP_SIDE, height: MAP_SIDE, typeIds: new Array<number>(MAP_SIDE ** 2).fill(0) };
const at = (tick: number): WorldSnapshot => ({ tick, entities: [tree], events: [] });

async function makeDriver(): Promise<{ driver: SoundDriver; ctx: FakeContext }> {
  const ctx = new FakeContext();
  const driver = new SoundDriver(index, defaultBindings(), {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async () => new ArrayBuffer(4),
    random: () => 0,
  });
  await driver.resume();
  return { driver, ctx };
}

/** Frames at `fps` for one audio second, the sim advancing `ticksPerFrame` each; the rolls offered. */
function runSecond(
  driver: SoundDriver,
  ctx: FakeContext,
  fps: number,
  ticksPerFrame: number,
  paused = false,
): number {
  const before = Object.values(driver.stats.offered).reduce((a, b) => a + b, 0);
  let tick = 0;
  for (let frame = 0; frame <= fps; frame++) {
    ctx.currentTime = frame / fps;
    tick += ticksPerFrame;
    driver.update({
      events: [],
      snapshot: at(tick),
      camera,
      canvasW: LANDSCAPE_REFERENCE_SCREEN_W,
      canvasH: LANDSCAPE_REFERENCE_SCREEN_H,
      terrain,
      paused,
    });
  }
  return Object.values(driver.stats.offered).reduce((a, b) => a + b, 0) - before;
}

describe('SoundDriver object ambience clock', () => {
  const FPS = 60;
  const FAST_FORWARD_TICKS_PER_FRAME = 4;

  it('rolls at the tick rate per audio second, however fast the game runs', async () => {
    const normal = await makeDriver();
    expect(runSecond(normal.driver, normal.ctx, FPS, 1)).toBe(TICKS_PER_SECOND);
    const fast = await makeDriver();
    expect(runSecond(fast.driver, fast.ctx, FPS, FAST_FORWARD_TICKS_PER_FRAME)).toBe(TICKS_PER_SECOND);
  });

  it('rolls nothing while the game clock is held', async () => {
    const { driver, ctx } = await makeDriver();
    expect(runSecond(driver, ctx, FPS, 0, true)).toBe(0);
  });
});
