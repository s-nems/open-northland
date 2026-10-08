import type { GfxPattern, HumanVoices, SoundBank, TerrainPattern } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { BORROWED_TRIBE_VOICES, groupFiles, SILENT_PLACEHOLDER_FILE } from '../src/data/bank.js';
import { humanVoicesOf, responseGroup } from '../src/data/voices.js';
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
    { name: 'Stag Sounds', sfx: [{ file: SILENT_PLACEHOLDER_FILE, params: [80] }] },
    {
      name: 'Yawn Man',
      logicSoundType: 35,
      sfx: [
        { file: SILENT_PLACEHOLDER_FILE, params: [80] },
        { file: 'generic/human_yawn m 01.wav', params: [80] },
      ],
    },
    { name: 'Sleep Woman', logicSoundType: 36, sfx: [{ file: SILENT_PLACEHOLDER_FILE, params: [80] }] },
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
  humanVoices: [
    { tribe: 1, voiceClass: 'male', scream: 'Man Get Hit', respondOk: ['Viking male ok 01'], respondNo: [] },
    { tribe: 1, voiceClass: 'female', generic: 'Generic Viking Female', respondOk: [], respondNo: [] },
    { tribe: 5, voiceClass: 'male', scream: 'Weresnake Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [{ tribe: 8, minCount: 1, probability: 10, group: 'Bear Sounds' }],
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
  const index = buildSoundIndex(bank, gfxPatterns, terrainPatterns, [
    { typeId: 42, id: 'hero_unarmed' },
    { typeId: 47, id: 'heroine_bow_xena' },
    { typeId: 6, id: 'civilist' },
  ]);

  it('indexes static groups by lower-cased name and skips nameless groups', () => {
    expect(index.groupsByName.get('hammer wood')).toEqual(['static/hammer01.wav']);
    expect([...index.groupsByName.keys()]).toEqual([
      'hammer wood',
      'socialtalk male',
      'socialtalk dup',
      'stag sounds',
      'yawn man',
      'sleep woman',
    ]);
  });

  it('indexes groups by logicSoundType, first-listed winning a duplicated id', () => {
    expect(index.groupsByLogicSoundType.get(1)).toEqual(['static/hammer01.wav']);
    expect(index.groupsByLogicSoundType.get(61)).toEqual(['voice/male_social.wav']);
  });

  it("drops the data's silent placeholder slots, so a group of only placeholders plays nothing", () => {
    expect(groupFiles(index, 'Stag Sounds')).toBeUndefined();
    expect(index.groupsByLogicSoundType.get(36)).toEqual([]);
    expect(index.groupsByLogicSoundType.get(35)).toEqual(['generic/human_yawn m 01.wav']);
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

  it('keys the creature voice tables by tribe and class', () => {
    expect(index.humanVoices.get(1)?.get('male')?.scream).toBe('Man Get Hit');
    expect(index.humanVoices.get(1)?.get('female')?.generic).toBe('Generic Viking Female');
    expect(index.humanVoices.get(1)?.get('child')).toBeUndefined(); // a class the tribe leaves silent
    expect(index.humanVoices.get(5)?.get('male')?.scream).toBe('Weresnake Get Hit');
    expect(index.animalCalls.get(8)?.group).toBe('Bear Sounds');
    expect(index.animalCalls.get(9)).toBeUndefined();
  });

  it('indexes both hero and heroine job slugs for the authored hero response rule', () => {
    expect(index.heroJobs).toEqual(new Set([42, 47]));
  });
});

describe('tribe voice borrowing', () => {
  const SARACEN = 4;
  const EGYPT = 7;
  const HERO_JOB = 42;
  const tribes = [
    { typeId: SARACEN, id: 'saracen' },
    { typeId: EGYPT, id: 'egypt' },
  ];
  const saracenRows: HumanVoices[] = [
    {
      tribe: SARACEN,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Generic Arabian Male',
      respondOk: ['Arabian male ok 01', 'Arabian male ok 02'],
      respondNo: ['Arabian male no 01'],
    },
    {
      tribe: SARACEN,
      voiceClass: 'female',
      scream: 'Woman Get Hit',
      generic: 'Generic Viking Female',
      respondOk: [],
      respondNo: [],
    },
    { tribe: SARACEN, voiceClass: 'child', generic: 'Generic Viking Children', respondOk: [], respondNo: [] },
  ];
  const voiced = (rows: readonly HumanVoices[]): SoundBank => ({ ...bank, humanVoices: [...rows] });
  const egyptian = (id: number, components: Record<string, unknown> = {}): EntitySnapshot => ({
    id,
    components: { Settler: { tribe: EGYPT, jobType: null }, Person: { person: true }, ...components },
  });

  it('lends Egypt the Saracen pools by default', () => {
    expect(BORROWED_TRIBE_VOICES.get('egypt')).toBe('saracen');
  });

  it('gives a voiceless Egyptian settler an answer pool and a scream pool', () => {
    const index = buildSoundIndex(voiced(saracenRows), [], [], [], tribes);
    const man = egyptian(3);
    expect(responseGroup(index, man)).toBe('Arabian male ok 02');
    expect(humanVoicesOf(index, man)?.scream).toBe('Man Get Hit');
  });

  it('borrows every class, the hero rule included', () => {
    const jobs = [{ typeId: HERO_JOB, id: 'hero_unarmed' }];
    const index = buildSoundIndex(voiced(saracenRows), [], [], jobs, tribes);
    expect(humanVoicesOf(index, egyptian(2, { Female: { female: true } }))?.scream).toBe('Woman Get Hit');
    expect(humanVoicesOf(index, egyptian(2, { Age: { ticks: 1 } }))?.generic).toBe('Generic Viking Children');
    const hero = egyptian(3, { Settler: { tribe: EGYPT, jobType: HERO_JOB } });
    expect(responseGroup(index, hero)).toBe('Arabian male ok 01');
  });

  it('never borrows for a tribe with rows of its own', () => {
    const own: HumanVoices = {
      tribe: EGYPT,
      voiceClass: 'male',
      scream: 'Pharaoh Get Hit',
      respondOk: ['Egypt male ok 01'],
      respondNo: [],
    };
    const index = buildSoundIndex(voiced([...saracenRows, own]), [], [], [], tribes);
    expect(responseGroup(index, egyptian(3))).toBe('Egypt male ok 01');
    expect(humanVoicesOf(index, egyptian(3, { Female: { female: true } }))).toBeUndefined();
  });

  it('stays silent when the tribe table does not name the borrower', () => {
    const index = buildSoundIndex(voiced(saracenRows), [], []);
    expect(humanVoicesOf(index, egyptian(3))).toBeUndefined();
  });
});
