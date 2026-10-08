import type { SoundBank } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import type { Entity, HalfCellNode, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { AlertDesk, noticeVoiceShot } from '../src/data/alerts.js';
import { JINGLE_BIRTH, JINGLE_DUCK_HOLD_MS, JINGLE_TECHNOLOGY } from '../src/data/bindings.js';
import {
  ALERT_DUCK_DB,
  ALERT_DUCKED_BUSES,
  ATTACK_ALERT_GAIN,
  ATTACK_ALERT_INTERVAL_S,
  ATTACK_ALERT_MIN_GAP_S,
  AttackAlerts,
  type AttackReport,
  buildSoundIndex,
  defaultBindings,
  directAudio,
  LANE_RANK,
  NOTICE_CARD_GAIN,
  NOTICE_CUE_INTERVAL_S,
  notificationShot,
  type OneShot,
  OneShotArbiter,
  UI_CUE_GAIN,
  WebAudioEngine,
} from '../src/index.js';
import { FakeContext, type FakeGain, flush } from './helpers/fake-audio.js';
import { mixerGraph } from './helpers/mixer-graph.js';

/**
 * The attack alert and the notices' sounds: when the horn sounds (off screen only, once per place per
 * interval, sooner for a new front), how the alert lane ranks it against the jingles, and the notice
 * voices and cues. Positions are half-cell nodes; one node is 34 world px across and 9.5 down at 1:1.
 */

const CANVAS_W = 800;
const CANVAS_H = 600;
const view = { camera: { offsetX: 0, offsetY: 0, scale: 1 } as Camera, canvasW: CANVAS_W, canvasH: CANVAS_H };
/** A view panned far right, off every node the tests hit. */
const awayView = { ...view, camera: { offsetX: -100_000, offsetY: 0, scale: 1 } as Camera };

const ON_SCREEN: HalfCellNode = { hx: 10, hy: 10 };
const OFF_SCREEN: HalfCellNode = { hx: 100, hy: 10 };
/** 340 world px from {@link OFF_SCREEN}: the same front. */
const SAME_FRONT: HalfCellNode = { hx: 110, hy: 10 };
/** 3400 world px from {@link OFF_SCREEN}: a new front. */
const NEW_FRONT: HalfCellNode = { hx: 200, hy: 10 };

const base = (at: HalfCellNode): AttackReport => ({ front: 'base', at });
const units = (at: HalfCellNode): AttackReport => ({ front: 'units', at });

describe('attack alerts', () => {
  it('stays silent for a hit the camera shows', () => {
    expect(new AttackAlerts().decide([base(ON_SCREEN)], view, 0)).toBeNull();
  });

  it('alerts an off-screen place once per interval while it stays under attack', () => {
    const alerts = new AttackAlerts();
    expect(alerts.decide([units(OFF_SCREEN)], view, 0)).toEqual(units(OFF_SCREEN));
    expect(alerts.decide([units(SAME_FRONT)], view, ATTACK_ALERT_INTERVAL_S - 1)).toBeNull();
    expect(alerts.decide([units(SAME_FRONT)], view, ATTACK_ALERT_INTERVAL_S)).toEqual(units(SAME_FRONT));
  });

  it('alerts a new front a screen away sooner, but never inside the least gap', () => {
    const alerts = new AttackAlerts();
    expect(alerts.decide([units(OFF_SCREEN)], view, 0)).not.toBeNull();
    expect(alerts.decide([units(NEW_FRONT)], view, ATTACK_ALERT_MIN_GAP_S - 1)).toBeNull();
    expect(alerts.decide([units(NEW_FRONT)], view, ATTACK_ALERT_MIN_GAP_S)).toEqual(units(NEW_FRONT));
    // Both fronts are now known: neither alerts again inside the interval.
    expect(alerts.decide([units(OFF_SCREEN), units(NEW_FRONT)], view, 2 * ATTACK_ALERT_MIN_GAP_S)).toBeNull();
  });

  it('keeps quiet about a fight the player watched and then turned away from', () => {
    const alerts = new AttackAlerts();
    expect(alerts.decide([base(ON_SCREEN)], view, 0)).toBeNull();
    expect(alerts.decide([base(ON_SCREEN)], awayView, 1)).toBeNull();
    expect(alerts.decide([base(ON_SCREEN)], awayView, 1 + ATTACK_ALERT_INTERVAL_S)).toEqual(base(ON_SCREEN));
  });

  it('escalates from people hit in the field to the settlement hit at the same place', () => {
    const alerts = new AttackAlerts();
    expect(alerts.decide([units(OFF_SCREEN)], view, 0)).not.toBeNull();
    expect(alerts.decide([base(SAME_FRONT)], view, ATTACK_ALERT_MIN_GAP_S)).toEqual(base(SAME_FRONT));
    expect(alerts.decide([units(SAME_FRONT)], view, 2 * ATTACK_ALERT_MIN_GAP_S)).toBeNull();
  });

  it("sounds the gravest of a frame's fronts", () => {
    const alerts = new AttackAlerts();
    expect(alerts.decide([units(OFF_SCREEN), base(NEW_FRONT)], view, 0)).toEqual(base(NEW_FRONT));
  });
});

const bank: SoundBank = {
  staticGroups: [
    { name: 'Magic Horn', logicSoundType: 60, sfx: [{ file: 'static/horn01.wav', params: [80] }] },
    { name: 'Yawn Man', logicSoundType: 35, sfx: [{ file: 'generic/human_yawn m 01.wav', params: [80] }] },
    {
      name: 'Yawn Woman',
      logicSoundType: 38,
      sfx: [{ file: 'generic/human_yawn f 01.wav', params: [80] }],
    },
  ],
  ambient: [],
  jingles: [
    { name: '', musicType: JINGLE_TECHNOLOGY, sfx: [{ file: 'jingles/jingles_technology.wav', params: [] }] },
  ],
  humanVoices: [],
  animalCalls: [],
};
const index = buildSoundIndex(bank, [], []);
const bindings = defaultBindings();

const LOCAL = 0;
const MAN = 1;
const WOMAN = 2;
const CHILD = 3;
const entity = (id: number): Entity => id as Entity;
const snapshot: WorldSnapshot = {
  tick: 1,
  entities: [
    { id: MAN, components: { Person: {} } },
    { id: WOMAN, components: { Person: {}, Female: {} } },
    { id: CHILD, components: { Person: {}, Age: {} } },
  ],
  events: [],
};

describe('alert and notice sounds', () => {
  it("sounds the horn on the ui lane at the front's level, ducking the world", () => {
    const desk = new AlertDesk();
    desk.reportAttack(base(OFF_SCREEN));
    const [horn] = desk.take(view, snapshot, index, bindings, 0);
    expect(horn?.files).toEqual(['static/horn01.wav']);
    expect(horn?.gain).toBe(ATTACK_ALERT_GAIN.base);
    expect(horn?.lane).toEqual({ kind: 'alert', alert: 'baseAttacked' });
    expect(horn?.duckWorldDb).toBe(ALERT_DUCK_DB);
    expect(ATTACK_ALERT_GAIN.units).toBeLessThan(ATTACK_ALERT_GAIN.base);
    // The reports were taken: the next frame starts empty.
    expect(desk.take(view, snapshot, index, bindings, ATTACK_ALERT_INTERVAL_S)).toEqual([]);
  });

  it("speaks a notice in the settler's class voice, once per interval, and not for a child", () => {
    expect(noticeVoiceShot(index, bindings, snapshot, 'weary', MAN)?.files).toEqual([
      'generic/human_yawn m 01.wav',
    ]);
    expect(noticeVoiceShot(index, bindings, snapshot, 'hungry', WOMAN)?.files).toEqual([
      'generic/human_sigh f 01.wav',
      'generic/human_sigh f 02.wav',
    ]);
    expect(noticeVoiceShot(index, bindings, snapshot, 'weary', CHILD)).toBeNull();
    const desk = new AlertDesk();
    desk.speak('weary', MAN);
    desk.speak('weary', WOMAN);
    const first = desk.take(view, snapshot, index, bindings, 0);
    expect(first.map((s) => s.lane)).toEqual([{ kind: 'alert', alert: 'weary' }]);
    desk.speak('weary', WOMAN);
    expect(desk.take(view, snapshot, index, bindings, NOTICE_CUE_INTERVAL_S - 1)).toEqual([]);
    desk.speak('weary', WOMAN);
    expect(desk.take(view, snapshot, index, bindings, NOTICE_CUE_INTERVAL_S)).toHaveLength(1);
  });

  it('rings the notification cues, a card under a press', () => {
    expect(notificationShot('card')).toMatchObject({
      files: ['gui/briefing_popup.wav'],
      gain: NOTICE_CARD_GAIN,
    });
    expect(notificationShot('chat').files).toEqual(['gui/chat_incoming.wav']);
    expect(notificationShot('arrival').files).toEqual(['gui/chat_incoming.wav']);
    expect(notificationShot('departure')).toMatchObject({ files: ['gui/click_fail.wav'], gain: UI_CUE_GAIN });
    expect(notificationShot('card').lane).toBeUndefined();
  });

  it("rings the technology jingle map-wide for the seat's own discovery only", () => {
    const discovery = (player: number): SimEvent => ({
      kind: 'technologyDiscovered',
      entity: entity(MAN),
      player,
      tribe: 1,
      technology: 'job',
      typeId: 4,
    });
    const frame = (player: number) =>
      directAudio({
        events: [discovery(player)],
        snapshot,
        camera: awayView.camera,
        canvasW: CANVAS_W,
        canvasH: CANVAS_H,
        index,
        bindings,
        localPlayer: LOCAL,
      }).oneShots;
    expect(frame(LOCAL).map((s) => s.files)).toEqual([['jingles/jingles_technology.wav']]);
    expect(frame(LOCAL)[0]?.duckMusicMs).toBe(JINGLE_DUCK_HOLD_MS.get(JINGLE_TECHNOLOGY));
    expect(frame(LOCAL + 1)).toEqual([]);
  });
});

/** Every lane shot is taken to ring this long, so the waiting ones ring a second apart. */
const CLIP_S = 1;

function laneShot(alert: 'baseAttacked' | 'unitsAttacked' | 'hungry'): OneShot {
  return { files: [`${alert}.wav`], gain: 1, pan: 0, key: alert, lane: { kind: 'alert', alert } };
}

const birth: OneShot = {
  files: ['jingles/birth.wav'],
  gain: 1,
  pan: 0,
  key: 'born',
  lane: { kind: 'jingle', musicType: JINGLE_BIRTH },
};

describe('alert lane ladder', () => {
  it('ranks defeat over the settlement over people over the economy over completions', () => {
    expect(LANE_RANK.critical).toBeGreaterThan(LANE_RANK.baseAttacked);
    expect(LANE_RANK.baseAttacked).toBeGreaterThan(LANE_RANK.unitsAttacked);
    expect(LANE_RANK.unitsAttacked).toBeGreaterThan(LANE_RANK.economy);
    expect(LANE_RANK.economy).toBeGreaterThan(LANE_RANK.completion);
  });

  it("rings a frame's lane shots one at a time, gravest first", () => {
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => CLIP_S } });
    const keys = (shots: readonly OneShot[]): string[] => shots.map((s) => s.key);
    const offered = [birth, laneShot('hungry'), laneShot('unitsAttacked'), laneShot('baseAttacked')];
    expect(keys(arbiter.decide(offered, 0))).toEqual(['baseAttacked']);
    expect(keys(arbiter.decide([], CLIP_S))).toEqual(['unitsAttacked']);
    expect(keys(arbiter.decide([], 2 * CLIP_S))).toEqual(['hungry']);
    expect(keys(arbiter.decide([], 3 * CLIP_S))).toEqual(['born']);
  });

  it('never lets a birth delay an alert: the alert rings over it at once', () => {
    const arbiter = new OneShotArbiter({ playback: { clipLengthS: () => CLIP_S } });
    expect(arbiter.decide([birth], 0)).toHaveLength(1);
    expect(arbiter.decide([laneShot('unitsAttacked')], CLIP_S / 2).map((s) => s.key)).toEqual([
      'unitsAttacked',
    ]);
  });
});

/** The fake decoder makes a wav last as many seconds as it has bytes. */
const HORN_S = 4;

describe('alert duck', () => {
  it('dips the world and ambient buses for the alert wav, leaving the ui and music alone', async () => {
    const ctx = new FakeContext();
    const engine = new WebAudioEngine({
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async () => new ArrayBuffer(HORN_S),
    });
    await engine.resume();
    const { buses, duck: musicDuck } = mixerGraph(ctx);
    const ducks = ALERT_DUCKED_BUSES.map((bus) => buses[bus].connectedTo[0] as FakeGain);
    expect(ALERT_DUCKED_BUSES).toEqual(['world', 'ambient']);
    const horn: OneShot = {
      files: ['static/horn01.wav'],
      gain: 1,
      pan: 0,
      key: 'alert:baseAttacked',
      lane: { kind: 'alert', alert: 'baseAttacked' },
      duckWorldDb: ALERT_DUCK_DB,
    };
    engine.apply({ oneShots: [horn], ambient: [] });
    await flush(); // the duck lands with the wav, once its load resolves
    for (const duck of ducks)
      expect(duck.gain.ramps.at(-1)?.value).toBeCloseTo(10 ** (ALERT_DUCK_DB / 20), 5);
    expect(musicDuck.gain.ramps).toHaveLength(0);
    expect(buses.ui.connectedTo[0]).not.toBe(ducks[0]);
    ctx.currentTime = HORN_S - 1;
    engine.apply({ oneShots: [], ambient: [] });
    for (const duck of ducks) expect(duck.gain.ramps).toHaveLength(1);
    ctx.currentTime = HORN_S;
    engine.apply({ oneShots: [], ambient: [] });
    for (const duck of ducks) expect(duck.gain.ramps.at(-1)?.value).toBe(1);
  });
});
