import type { SoundBank } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildSoundIndex } from '../../../src/data/bank/bank.js';
import { humanVoicesOf, voiceClassIn } from '../../../src/data/bank/voices.js';

const VIKING = 1;
const HEROINE = 47;

const bank: SoundBank = {
  staticGroups: [],
  ambient: [],
  jingles: [],
  humanVoices: [
    { tribe: VIKING, voiceClass: 'male', scream: 'Man Get Hit', respondOk: [], respondNo: [] },
    { tribe: VIKING, voiceClass: 'female', scream: 'Woman Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [],
  attackAlerts: [],
};
const jobs = [{ typeId: HEROINE, id: 'heroine_bow_xena' }];

const heroine = (components: Record<string, unknown> = {}): EntitySnapshot => ({
  id: 1,
  components: {
    Settler: { tribe: VIKING, jobType: HEROINE },
    Person: { person: true },
    Female: { female: true },
    ...components,
  },
});

describe('voiceClassIn', () => {
  it('voices a heroine drawn as herself as a woman', () => {
    const index = buildSoundIndex(bank, [], [], jobs, [], [], [{ tribe: VIKING, job: HEROINE }]);
    expect(voiceClassIn(index, heroine())).toBe('female');
    expect(humanVoicesOf(index, heroine())?.scream).toBe('Woman Get Hit');
  });

  it('voices a heroine drawn as a soldier as a man, the scream included', () => {
    const index = buildSoundIndex(bank, [], [], jobs);
    expect(voiceClassIn(index, heroine())).toBe('male');
    expect(humanVoicesOf(index, heroine())?.scream).toBe('Man Get Hit');
  });

  it('keeps a child a child', () => {
    const index = buildSoundIndex(bank, [], [], jobs);
    expect(voiceClassIn(index, heroine({ Age: { ticks: 1 } }))).toBe('child');
  });
});
