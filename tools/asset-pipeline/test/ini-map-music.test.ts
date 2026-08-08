import { describe, expect, it } from 'vitest';
import { extractMusicType, parseIniSections } from '../src/decoders/ini.js';

describe('extractMusicType', () => {
  it('resolves a #DM_MUSIC_TYPE macro case-insensitively', () => {
    const sections = parseIniSections('[misc_music]\nmusictype #DM_MUSIC_TYPE_ADDON_MISSION_FRANKEN1\n');
    expect(extractMusicType(sections)).toBe(33);
    const mixed = parseIniSections('[misc_music]\nmusictype #dm_music_type_culture_viking\n');
    expect(extractMusicType(mixed)).toBe(2);
  });

  it('accepts the resolved-int skin', () => {
    const sections = parseIniSections('[misc_music]\nmusictype 15\n');
    expect(extractMusicType(sections)).toBe(15);
  });

  it('drops an unknown macro, an out-of-range int, and a missing section', () => {
    expect(
      extractMusicType(parseIniSections('[misc_music]\nmusictype #DM_MUSIC_TYPE_BOGUS\n')),
    ).toBeUndefined();
    expect(extractMusicType(parseIniSections('[misc_music]\nmusictype 39\n'))).toBeUndefined();
    expect(extractMusicType(parseIniSections('[misc_mapname]\nmapnamestringid 0\n'))).toBeUndefined();
  });
});
