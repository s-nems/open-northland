import type { HumanVoices, VoiceClass } from '@open-northland/data';
import { type Camera, tileToScreen } from '@open-northland/render/data';
import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  CLICK_FREE_RAMP_S,
  defaultBindings,
  KEY_COOLDOWN_S,
  SFX_BURST,
  SoundDriver,
  type SoundIndex,
  WORLD_VOICE_CAP,
} from '../src/index.js';
import { FakeContext, type FakeGain, type FakeNode, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The arbiter's playback seam through the driver: the arbiter reads each wav's decoded length from the
 * engine's sample cache, a world shot it steals fades out in the engine before its source stops, and a
 * GUI cue passes its key cooldown like any other shot.
 */

const CANVAS_W = 800;
const CANVAS_H = 600;
const CENTRE_TILE = 5;
/** A tile right of centre but on screen, where a shot sounds quieter than at the centre. */
const SIDE_TILE = 8;
const centre = tileToScreen(CENTRE_TILE, CENTRE_TILE);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };

const SIDE_SETTLER = 3;
const CENTRE_SETTLER = 4;
/** The first `logicSoundType` of the test bank's single-wav groups, one group per id. */
const FIRST_SOUND_TYPE = 100;
const GROUP_COUNT = WORLD_VOICE_CAP + 1;

const VIKING_MAN: HumanVoices = {
  tribe: 1,
  voiceClass: 'male',
  generic: 'Generic Viking Male',
  respondOk: [],
  respondNo: [],
};

function settler(id: number, col: number): WorldSnapshot['entities'][number] {
  return {
    id,
    components: {
      Position: { x: col * ONE, y: CENTRE_TILE * ONE },
      Settler: { tribe: 1, jobType: 0 },
      Person: { person: true },
      Owner: { player: 0 },
    },
  };
}

const index: SoundIndex = {
  groupsByName: new Map([['generic viking male', ['generic/m 01.wav']]]),
  groupsByLogicSoundType: new Map(
    Array.from({ length: GROUP_COUNT }, (_, i) => [FIRST_SOUND_TYPE + i, [`work/${i}.wav`]] as const),
  ),
  jinglesByMusicType: new Map(),
  ambientLoopByName: new Map(),
  ambientByTerrainType: new Map(),
  groundLogicTypeByTerrainType: new Map(),
  humanVoices: new Map([[1, new Map<VoiceClass, HumanVoices>([['male', VIKING_MAN]])]]),
  heroJobs: new Set(),
  animalCalls: new Map(),
  landscapeAmbienceByRecord: new Map(),
  poolGains: new Map(),
};

/** A driver whose fake context decodes every wav as `clipSeconds` long (one second per fetched byte). */
function makeDriver(clipSeconds: number): { readonly driver: SoundDriver; readonly ctx: FakeContext } {
  const ctx = new FakeContext();
  const driver = new SoundDriver(index, defaultBindings(), {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async () => new ArrayBuffer(clipSeconds),
    random: () => 0,
  });
  return { driver, ctx };
}

function snapshotAt(tick: number): WorldSnapshot {
  return {
    tick,
    entities: [settler(SIDE_SETTLER, SIDE_TILE), settler(CENTRE_SETTLER, CENTRE_TILE)],
    events: [],
  };
}

function cue(entity: number, soundType: number): SimEvent {
  return { kind: 'atomicSound', entity: entity as Entity, soundType };
}

/** The gain node a one-shot source feeds through its panner. */
function shotGain(source: FakeSource): FakeGain {
  const panner = source.connectedTo[0] as FakeNode;
  return panner.connectedTo[0] as FakeGain;
}

describe('SoundDriver playback seam', () => {
  it('holds a voice for the length its wav decoded to, not the default', async () => {
    const CLIP_S = 4;
    const { driver, ctx } = makeDriver(CLIP_S);
    await driver.resume();
    const frame = (tick: number) => ({
      snapshot: snapshotAt(tick),
      camera,
      canvasW: CANVAS_W,
      canvasH: CANVAS_H,
      events: [],
      localPlayer: 0,
      drawnCreatures: () => [SIDE_SETTLER],
    });
    driver.update(frame(1)); // the first frame sets the tick clock
    driver.update(frame(2)); // random 0: the roll wins and the man natters
    await flush();
    expect(ctx.sources).toHaveLength(1);
    ctx.currentTime = CLIP_S / 2; // past the default length, inside the decoded one
    driver.update(frame(3));
    await flush();
    expect(ctx.sources).toHaveLength(1);
    ctx.currentTime = CLIP_S + 1;
    driver.update(frame(4));
    await flush();
    expect(ctx.sources).toHaveLength(2);
  });

  it('swallows a repeat press of one GUI cue inside the key cooldown', async () => {
    const { driver, ctx } = makeDriver(1);
    await driver.resume();
    driver.cue('confirm');
    driver.cue('confirm');
    driver.cue('fail');
    await flush();
    expect(ctx.sources).toHaveLength(2);
    ctx.currentTime = KEY_COOLDOWN_S;
    driver.cue('confirm');
    await flush();
    expect(ctx.sources).toHaveLength(3);
  });

  it('fades out the world shot a louder one steals, then stops its source', async () => {
    const LONG_CLIP_S = 100;
    const { driver, ctx } = makeDriver(LONG_CLIP_S);
    await driver.resume();
    const base = { camera, canvasW: CANVAS_W, canvasH: CANVAS_H };
    // Fill the world from the quiet side, one budget burst a second.
    let soundType = FIRST_SOUND_TYPE;
    for (let second = 0; soundType < FIRST_SOUND_TYPE + WORLD_VOICE_CAP; second++) {
      ctx.currentTime = second;
      const events: SimEvent[] = [];
      for (let n = 0; n < SFX_BURST && soundType < FIRST_SOUND_TYPE + WORLD_VOICE_CAP; n++) {
        events.push(cue(SIDE_SETTLER, soundType++));
      }
      driver.update({ ...base, snapshot: snapshotAt(1), events });
      await flush();
    }
    expect(ctx.sources).toHaveLength(WORLD_VOICE_CAP);
    expect(ctx.sources.every((s) => s.stoppedAt === null)).toBe(true);
    const stealAt = ctx.currentTime + 1;
    ctx.currentTime = stealAt;
    driver.update({ ...base, snapshot: snapshotAt(1), events: [cue(CENTRE_SETTLER, soundType)] });
    await flush();
    expect(ctx.sources).toHaveLength(WORLD_VOICE_CAP + 1);
    // The first quiet shot gave up its slot: its gain ramps to silence and its source stops after.
    const victim = ctx.sources[0] as FakeSource;
    expect(shotGain(victim).gain.ramps).toEqual([{ value: 0, time: stealAt + CLICK_FREE_RAMP_S }]);
    expect(victim.stoppedAt).toBe(stealAt + CLICK_FREE_RAMP_S);
    expect(ctx.sources.filter((s) => s.stoppedAt !== null)).toHaveLength(1);
  });
});
