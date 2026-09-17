import { defaultBindings } from '@open-northland/audio';
import { emptySoundBank, type SoundBank } from '@open-northland/data';
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
    { name: 'Man Get Hit', sfx: [f('static/hit m 01.wav')] },
    { name: 'Viking male ok 01', sfx: [f('humantalk/m1ok01.wav')] },
    { name: 'Viking male no 01', sfx: [f('humantalk/m1no01.wav')] },
    { name: 'Generic Viking Children', sfx: [f('generic/c1.wav')] },
    { name: 'Bear Sounds', sfx: [f('generic/bear1.wav')] },
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
  humanVoices: [
    { tribe: 1, voiceClass: 'child', generic: 'Generic Viking Children', respondOk: [], respondNo: [] },
    {
      tribe: 1,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Generic Viking Male',
      respondOk: ['Viking male ok 01'],
      respondNo: ['Viking male no 01'],
    },
    { tribe: 2, voiceClass: 'male', scream: 'Man Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [{ tribe: 8, minCount: 1, probability: 10, group: 'Bear Sounds' }],
};

/** The tribe names a real IR supplies: vikings and bears named, the franks left to their number. */
const tribeLabel = (tribe: number): string | undefined =>
  tribe === 1 ? 'Wikingowie' : tribe === 8 ? 'niedźwiedź' : undefined;

/** A one-clip SoundSfx (params default to empty - the gallery reads only the file). */
function f(file: string): { file: string; params: number[] } {
  return { file, params: [] };
}

describe('buildSoundGalleryModel', () => {
  const model = buildSoundGalleryModel(bank, defaultBindings(), tribeLabel);

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

  it('binds vehicle completion and production to their positional groups', () => {
    expect(model.actions.find((a) => a.label === 'Ukończenie pojazdu')?.sound).toBe('Hammer Wood');
    expect(model.actions.find((a) => a.label === 'Produkcja towaru')?.sound).toBe('Carpenter Saw');
  });

  it('lists each tribe`s voices by class, grown first, with every role the data binds', () => {
    expect(model.voices.map((v) => v.label)).toEqual([
      'Wikingowie · Mężczyźni',
      'Wikingowie · Dzieci',
      'Plemię 2 · Mężczyźni',
    ]);
    expect(model.voices[0]?.groups.map((g) => g.group)).toEqual([
      'Krzyk: Man Get Hit',
      'Gwar: Generic Viking Male',
      'Tak: Viking male ok 01',
      'Nie: Viking male no 01',
    ]);
    expect(model.voices[1]?.groups.map((g) => g.group)).toEqual(['Gwar: Generic Viking Children']);
    // Every listed voice group resolved to at least one clip from the bank (no dangling names).
    for (const v of model.voices) for (const g of v.groups) expect(g.clips.length).toBeGreaterThan(0);
  });

  it('lists the animal calls by species', () => {
    expect(model.animalCalls).toEqual([{ group: 'niedźwiedź: Bear Sounds', clips: ['generic/bear1.wav'] }]);
  });

  it('lists every jingle and ambient bed', () => {
    expect(model.jingles.map((j) => j.group)).toEqual(['House Built', 'Birth', 'Death']);
    expect(model.ambient).toEqual([{ group: 'Meadow Green', clips: ['ambient/meadow1.wav'] }]);
  });

  it('lists one named row per bound event, so no binding hides from the listener', () => {
    // The rows come from the bindings, not a hand list: every bound kind needs a catalog label, and a
    // kind nothing binds (the chopping swing lives in the animation cue) gets no row.
    const bound = Object.keys(defaultBindings().byEvent);
    expect(model.actions).toHaveLength(bound.length);
    expect(model.actions.map((a) => a.label)).not.toContain('Rąbanie drzewa');
    expect(model.actions.find((a) => a.label === 'Odprawa')).toEqual({
      label: 'Odprawa',
      trigger: 'gdy skrypt mapy otwiera odprawę',
      sound: 'briefing',
      kind: 'cue',
      screenGated: false,
      clips: ['gui/briefing_popup.wav'],
    });
    // A jingle the bank lacks still shows its MusicType, so the gap is visible rather than silent.
    expect(model.actions.find((a) => a.label === 'Ślub')).toMatchObject({ sound: 'MusicType 22', clips: [] });
  });

  it('shows a group missing from the bank with an empty clip list, not a crash', () => {
    const bare: SoundBank = { ...emptySoundBank(), humanVoices: bank.humanVoices };
    const m = buildSoundGalleryModel(bare, defaultBindings());
    // Voice rows still listed from their table, each with no clips since the bank has no groups.
    expect(m.voices).toHaveLength(3);
    expect(m.voices.flatMap((v) => v.groups).every((g) => g.clips.length === 0)).toBe(true);
    // A spatial action whose group is missing resolves to an empty clip list (still shown for auditing).
    expect(m.actions.find((a) => a.label === 'Ukończenie pojazdu')?.clips).toEqual([]);
    expect(m.cues).toEqual([]);
  });
});
