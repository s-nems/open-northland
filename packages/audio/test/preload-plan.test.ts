import type { SoundBank } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { buildSoundIndex, preloadPlan, SHIP_BELL_FILE, UI_CUE_FILES } from '../src/index.js';

const VIKING = 1;
const DEER = 8;
const HAMMER_SOUND_TYPE = 3;
const TALK_SOUND_TYPE = 113;
const BIRTH_JINGLE = 23;

const sfx = (...files: string[]) => files.map((file) => ({ file, params: [] }));

const bank: SoundBank = {
  staticGroups: [
    {
      name: 'Hammer Wood',
      logicSoundType: HAMMER_SOUND_TYPE,
      sfx: sfx('static/hammer 1.wav', 'static/hammer 2.wav'),
    },
    { name: 'Talk Viking Male', logicSoundType: TALK_SOUND_TYPE, sfx: sfx('generic/talk 1.wav') },
    { name: 'Viking Male Ok', sfx: sfx('humantalk/ok 1.wav') },
    { name: 'Viking Male No', sfx: sfx('humantalk/no 1.wav') },
    { name: 'Man Get Hit', sfx: sfx('static/hit 1.wav') },
    { name: 'Viking Murmur', sfx: sfx('generic/murmur 1.wav') },
    { name: 'Deer Call', sfx: sfx('generic/deer.wav') },
    // A reuse of the click: it stays in the earlier tier.
    { name: 'Click Again', logicSoundType: 4, sfx: sfx(UI_CUE_FILES.confirm) },
  ],
  ambient: [{ name: 'Water See', patternGroups: [], landscapeGroups: [], sfx: sfx('ambient/sea.wav') }],
  jingles: [{ name: 'Birth', musicType: BIRTH_JINGLE, sfx: sfx('jingles/birth.wav') }],
  humanVoices: [
    {
      tribe: VIKING,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Viking Murmur',
      respondOk: ['Viking Male Ok'],
      respondNo: ['Viking Male No'],
    },
  ],
  animalCalls: [{ tribe: DEER, minCount: 1, probability: 1, group: 'Deer Call' }],
};

describe('preloadPlan', () => {
  const plan = preloadPlan(buildSoundIndex(bank, [], []));

  it('orders the bank from clicks, answers and refusals to jingles, work and combat, then talk and beds', () => {
    expect(plan).toEqual([
      ...Object.values(UI_CUE_FILES).map((file) => ({ file, tier: 'interface' })),
      { file: SHIP_BELL_FILE, tier: 'interface' },
      { file: 'humantalk/ok 1.wav', tier: 'interface' },
      { file: 'humantalk/no 1.wav', tier: 'interface' },
      { file: 'jingles/birth.wav', tier: 'jingle' },
      { file: 'static/hit 1.wav', tier: 'action' },
      { file: 'static/hammer 1.wav', tier: 'action' },
      { file: 'static/hammer 2.wav', tier: 'action' },
      { file: 'generic/murmur 1.wav', tier: 'chatter' },
      { file: 'generic/talk 1.wav', tier: 'chatter' },
      { file: 'generic/deer.wav', tier: 'chatter' },
      { file: 'ambient/sea.wav', tier: 'ambient' },
    ]);
  });

  it('lists each wav once', () => {
    expect(new Set(plan.map((entry) => entry.file)).size).toBe(plan.length);
  });
});
