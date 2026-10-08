import {
  buildSoundIndex,
  defaultBindings,
  directAudio,
  OneShotArbiter,
  SELECT_COOLDOWN_S,
  UI_CUE_FILES,
  type UiCue,
  type VoiceCall,
} from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createSelectionVoice } from '../src/view/unit-controls/selection-voice.js';
import { snapshotOf } from './support/snapshot.js';

/** A selection click speaks through the sound driver's selection voice, which a re-click inside the
 *  cooldown leaves silent; with nothing to speak it still clicks. */

const VIKING = 1;
const SETTLER = 3;
const HOUSE = 9;
const bank: SoundBank = {
  staticGroups: [
    { name: 'Viking male ok 01', sfx: [{ file: 'humantalk/m1ok02.wav', params: [80] }] },
    { name: 'Viking male ok 02', sfx: [{ file: 'humantalk/m2ok08.wav', params: [80] }] },
  ],
  ambient: [],
  jingles: [],
  humanVoices: [
    {
      tribe: VIKING,
      voiceClass: 'male',
      respondOk: ['Viking male ok 01', 'Viking male ok 02'],
      respondNo: [],
    },
  ],
  animalCalls: [],
};
const index = buildSoundIndex(bank, [], [], [], [{ typeId: VIKING, id: 'viking' }]);
const snapshot = snapshotOf([
  {
    id: SETTLER,
    components: {
      Position: { x: fx.fromInt(5), y: fx.fromInt(5) },
      Settler: { tribe: VIKING },
      Person: { person: true },
      Owner: { player: 0 },
    },
  },
  { id: HOUSE, components: { Position: { x: fx.fromInt(6), y: fx.fromInt(5) }, Building: {} } },
]);

function harness() {
  const calls: VoiceCall[] = [];
  const cues: UiCue[] = [];
  const voice = createSelectionVoice({ select: (call) => calls.push(call) }, (cue) => cues.push(cue));
  const arbiter = new OneShotArbiter();
  /** What the frame after the last call plays at `now` audio-clock seconds. */
  const heard = (now: number): readonly string[] => {
    const selection = calls.at(-1);
    const frame = directAudio({
      events: [],
      snapshot,
      camera: { offsetX: 0, offsetY: 0, scale: 1 },
      canvasW: 800,
      canvasH: 600,
      index,
      bindings: defaultBindings(),
      ...(selection !== undefined ? { selection } : {}),
    });
    return arbiter.decide(frame.oneShots, now).flatMap((shot) => shot.files);
  };
  return { voice, calls, cues, heard };
}

describe('selection voice', () => {
  it('answers a selecting click in the settler own shortest line, once per cooldown', () => {
    const h = harness();
    h.voice.click(SETTLER, false);
    expect(h.cues).toEqual([]);
    expect(h.calls).toEqual([{ members: [SETTLER], fallback: 'confirm' }]);
    expect(h.heard(0)).toEqual(['humantalk/m2ok08.wav']); // id 3 speaks with pool 3 % 2
    h.voice.click(SETTLER, false);
    expect(h.heard(SELECT_COOLDOWN_S / 2)).toEqual([]);
    h.voice.click(SETTLER, false);
    expect(h.heard(SELECT_COOLDOWN_S)).toEqual(['humantalk/m2ok08.wav']);
  });

  it('clicks for a house, a dropped unit or a game without a sound bank', () => {
    const h = harness();
    h.voice.click(HOUSE, false);
    expect(h.heard(0)).toEqual([UI_CUE_FILES.confirm]);
    h.voice.click(SETTLER, true);
    expect(h.cues).toEqual(['confirm']);
    const cues: UiCue[] = [];
    createSelectionVoice(undefined, (cue) => cues.push(cue)).click(SETTLER, false);
    expect(cues).toEqual(['confirm']);
  });

  it('lets a box select speak without a fallback click, and an empty box stay silent', () => {
    const h = harness();
    h.voice.box([]);
    expect(h.calls).toEqual([]);
    h.voice.box([HOUSE, SETTLER]);
    expect(h.calls).toEqual([{ members: [HOUSE, SETTLER] }]);
  });
});
