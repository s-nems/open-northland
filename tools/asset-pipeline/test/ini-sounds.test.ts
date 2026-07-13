import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import { cifLinesToSections, extractSounds } from '../src/decoders/ini.js';

describe('extractSounds (soundfx.cif)', () => {
  // Mirrors the real soundfx.cif structure as cifLinesToSections yields it (verified by decoding the
  // actual file): SoundFXStatic groups (some with a LogicSoundType), SoundFXAmbient terrain beds keyed
  // on PatternGroup/LandscapeGroup, and SoundFXJingle life-event stingers with a MusicType. The file
  // disagrees with itself on case (SFX/sfx, SoundFXAmbient/SoundFxAmbient) — the extractor is
  // case-insensitive, so the fixture deliberately mixes cases. No copyrighted bytes: paths are invented.
  const lines: CifLine[] = [
    { level: 1, text: 'SoundFXStatic' },
    { level: 2, text: 'Name "Gui_Click"' },
    { level: 2, text: 'SFX "Data\\Engine2D\\Bin\\Sounds\\Gui\\Click_Confirm.wav" 80' },
    { level: 1, text: 'SoundFXStatic' },
    { level: 2, text: 'Name "Bear Sounds"' },
    { level: 2, text: 'LogicSoundType 42' },
    { level: 2, text: 'SFX "Data\\Engine2D\\Bin\\Sounds\\Static\\bear1.wav" 100' },
    { level: 2, text: 'sfx "Data\\Engine2D\\Bin\\Sounds\\Static\\bear2.wav" 100' },
    { level: 1, text: 'SoundFXAmbient' },
    { level: 2, text: 'Name "Water See"' },
    { level: 2, text: 'PatternGroup "water 2x2"' },
    { level: 2, text: 'SFX "Data\\Engine2D\\Bin\\Sounds\\Ambient\\Water3.wav" 0 0 0' },
    { level: 1, text: 'SoundFxAmbient' },
    { level: 2, text: 'Name "All Trees"' },
    { level: 2, text: 'LandscapeGroup "trees pine"' },
    { level: 2, text: 'LandscapeGroup "trees beech"' },
    { level: 2, text: 'SFX "Data\\Engine2D\\Bin\\Sounds\\Ambient\\Bird_01.wav" 10 70 5' },
    { level: 1, text: 'SoundFXJingle' },
    { level: 2, text: 'Name "Birth"' },
    { level: 2, text: 'MusicType 3' },
    { level: 2, text: 'SFX "Data\\Engine2D\\Bin\\Sounds\\Jingles\\jingles_birth.wav"' },
  ];

  it('decodes static groups, ambient beds and jingles with normalized paths', () => {
    const bank = extractSounds(cifLinesToSections(lines));

    expect(bank.staticGroups).toHaveLength(2);
    // Path is made relative to the sounds root and lower-cased; volume param preserved.
    expect(bank.staticGroups[0]).toEqual({
      name: 'Gui_Click',
      sfx: [{ file: 'gui/click_confirm.wav', params: [80] }],
    });
    // LogicSoundType captured; the case-varied second `sfx` line is folded into the same group.
    expect(bank.staticGroups[1]?.logicSoundType).toBe(42);
    expect(bank.staticGroups[1]?.sfx.map((s) => s.file)).toEqual(['static/bear1.wav', 'static/bear2.wav']);

    expect(bank.ambient).toHaveLength(2);
    expect(bank.ambient[0]).toEqual({
      name: 'Water See',
      patternGroups: ['water 2x2'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/water3.wav', params: [0, 0, 0] }],
    });
    // The `SoundFxAmbient` casing variant is still recognised; repeated LandscapeGroup lines accumulate.
    expect(bank.ambient[1]?.landscapeGroups).toEqual(['trees pine', 'trees beech']);
    expect(bank.ambient[1]?.sfx[0]?.params).toEqual([10, 70, 5]);

    expect(bank.jingles).toHaveLength(1);
    expect(bank.jingles[0]).toEqual({
      name: 'Birth',
      musicType: 3,
      sfx: [{ file: 'jingles/jingles_birth.wav', params: [] }],
    });
  });

  it('ignores unrecognised sections and yields an empty bank for none', () => {
    expect(extractSounds([])).toEqual({ staticGroups: [], ambient: [], jingles: [] });
    const onlyOther: CifLine[] = [
      { level: 1, text: 'landscapetype' },
      { level: 2, text: 'type 4' },
    ];
    expect(extractSounds(cifLinesToSections(onlyOther))).toEqual({
      staticGroups: [],
      ambient: [],
      jingles: [],
    });
  });
});
