import { defaultBindings } from '@open-northland/audio';
import type { SoundBank } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { buildSoundGalleryModel } from '../src/entries/sound.js';

/**
 * The `?sounds` gallery's PURE model: the auditable join of the decoded bank + the event→sound bindings.
 * This is the half a human can't self-judge made checkable - that a life event reaches its jingle, that
 * the voice pools split by sex, and that every cue group is auditable by its `logicSoundType` id - without
 * a browser or an AudioContext.
 */

const bank: SoundBank = {
  staticGroups: [
    {
      name: 'Woodcutter Axe',
      logicSoundType: 9,
      sfx: [f('static/axe01.wav'), f('static/axe02.wav'), f('static/axe03.wav')],
    },
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

/** A one-clip SoundSfx (params default to empty - the gallery reads only the file). */
function f(file: string): { file: string; params: number[] } {
  return { file, params: [] };
}

describe('buildSoundGalleryModel', () => {
  const model = buildSoundGalleryModel(bank, defaultBindings());

  it('lists every cue group with the logicSoundType id an animation names it by', () => {
    // A settler's work sounds are not bound here - the animation names them - so the gallery auditions
    // the groups themselves, keyed by the id an `event <at> 34 <id>` row carries.
    const axe = model.cues.find((c) => c.group === 'Woodcutter Axe');
    expect(axe?.soundType).toBe(9);
    expect(axe?.clips).toEqual(['static/axe01.wav', 'static/axe02.wav', 'static/axe03.wav']);
    // A group the extraction left without an id is unreachable from a cue, so it is not offered as one.
    expect(model.cues.map((c) => c.group)).toEqual(['Woodcutter Axe']);
  });

  it('binds a finished building to the house-built jingle, marked screen-gated', () => {
    const finished = model.actions.find((a) => a.label === 'Ukończenie budowy');
    expect(finished?.kind).toBe('jingle');
    expect(finished?.screenGated).toBe(true);
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
    // Swing and release moved to the animation cue, so nothing binds them - and no row claims they exist.
    const labels = model.actions.map((a) => a.label);
    expect(labels).not.toContain('Rąbanie drzewa');
    expect(labels).toContain('Postawienie budynku');
  });

  it('shows a group missing from the bank with an empty clip list, not a crash', () => {
    const bare: SoundBank = { staticGroups: [], ambient: [], jingles: [] };
    const m = buildSoundGalleryModel(bare, defaultBindings());
    // Voice groups still listed (the pools are static), each with no clips since the bank is empty.
    expect(m.voices.flatMap((v) => v.groups).every((g) => g.clips.length === 0)).toBe(true);
    // A spatial action whose group is missing resolves to an empty clip list (still shown for auditing).
    expect(m.actions.find((a) => a.label === 'Postawienie budynku')?.clips).toEqual([]);
    expect(m.cues).toEqual([]);
  });
});
