import type { VoiceClass } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  AMBIENT_MAX_GAIN,
  auditionBed,
  auditionShot,
  defaultBindings,
  KEY_COOLDOWN_S,
  POOL_INSTANCE_CAP,
  POOL_RETRIGGER_S,
  SFX_BURST,
  SoundDriver,
  type SoundIndex,
  type SoundStatsView,
  WORLD_VOICE_CAP,
} from '../src/index.js';
import { FakeContext, type FakePanner, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The gallery's way through the driver: auditioned shots pass the arbiter like a game frame's, and the
 * driver's running counts tell offered from started per lane, and count the steals.
 */

const AXE: readonly string[] = ['work/axe1.wav', 'work/axe2.wav', 'work/axe3.wav', 'work/axe4.wav'];
const AXE_GAIN = 0.6;
const BIRTH_TYPE = 23;
const BIRTH: readonly string[] = ['jingles/birth.wav'];
const ANSWER: readonly string[] = ['humantalk/ok1.wav'];
const PAN_LEFT = -0.5;
const ZOOM_1_1 = 1;
const CLIP_S = 10;

const index: SoundIndex = {
  groupsByName: new Map([['axe', AXE]]),
  groupsByLogicSoundType: new Map(),
  jinglesByMusicType: new Map([[BIRTH_TYPE, BIRTH]]),
  ambientLoopByName: new Map([['Meadow', 'ambient/meadow.wav']]),
  ambientByGroundPattern: new Map(),
  ambientByTerrainType: new Map(),
  groundLogicTypeByTerrainType: new Map(),
  humanVoices: new Map<number, Map<VoiceClass, never>>(),
  heroJobs: new Set(),
  animalCalls: new Map(),
  landscapeAmbienceByRecord: new Map(),
  murmurByTribe: new Map(),
  poolGains: new Map([[AXE, AXE_GAIN]]),
  wavGains: new Map(),
};

function makeDriver(): { readonly driver: SoundDriver; readonly ctx: FakeContext } {
  const ctx = new FakeContext();
  const driver = new SoundDriver(index, defaultBindings(), {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async () => new ArrayBuffer(CLIP_S),
    random: () => 0,
  });
  return { driver, ctx };
}

function copy(stats: SoundStatsView): SoundStatsView {
  return { ...stats, offered: { ...stats.offered }, started: { ...stats.started } };
}

describe('auditionShot', () => {
  it('builds each role with the lane and guard the director gives it in play', () => {
    const world = auditionShot(index, AXE, { kind: 'world', layer: 'impact' }, 'k', PAN_LEFT);
    expect(world).toMatchObject({ gain: AXE_GAIN, pan: PAN_LEFT, lane: { kind: 'sfx' }, layer: 'impact' });
    expect(auditionShot(index, AXE, { kind: 'voice' }, 'k', 0)).toMatchObject({
      lane: { kind: 'voice' },
      exclusive: 'wav',
    });
    // A scream is rationed apart from the chatter and holds through a zoom-out like the blow it answers.
    expect(auditionShot(index, AXE, { kind: 'scream' }, 'k', 0)).toMatchObject({
      lane: { kind: 'voice', scream: true },
      layer: 'impact',
      exclusive: 'wav',
    });
    const answer = auditionShot(index, ANSWER, { kind: 'answer' }, 'k', 0);
    expect(answer.lane).toBeUndefined();
    expect(answer.exclusive).toBe('group');
    expect(answer.bus).toBe('responses');
    // A jingle rings centred and ducks the music for its type's hold, whatever the pan slider says.
    const jingle = auditionShot(index, BIRTH, { kind: 'jingle', musicType: BIRTH_TYPE }, 'k', PAN_LEFT);
    expect(jingle.pan).toBe(0);
    expect(jingle.lane).toEqual({ kind: 'jingle', musicType: BIRTH_TYPE });
    expect(jingle.duckMusicMs).toBeGreaterThan(0);
  });

  it('loops a bed at the gain it reaches when its ground fills the screen', () => {
    expect(auditionBed('Meadow', 'ambient/meadow.wav', PAN_LEFT)).toEqual({
      name: 'Meadow',
      file: 'ambient/meadow.wav',
      gain: AMBIENT_MAX_GAIN,
      pan: PAN_LEFT,
    });
  });
});

describe('SoundDriver audition and stats', () => {
  it('plays an auditioned world shot through its panner at the chosen pan', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    driver.audition(
      [auditionShot(index, AXE, { kind: 'world', layer: 'detail' }, 'a', PAN_LEFT)],
      [],
      ZOOM_1_1,
    );
    await flush();
    expect(ctx.sources).toHaveLength(1);
    const panner = (ctx.sources[0] as FakeSource).connectedTo[0] as FakePanner;
    expect(panner.pan.value).toBe(PAN_LEFT);
  });

  it('starts one shot of a pool per frame and holds the pool at its instance cap', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    const shot = (n: number) => auditionShot(index, AXE, { kind: 'world', layer: 'detail' }, `b${n}`, 0);
    // Three copies in one frame: only the pool's loudest starts.
    driver.audition([shot(0), shot(1), shot(2)], [], ZOOM_1_1);
    expect(driver.stats.offered.sfx).toBe(3);
    expect(driver.stats.started.sfx).toBe(1);
    // One copy a frame past the retrigger floor: the pool fills to its cap and refuses the rest.
    const frames = POOL_INSTANCE_CAP + 2;
    for (let n = 1; n <= frames; n++) {
      ctx.currentTime = n * POOL_RETRIGGER_S * 2;
      driver.audition([shot(n + 2)], [], ZOOM_1_1);
    }
    await flush();
    expect(driver.stats.started.sfx).toBe(POOL_INSTANCE_CAP);
    expect(ctx.sources).toHaveLength(POOL_INSTANCE_CAP);
    // Each start picked a wav the pool had not played lately.
    expect(new Set(ctx.sources.map((s) => s.buffer)).size).toBe(POOL_INSTANCE_CAP);
  });

  it('loops an auditioned bed until a later frame leaves it out', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    driver.audition([], [auditionBed('Meadow', 'ambient/meadow.wav', 0)], ZOOM_1_1);
    await flush();
    expect(ctx.sources.filter((s) => s.loop)).toHaveLength(1);
    expect(driver.stats.frames).toBe(0);
  });

  it('counts offered and started shots per lane across cues and frames', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    const before = copy(driver.stats);
    driver.cue('confirm');
    driver.cue('confirm'); // inside the key cooldown: offered, not started
    expect(driver.stats.offered.free - before.offered.free).toBe(2);
    expect(driver.stats.started.free - before.started.free).toBe(1);
    ctx.currentTime = KEY_COOLDOWN_S;
    const jingle = auditionShot(index, BIRTH, { kind: 'jingle', musicType: BIRTH_TYPE }, 'j', 0);
    driver.audition([jingle], [], ZOOM_1_1);
    expect(driver.stats.started.jingle).toBe(1);
    expect(driver.stats.stolen).toBe(0);
  });

  it('counts a world shot whose slot a louder one took', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    const QUIET = 0.1;
    const LOUD = 0.9;
    const pool = (n: number): readonly string[] => [`work/${n}.wav`];
    const shot = (n: number, gain: number) => ({
      ...auditionShot(index, pool(n), { kind: 'world', layer: 'detail' }, `s${n}`, 0),
      gain,
    });
    // Fill the world with quiet shots, one budget burst a second.
    for (let n = 0; n < WORLD_VOICE_CAP; n++) {
      ctx.currentTime = Math.floor(n / SFX_BURST);
      driver.audition([shot(n, QUIET)], [], ZOOM_1_1);
      await flush(); // decoded, each holds its slot for its whole length
    }
    expect(driver.stats.started.sfx).toBe(WORLD_VOICE_CAP);
    ctx.currentTime += 1;
    driver.audition([shot(WORLD_VOICE_CAP, LOUD)], [], ZOOM_1_1);
    expect(driver.stats.stolen).toBe(1);
  });
});
