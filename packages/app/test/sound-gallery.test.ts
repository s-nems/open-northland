import { defaultBindings } from '@vinland/audio';
import type { SoundBank } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { buildSoundGalleryModel } from '../src/entries/sound.js';

/**
 * The `?sounds` gallery's PURE model: the auditable join of the decoded bank + the event→sound bindings.
 * This is the half a human can't self-judge made checkable — that the chop atomic reaches the axe clips,
 * a life event reaches its jingle, and the voice pools split by sex — without a browser or an AudioContext.
 */

const CHOP_ATOMIC = 24;

const bank: SoundBank = {
  staticGroups: [
    { name: 'Woodcutter Axe', sfx: [f('static/axe01.wav'), f('static/axe02.wav'), f('static/axe03.wav')] },
    { name: 'Hammer Wood', sfx: [f('static/hammer01.wav'), f('static/hammer02.wav')] },
    { name: 'Carpenter Saw', sfx: [f('static/carpenter_saw01.wav')] },
    { name: 'Generic Viking Male', sfx: [f('generic/m1.wav')] },
    { name: 'Talk Viking Male', sfx: [f('humantalk/talk_m01.wav')] },
    { name: 'SocialTalk Male', sfx: [f('humantalk/social_m01.wav')] },
    { name: 'Generic Viking Female', sfx: [f('generic/f1.wav')] },
    { name: 'Talk Viking Female', sfx: [f('humantalk/talk_f01.wav')] },
    { name: 'SocialTalk Female', sfx: [f('humantalk/social_f01.wav')] },
    { name: 'Generic Viking Children', sfx: [f('generic/c1.wav')] },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [f('ambient/meadow1.wav')],
    },
  ],
  jingles: [
    { name: 'House Built', musicType: 26, sfx: [f('jingles/jingles_housebuilt.wav')] },
    { name: 'Birth', musicType: 23, sfx: [f('jingles/jingles_birth.wav')] },
    { name: 'Death', musicType: 25, sfx: [f('jingles/jingles_death.wav')] },
  ],
};

/** A one-clip SoundSfx (params default to empty — the gallery reads only the file). */
function f(file: string): { file: string; params: number[] } {
  return { file, params: [] };
}

describe('buildSoundGalleryModel', () => {
  const model = buildSoundGalleryModel(bank, defaultBindings({ chopAtomicId: CHOP_ATOMIC }), CHOP_ATOMIC);

  it('binds the chop atomic to the axe clips as a positional sound', () => {
    const chop = model.actions.find((a) => a.label === 'Rąbanie drzewa');
    expect(chop?.kind).toBe('spatial');
    expect(chop?.sound).toBe('Woodcutter Axe');
    expect(chop?.clips).toEqual(['static/axe01.wav', 'static/axe02.wav', 'static/axe03.wav']);
  });

  it('binds a finished building to the house-built jingle (non-spatial)', () => {
    const finished = model.actions.find((a) => a.label === 'Ukończenie budowy');
    expect(finished?.kind).toBe('jingle');
    expect(finished?.sound).toBe('House Built');
    expect(finished?.clips).toEqual(['jingles/jingles_housebuilt.wav']);
  });

  it('binds placement and production to their positional groups', () => {
    expect(model.actions.find((a) => a.label === 'Postawienie budynku')?.sound).toBe('Hammer Wood');
    expect(model.actions.find((a) => a.label === 'Produkcja towaru')?.sound).toBe('Carpenter Saw');
  });

  it('splits voices by sex/age with resolved clips', () => {
    const byCls = new Map(model.voices.map((v) => [v.cls, v]));
    expect(byCls.get('male')?.groups.map((g) => g.group)).toEqual([
      'Generic Viking Male',
      'Talk Viking Male',
      'SocialTalk Male',
    ]);
    expect(byCls.get('female')?.groups.map((g) => g.group)).toEqual([
      'Generic Viking Female',
      'Talk Viking Female',
      'SocialTalk Female',
    ]);
    expect(byCls.get('child')?.groups.map((g) => g.group)).toEqual(['Generic Viking Children']);
    // Every listed voice group resolved to at least one clip from the bank (no dangling names).
    for (const v of model.voices) for (const g of v.groups) expect(g.clips.length).toBeGreaterThan(0);
  });

  it('lists every jingle and ambient bed', () => {
    expect(model.jingles.map((j) => j.group)).toEqual(['House Built', 'Birth', 'Death']);
    expect(model.ambient).toEqual([{ group: 'Meadow Green', clips: ['ambient/meadow1.wav'] }]);
  });

  it('omits an action whose binding is absent in this build (no empty rows)', () => {
    // No chop atomic id bound → the chop row is dropped rather than shown clip-less.
    const noChop = buildSoundGalleryModel(bank, defaultBindings(), CHOP_ATOMIC);
    expect(noChop.actions.some((a) => a.label === 'Rąbanie drzewa')).toBe(false);
    expect(noChop.actions.some((a) => a.label === 'Postawienie budynku')).toBe(true);
  });

  it('shows a group missing from the bank with an empty clip list, not a crash', () => {
    const bare: SoundBank = { staticGroups: [], ambient: [], jingles: [] };
    const m = buildSoundGalleryModel(bare, defaultBindings({ chopAtomicId: CHOP_ATOMIC }), CHOP_ATOMIC);
    // Voice groups still listed (the pools are static), each with no clips since the bank is empty.
    expect(m.voices.flatMap((v) => v.groups).every((g) => g.clips.length === 0)).toBe(true);
    // A spatial action whose group is missing resolves to an empty clip list (still shown for auditing).
    expect(m.actions.find((a) => a.label === 'Rąbanie drzewa')?.clips).toEqual([]);
  });
});
