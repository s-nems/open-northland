import type { HumanVoices, VoiceClass } from '@open-northland/data';
import { type Camera, tileToScreen } from '@open-northland/render/data';
import { type Entity, ONE, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { SoundIndex } from '../../src/index.js';
import {
  defaultBindings,
  INTERLUDE_FADE_IN_S,
  MUSIC_SWITCH_TIMING,
  SELECT_COOLDOWN_S,
  SoundDriver,
  TENSE_ENTER_THREAT,
} from '../../src/index.js';
import {
  FakeContext,
  type FakeGain,
  type FakeSource,
  flush,
  servingSoundBanks,
} from '../support/fake-audio.js';
import { musicTrack } from '../support/music-manifest.js';

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
const VIKING_TRIBE = 1;
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
  ambientByGroundPattern: new Map(),
  ambientByTerrainType: new Map([[1, ['Meadow Green']]]),
  groundLogicTypeByTerrainType: new Map(),
  humanVoices: new Map([[1, new Map<VoiceClass, HumanVoices>([['male', VIKING_MAN]])]]),
  heroJobs: new Set(),
  heroFigures: new Map(),
  animalCalls: new Map(),
  attackAlertsByTribe: new Map(),
  landscapeAmbienceByRecord: new Map(),
  murmurByTribe: new Map(),
  musicCultureByTribe: new Map([[VIKING_TRIBE, 'norse']]),
  poolGains: new Map(),
  wavGains: new Map(),
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
    fetchBytes: servingSoundBanks(async (url) => {
      fetched.push(url);
      return new ArrayBuffer(4);
    }),
    random: () => 0,
  });
  return { driver, ctx, fetched };
}

const baseInput = { snapshot, camera, canvasW: CANVAS_W, canvasH: CANVAS_H };
/** Seconds a fetched clip decodes to: the fake decoder makes each of its four bytes a second. */
const FAKE_CLIP_S = 4;

describe('SoundDriver', () => {
  it('does no decision work while inaudible (no gesture yet), then plays after resume', async () => {
    const { driver, ctx, fetched } = makeDriver();
    const events: readonly SimEvent[] = [
      { kind: 'vehicleCreated', entity: 7 as Entity, vehicleType: 1, at: { hx: 5, hy: 5 } },
    ];
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toHaveLength(0); // dropped before the director even ran
    expect(driver.started).toBe(false);

    await driver.resume();
    expect(driver.started).toBe(true);
    driver.update({ ...baseInput, events });
    await flush();
    expect(fetched).toEqual(['/sounds/static/hammer01.flac']);
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
    expect(fetched).toEqual(['/sounds/gui/click_confirm.flac', '/sounds/gui/click_fail.flac']);
    expect(ctx.sources).toHaveLength(2);
    expect((ctx.sources[0] as FakeSource).started).toBe(true);
  });

  it('rations the frame through the arbiter on the audio clock: a second house-built jingle in one frame waits', async () => {
    const { driver, ctx, fetched } = makeDriver();
    await driver.resume();
    const house = (id: number) => ({
      id,
      components: { Position: { x: 5 * ONE, y: 5 * ONE }, Building: {}, Owner: { player: 0 } },
    });
    const twoHouses: WorldSnapshot = { ...snapshot, entities: [house(7), house(8)] };
    const events: readonly SimEvent[] = [
      { kind: 'buildingFinished', entity: 7 as Entity },
      { kind: 'buildingFinished', entity: 8 as Entity },
    ];
    driver.update({ ...baseInput, snapshot: twoHouses, events, localPlayer: 0 });
    await flush();
    expect(fetched).toEqual(['/sounds/jingles/jingles_housebuilt.flac']);
    expect(ctx.sources).toHaveLength(1);
    // Inside the jingle's own cooldown the repeat is swallowed, not queued.
    ctx.currentTime = 1;
    driver.update({ ...baseInput, snapshot: twoHouses, events: [], localPlayer: 0 });
    await flush();
    expect(ctx.sources).toHaveLength(1);
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
    expect(fetched).toEqual(['/sounds/voice/male_social.flac']);
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
    driver.respond({ members: [3] });
    driver.respond({ members: [99] }); // gone from the snapshot: nothing to answer with
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/humantalk/m1ok01.flac']);
    // Answered once: the next frame carries no pending order.
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toHaveLength(1);
  });

  it('acknowledges a selected settler with one line, not again inside its cooldown, and clicks for a building', async () => {
    const { driver, ctx, fetched } = makeDriver();
    await driver.resume();
    driver.select({ members: [3], fallback: 'confirm' });
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toEqual(['/sounds/humantalk/m1ok01.flac']);
    ctx.currentTime = SELECT_COOLDOWN_S / 2;
    driver.select({ members: [3], fallback: 'confirm' });
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(ctx.sources).toHaveLength(1); // re-selected inside the cooldown: silent
    ctx.currentTime = SELECT_COOLDOWN_S + FAKE_CLIP_S; // the first line has also ended
    driver.select({ members: [3], fallback: 'confirm' });
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(ctx.sources).toHaveLength(2);
    driver.select({ members: [7], fallback: 'confirm' }); // the building has no voice
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched.at(-1)).toBe('/sounds/gui/click_confirm.flac');
  });

  it('forgets a notice reported just before a mute instead of ringing it on unmute', async () => {
    const { driver, fetched } = makeDriver();
    await driver.resume();
    driver.noticeVoice('hungry', 3);
    driver.setEnabled(false);
    driver.update({ ...baseInput, events: [] });
    driver.setEnabled(true);
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toEqual([]);
    driver.noticeVoice('hungry', 3);
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(fetched).toHaveLength(1); // a fresh report still rings
  });

  it('counts no steal when an answer cuts the selection line before it', async () => {
    const { driver, ctx } = makeDriver();
    await driver.resume();
    driver.select({ members: [3], fallback: 'confirm' });
    driver.update({ ...baseInput, events: [] });
    await flush();
    ctx.currentTime = FAKE_CLIP_S / 2;
    driver.respond({ members: [3] });
    driver.update({ ...baseInput, events: [] });
    await flush();
    expect(driver.stats.started.free).toBe(2);
    expect(driver.stats.stolen).toBe(0);
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
    expect(fetched).toEqual(['/sounds/generic/m 01.flac']);
  });

  it('loops the map music, then cuts to its Danger variant once another player strikes us', async () => {
    const MISSION_ARABS1 = 17;
    const { driver, ctx, fetched } = makeDriver();
    await driver.resume();
    driver.setMusicMap({
      musicType: MISSION_ARABS1,
      manifest: {
        tracks: {
          mission_arabs1_standard: musicTrack('mission_arabs1_standard'),
          mission_arabs1_danger: musicTrack('mission_arabs1_danger'),
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
    await flush();
    // The map's stem loops on, so the Danger stem waits for its prefetch or a fight.
    const calm = ['/music/mission_arabs1_standard.ogg'];
    expect(fetched).toEqual(calm);

    // Re-asking for the same track every frame must not re-fetch it.
    driver.update({ ...ours, events: [] });
    await flush();
    expect(fetched).toEqual(calm);

    const ENEMY = 2;
    const struck: readonly SimEvent[] = Array.from({ length: TENSE_ENTER_THREAT }, () => ({
      kind: 'combatHit',
      damage: 250,
      targetMaxHealth: 1000,
      attacker: 9 as Entity,
      attackerPlayer: ENEMY,
      target: 7 as Entity,
      at: { hx: 5, hy: 5 },
    }));
    const calmSources = ctx.sources.length;
    driver.update({ ...ours, events: struck });
    await flush();
    await flush();
    // The cut-in opens on the Danger stem, fetched once.
    expect(fetched).toEqual([...calm, '/music/mission_arabs1_danger.ogg']);
    expect(ctx.sources).toHaveLength(calmSources + 1);
  });

  it('plays the nation’s music for the local tribe, falling back to it on a map without music', async () => {
    const MISSION_ARABS1 = 17;
    const { driver, fetched } = makeDriver();
    await driver.resume();
    const manifest = {
      tracks: {
        mission_arabs1_standard: musicTrack('mission_arabs1_standard'),
        mission_midgard1_standard: musicTrack('mission_midgard1_standard'),
      },
    };
    const viking = { ...baseInput, events: [], localPlayer: 0, localTribe: VIKING_TRIBE } as const;
    driver.setMusicMap({ musicType: null, manifest });
    driver.update(viking);
    await flush();
    expect(fetched).toEqual(['/music/mission_midgard1_standard.ogg']);

    const switching = makeDriver();
    await switching.driver.resume();
    switching.driver.setMusicMap({ musicType: MISSION_ARABS1, manifest });
    switching.driver.update(viking);
    await flush();
    expect(switching.fetched).toEqual(['/music/mission_arabs1_standard.ogg']);
    switching.driver.setMusicSource('nation');
    switching.driver.update(viking);
    await flush();
    expect(switching.fetched.at(-1)).toBe('/music/mission_midgard1_standard.ogg');
  });

  it('opens a source switched during a fight on its fight music', async () => {
    const MISSION_ARABS1 = 17;
    const ENEMY = 2;
    const { driver, fetched } = makeDriver();
    await driver.resume();
    driver.setMusicMap({
      musicType: MISSION_ARABS1,
      manifest: {
        tracks: {
          mission_arabs1_standard: musicTrack('mission_arabs1_standard'),
          mission_midgard1_standard: musicTrack('mission_midgard1_standard'),
          attack_viking: musicTrack('attack_viking'),
        },
      },
    });
    const owned: WorldSnapshot = {
      tick: 1,
      entities: [{ id: 7, components: { Owner: { player: 1 }, Building: {} } }],
      events: [],
    };
    const ours = { ...baseInput, snapshot: owned, localPlayer: 1, localTribe: VIKING_TRIBE } as const;
    const struck: readonly SimEvent[] = Array.from({ length: TENSE_ENTER_THREAT }, () => ({
      kind: 'combatHit',
      damage: 250,
      targetMaxHealth: 1000,
      attacker: 9 as Entity,
      attackerPlayer: ENEMY,
      target: 7 as Entity,
      at: { hx: 5, hy: 5 },
    }));
    driver.update({ ...ours, events: struck });
    await flush();
    driver.setMusicSource('nation');
    await flush();
    expect(fetched).not.toContain('/music/mission_midgard1_standard.ogg');
    expect(fetched).toContain('/music/attack_viking.ogg');
  });
});

describe('SoundDriver interlude', () => {
  const MISSION_ARABS1 = 17;
  const STANDARD = '/music/mission_arabs1_standard.ogg';
  const DANGER = '/music/mission_arabs1_danger.ogg';
  /** An app asset: an absolute path, fetched as it stands rather than under the music base. */
  const INTERLUDE = musicTrack('battle', { file: '/audio/battle.ogg', loopStartS: 0 });
  const owned: WorldSnapshot = {
    tick: 1,
    entities: [{ id: 7, components: { Owner: { player: 1 }, Building: {} } }],
    events: [],
  };
  const ours = { ...baseInput, snapshot: owned, localPlayer: 1, events: [] } as const;

  async function mapMusic(): Promise<Harness> {
    const harness = makeDriver();
    await harness.driver.resume();
    harness.driver.setMusicMap({
      musicType: MISSION_ARABS1,
      manifest: {
        tracks: {
          mission_arabs1_standard: musicTrack('mission_arabs1_standard'),
          mission_arabs1_danger: musicTrack('mission_arabs1_danger'),
        },
      },
    });
    harness.driver.update(ours);
    await flush();
    return harness;
  }

  /** The source made last. */
  const latest = (ctx: FakeContext): FakeSource => {
    const source = ctx.sources.at(-1);
    if (source === undefined) throw new Error('no source');
    return source;
  };

  it('crossfades into the track, plays it once and then resumes the map music', async () => {
    const { driver, ctx, fetched } = await mapMusic();
    const map = latest(ctx);
    driver.playInterlude(INTERLUDE);
    await flush();
    expect(fetched.at(-1)).toBe('/audio/battle.ogg');
    const interlude = latest(ctx);
    // Opens now, under the map stem's fade, rising over its own fade-in; one pass, no loop.
    expect(interlude.startedAt).toBe(0);
    expect(map.stoppedAt).toBe(MUSIC_SWITCH_TIMING.fadeS);
    expect((interlude.connectedTo[0] as FakeGain).gain.ramps[0]).toEqual({
      value: 1,
      time: INTERLUDE_FADE_IN_S,
    });
    expect(interlude.loop).toBe(false);
    expect(interlude.playsForS).toBe(FAKE_CLIP_S);

    interlude.onended?.();
    await flush();
    expect(latest(ctx)).not.toBe(interlude);
    expect(latest(ctx).buffer).not.toBeNull();
    expect(fetched.filter((url) => url === '/audio/battle.ogg')).toHaveLength(1);
    expect(fetched).toContain(STANDARD);
  });

  it('does not restart the track while it plays, nor let a fight cut it short', async () => {
    const { driver, ctx, fetched } = await mapMusic();
    driver.playInterlude(INTERLUDE);
    await flush();
    const interlude = latest(ctx);
    const sources = ctx.sources.length;
    driver.playInterlude(INTERLUDE);
    const struck: readonly SimEvent[] = Array.from({ length: TENSE_ENTER_THREAT }, () => ({
      kind: 'combatHit',
      damage: 250,
      targetMaxHealth: 1000,
      attacker: 9 as Entity,
      attackerPlayer: 2,
      target: 7 as Entity,
      at: { hx: 5, hy: 5 },
    }));
    driver.update({ ...ours, events: struck });
    await flush();
    expect(ctx.sources).toHaveLength(sources);
    expect(interlude.stoppedAt).toBeNull();

    // The fight the playlist followed meanwhile is what resumes, and a later launch plays it again.
    interlude.onended?.();
    await flush();
    expect(fetched.at(-1)).toBe(DANGER);
    driver.playInterlude(INTERLUDE);
    await flush();
    expect(latest(ctx).startedAt).toBe(0);
    expect(ctx.sources).toHaveLength(sources + 2);
  });

  it('queues nothing while sound is off', async () => {
    const { driver, ctx } = await mapMusic();
    driver.setEnabled(false);
    const sources = ctx.sources.length;
    driver.playInterlude(INTERLUDE);
    driver.setEnabled(true);
    await flush();
    // Unmuting re-asserts the map music, not a launch made while muted.
    expect(
      ctx.sources.slice(sources).some((source) => source.playsForS === FAKE_CLIP_S && !source.loop),
    ).toBe(false);
  });
});
