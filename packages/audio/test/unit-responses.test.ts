import type { SoundBank } from '@open-northland/data';
import { type Camera, ONE, tileToScreen } from '@open-northland/render/data';
import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildSoundIndex, defaultBindings, directAudio, oneShotBus, type VoiceCall } from '../src/index.js';

/** Settlers answering the player sound on their own bus, the one a player turns down as "unit responses". */

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
