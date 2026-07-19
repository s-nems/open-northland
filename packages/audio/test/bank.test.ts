import type { GfxPattern, SoundBank, TerrainPattern } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { buildSoundIndex } from '../src/index.js';

/**
 * The sound index build: the raw bank's lookups plus the terrain→ambient join that bridges a map
 * cell's `typeId` to the pattern-GROUP-keyed ambient beds via the IR's `terrainPatterns` + a
 * representative `GfxPattern`'s `editGroups`.
 */
const bank: SoundBank = {
  staticGroups: [
    { name: 'Hammer Wood', logicSoundType: 1, sfx: [{ file: 'static/hammer01.wav', params: [80] }] },
    { name: '', sfx: [{ file: 'static/skip.wav', params: [] }] }, // nameless → skipped
    // A duplicated logicSoundType: the first-listed group keeps the id (the bank's one known collision).
    { name: 'SocialTalk Male', logicSoundType: 61, sfx: [{ file: 'voice/male_social.wav', params: [80] }] },
    { name: 'SocialTalk Dup', logicSoundType: 61, sfx: [{ file: 'voice/dup.wav', params: [80] }] },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow1.wav', params: [0, 0, 0] }],
    },
    {
      name: 'Water See',
      patternGroups: ['water 2x2'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/water3.wav', params: [0, 0, 0] }],
    },
  ],
  jingles: [{ name: '', musicType: 26, sfx: [{ file: 'jingles/jingles_housebuilt.wav', params: [] }] }],
};

const gfxPatterns = [
  { id: 5, editGroups: ['meadow all', 'meadow green'] },
  { id: 9, editGroups: ['water 2x2'] },
] as unknown as GfxPattern[];

const terrainPatterns = [
  { typeId: 1, patternId: 5 },
  { typeId: 2, patternId: 5 },
  { typeId: 7, patternId: 9 },
  { typeId: 99, patternId: 404 }, // representative pattern absent → no ambient
] as unknown as TerrainPattern[];

describe('buildSoundIndex', () => {
  const index = buildSoundIndex(bank, gfxPatterns, terrainPatterns);

  it('indexes static groups by lower-cased name and skips nameless groups', () => {
    expect(index.groupsByName.get('hammer wood')).toEqual(['static/hammer01.wav']);
    expect([...index.groupsByName.keys()]).toEqual(['hammer wood', 'socialtalk male', 'socialtalk dup']);
  });

  it('indexes groups by logicSoundType, first-listed winning a duplicated id', () => {
    expect(index.groupsByLogicSoundType.get(1)).toEqual(['static/hammer01.wav']);
    expect(index.groupsByLogicSoundType.get(61)).toEqual(['voice/male_social.wav']);
  });

  it('indexes jingles by MusicType', () => {
    expect(index.jinglesByMusicType.get(26)).toEqual(['jingles/jingles_housebuilt.wav']);
  });

  it('maps each ambient bed name to its loop wav', () => {
    expect(index.ambientLoopByName.get('Meadow Green')).toBe('ambient/meadow1.wav');
    expect(index.ambientLoopByName.get('Water See')).toBe('ambient/water3.wav');
  });

  it('joins terrain typeIds to ambient beds through pattern editGroups', () => {
    expect(index.ambientByTerrainType.get(1)).toEqual(['Meadow Green']);
    expect(index.ambientByTerrainType.get(2)).toEqual(['Meadow Green']);
    expect(index.ambientByTerrainType.get(7)).toEqual(['Water See']);
    expect(index.ambientByTerrainType.has(99)).toBe(false);
  });

  it('yields an empty terrain join when no pattern tables are supplied', () => {
    const bare = buildSoundIndex(bank, [], []);
    expect(bare.ambientByTerrainType.size).toBe(0);
    expect(bare.groupsByName.get('hammer wood')).toBeDefined(); // event layers still work
  });
});
