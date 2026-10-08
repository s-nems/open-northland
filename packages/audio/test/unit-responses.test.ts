import type { SoundBank } from '@open-northland/data';
import { type Camera, ONE, tileToScreen } from '@open-northland/render/data';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  buildSoundIndex,
  DEFAULT_UNIT_RESPONSES,
  defaultBindings,
  directAudio,
  gateResponse,
  oneShotBus,
  parseUnitResponses,
  responseSpeaks,
  SoundDriver,
  UI_CUE_FILES,
  UNIT_RESPONSE_MODES,
  type VoiceCall,
} from '../src/index.js';
import { FakeContext, flush } from './helpers/fake-audio.js';

/** Settlers answering the player sound on their own bus, the one a player turns down as "unit responses",
 *  and speak only as the player's unit responses choice lets them. */

const VIKING = 1;
const SETTLER = 3;
const BUILDING = 7;
const bank: SoundBank = {
  staticGroups: [{ name: 'Viking male ok 01', sfx: [{ file: 'humantalk/m1ok01.wav', params: [80] }] }],
  ambient: [],
  jingles: [],
  humanVoices: [{ tribe: VIKING, voiceClass: 'male', respondOk: ['Viking male ok 01'], respondNo: [] }],
  animalCalls: [],
};
const index = buildSoundIndex(bank, [], []);
const CANVAS_W = 800;
const CANVAS_H = 600;
const centre = tileToScreen(5, 5);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };
const snapshot: WorldSnapshot = {
  tick: 1,
  entities: [
    {
      id: SETTLER,
      components: {
        Position: { x: 5 * ONE, y: 5 * ONE },
        Settler: { tribe: VIKING },
        Person: { person: true },
      },
    },
    { id: BUILDING, components: { Position: { x: 5 * ONE, y: 5 * ONE }, Building: { buildingType: 2 } } },
  ],
  events: [],
};

function direct(call: { readonly selection?: VoiceCall; readonly responses?: VoiceCall[] }) {
  return directAudio({
    events: [],
    snapshot,
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings: defaultBindings(),
    ...call,
  }).oneShots;
}

describe('responses bus', () => {
  it("plays an order's answer and a selection's line on the responses bus", () => {
    const answer = direct({ responses: [{ members: [SETTLER] }] });
    const line = direct({ selection: { members: [SETTLER] } });
    expect(answer.length).toBeGreaterThan(0);
    expect(line).toHaveLength(1);
    for (const shot of [...answer, ...line]) expect(oneShotBus(shot)).toBe('responses');
  });

  it('leaves the click that stands in for a voiceless selection on the interface bus', () => {
    const [click] = direct({ selection: { members: [BUILDING], fallback: 'confirm' } });
    expect(click === undefined ? undefined : oneShotBus(click)).toBe('ui');
  });
});

describe('unit responses choice', () => {
  const ORDER: VoiceCall = { members: [SETTLER], fallback: 'confirm' };

  it('lets every call speak, only a selection, or none', () => {
    expect(
      UNIT_RESPONSE_MODES.map((mode) => [responseSpeaks(mode, 'order'), responseSpeaks(mode, 'selection')]),
    ).toEqual([
      [true, true],
      [false, true],
      [false, false],
    ]);
    expect(DEFAULT_UNIT_RESPONSES).toBe('all');
  });

  it('keeps the click of a silenced call and nothing else', () => {
    expect(gateResponse(ORDER, 'all', 'order')).toBe(ORDER);
    expect(gateResponse(ORDER, 'selection', 'order')).toEqual({ members: [], fallback: 'confirm' });
    const silenced = direct({ responses: [gateResponse(ORDER, 'off', 'order')] });
    expect(silenced.map((shot) => shot.files)).toEqual([[UI_CUE_FILES.confirm]]);
  });

  it('reads a stored choice back, or the default for anything else', () => {
    expect(parseUnitResponses('selection')).toBe('selection');
    expect(parseUnitResponses('loud')).toBe(DEFAULT_UNIT_RESPONSES);
    expect(parseUnitResponses(undefined)).toBe(DEFAULT_UNIT_RESPONSES);
  });

  it("gates the driver's orders and selections by the choice", async () => {
    const fetched: string[] = [];
    const ctx = new FakeContext();
    const driver = new SoundDriver(index, defaultBindings(), {
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new ArrayBuffer(1);
      },
    });
    await driver.resume();
    const frame = async (): Promise<string[]> => {
      fetched.length = 0;
      driver.update({ events: [], snapshot, camera, canvasW: CANVAS_W, canvasH: CANVAS_H });
      await flush();
      return fetched.map((url) => url.slice(url.lastIndexOf('/') + 1));
    };
    driver.setUnitResponses('selection');
    driver.respond(ORDER);
    expect(await frame()).toEqual(['click_confirm.wav']);
    ctx.currentTime += 10;
    driver.select({ members: [SETTLER] });
    expect(await frame()).toEqual(['m1ok01.wav']);
  });
});
