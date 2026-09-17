import type { HumanVoices, VoiceClass } from '@open-northland/data';
import { type Camera, tileToScreen } from '@open-northland/render/data';
import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { SoundIndex } from '../src/index.js';
import { defaultBindings, SoundDriver } from '../src/index.js';
import { FakeContext, type FakeSource, flush } from './helpers/fake-audio.js';

/**
 * The app-facing façade end to end through the fake platform seams: one `update()` turns world state
 * into actual (fake) playback - event one-shots, terrain ambient, settler chat voices - and the whole
 * pipeline stays a free no-op while the engine is inaudible (no gesture yet / muted).
 */

/** The SocialTalk pair's `logicSoundType` ids (`soundfx.cif`) - what a talk clip's voice cue names. */
const SOCIALTALK_MALE = 61;

const VIKING_MAN: HumanVoices = {
  tribe: 1,
  voiceClass: 'male',
  generic: 'Generic Viking Male',
  respondOk: ['Viking male ok 01'],
  respondNo: [],
};
const index: SoundIndex = {
  groupsByName: new Map([
    ['hammer wood', ['static/hammer01.wav']],
    ['socialtalk male', ['voice/male_social.wav']],
    ['viking male ok 01', ['humantalk/m1ok01.wav']],
    ['generic viking male', ['generic/m 01.wav']],
  ]),
  groupsByLogicSoundType: new Map([[SOCIALTALK_MALE, ['voice/male_social.wav']]]),
  jinglesByMusicType: new Map([[26, ['jingles/jingles_housebuilt.wav']]]),
  ambientLoopByName: new Map([['Meadow Green', 'ambient/meadow1.wav']]),
  ambientByTerrainType: new Map([[1, ['Meadow Green']]]),
  groundLogicTypeByTerrainType: new Map(),
  humanVoices: new Map([[1, new Map<VoiceClass, HumanVoices>([['male', VIKING_MAN]])]]),
  animalCalls: new Map(),
};

const CANVAS_W = 800;
const CANVAS_H = 600;
// Centre the camera on tile (5,5) through the live projection (a hand-baked offset breaks on recalibration).
const centre = tileToScreen(5, 5);
const camera: Camera = {
  offsetX: CANVAS_W / 2 - centre.x,
  offsetY: CANVAS_H / 2 - centre.y,
  scale: 1,
};

const snapshot: WorldSnapshot = {
  tick: 1,
  entities: [
    {
      id: 3,
      components: {
        Position: { x: 5 * ONE, y: 5 * ONE },
        Settler: { tribe: 1, jobType: 0 },
        Person: { person: true },
        Owner: { player: 0 },
      },
    },
    { id: 7, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Building: {} } },
  ],
  events: [],
};

interface Harness {
  readonly driver: SoundDriver;
  readonly ctx: FakeContext;
  readonly fetched: string[];
}

function makeDriver(): Harness {
  const ctx = new FakeContext();
  const fetched: string[] = [];
  const driver = new SoundDriver(index, defaultBindings(), {
    createContext: () => ctx as unknown as AudioContext,
    fetchBytes: async (url) => {
      fetched.push(url);
      return new ArrayBuffer(4);
    },
    random: () => 0,
  });
  return { driver, ctx, fetched };
}

const baseInput = { snapshot, camera, canvasW: CANVAS_W, canvasH: CANVAS_H };

describe('SoundDriver', () => {
  it('does no decision work while inaudible (no gesture yet), then plays after resume', async () => {
    const { driver, ctx, fetched } = makeDriver();
    const events: readonly SimEvent[] = [{ kind: 'boatPlaced', entity: 7 as Entity, at: { hx: 5, hy: 5 } }];
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toHaveLength(0); // dropped before the director even ran
    expect(driver.started).toBe(false);

    await driver.resume();
    expect(driver.started).toBe(true);
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toEqual(['/sounds/static/hammer01.wav']);
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0] as FakeSource).started).toBe(true);
  });

  it('fires a GUI cue at once from the input event, and drops it while inaudible', async () => {
    const { driver, ctx, fetched } = makeDriver();
    driver.cue('confirm');
    await flush();
    expect(fetched).toHaveLength(0); // no gesture yet: nothing to hear it
    await driver.resume();
    driver.cue('confirm');
    driver.cue('fail');
    await flush();
    expect(fetched).toEqual(['/sounds/gui/click_confirm.wav', '/sounds/gui/click_fail.wav']);
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[0] as FakeSource).started).toBe(true);
  });

  it('starts the ambient bed for on-screen terrain handed through the frame input', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    const terrain = { width: 10, height: 10, typeIds: new Array(100).fill(1) };
    driver.update({ ...baseInput, events: [], terrain });
    await flush();
    expect(ctx.sources).toHaveLength(1);
    expect((ctx.sources[0] as FakeSource).loop).toBe(true); // the looping meadow bed
  });

  it('plays an authored cue from an on-screen settler, resolved by its logicSoundType id', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    const events: readonly SimEvent[] = [
      { kind: 'atomicSound', entity: 3 as Entity, soundType: SOCIALTALK_MALE },
    ];
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toEqual(['/sounds/voice/male_social.wav']);
  });

  it('keeps a fogged settler silent (the visibleTile gate)', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    const events: readonly SimEvent[] = [
      { kind: 'atomicSound', entity: 3 as Entity, soundType: SOCIALTALK_MALE },
    ];
    driver.update({ ...baseInput, events, visibleTile: () => false });
    await flush();
    expect(fetched).toHaveLength(0);
  });

  it('answers an ordered settler on the next frame, in its own voice', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    driver.respond(3);
    driver.respond(99); // gone from the snapshot: nothing to answer with
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/humantalk/m1ok01.wav']);
    // Answered once: the next frame carries no pending order.
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toHaveLength(1);
  });

  it('rolls the idle chatter over the drawn creatures once per game tick the frame advanced', async () => {
    const { driver, fetched } = makeDriver(); // random 0: every roll wins
    await driver.resume();
    const drawnCreatures = () => [3];
    driver.update({ ...baseInput, events: [], localPlayer: 0, drawnCreatures }); // the first frame sets the clock
    driver.update({ ...baseInput, events: [], localPlayer: 0, drawnCreatures }); // same tick: no roll
    await flush();
    expect(fetched).toHaveLength(0);
    driver.update({
      ...baseInput,
      snapshot: { ...snapshot, tick: 2 },
      events: [],
      localPlayer: 0,
      drawnCreatures,
    });
    await flush();
    expect(fetched).toEqual(['/sounds/generic/m 01.wav']);
  });

  it('plays the map music, then hands over to its Danger variant once we are struck', async () => {
    const MISSION_ARABS1 = 17;
    const { driver, fetched } = makeDriver();
    await driver.resume();
    driver.setMusicMap({
      musicType: MISSION_ARABS1,
      manifest: {
        tracks: {
          mission_arabs1_standard: { file: 'mission_arabs1_standard.ogg' },
          mission_arabs1_danger: { file: 'mission_arabs1_danger.ogg' },
        },
      },
    });
    // Its own snapshot: the struck building must carry an Owner for the blow to count as ours.
    const owned: WorldSnapshot = {
      tick: 1,
      entities: [{ id: 7, components: { Owner: { player: 1 }, Building: {} } }],
      events: [],
    };
    const ours = {
      ...baseInput,
      snapshot: owned,
      localPlayer: 1,
      standingOf: () => ({ population: 0, stance: 'neutral' }) as const,
    } as const;
    driver.update({ ...ours, events: [] });
    await flush();
    expect(fetched).toEqual(['/music/mission_arabs1_standard.ogg']);

    // Re-asking for the same track every frame must not re-fetch it.
    driver.update({ ...ours, events: [] });
    await flush();
    expect(fetched).toHaveLength(1);

    const struck: readonly SimEvent[] = [
      { kind: 'combatHit', attacker: 9 as Entity, target: 7 as Entity, at: { hx: 5, hy: 5 } },
    ];
    driver.update({ ...ours, events: struck });
    await flush();
    expect(fetched).toEqual(['/music/mission_arabs1_standard.ogg', '/music/mission_arabs1_danger.ogg']);
  });
});
