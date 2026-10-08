import { describe, expect, it } from 'vitest';
import {
  cultureOfStem,
  culturePools,
  MUSIC_VARIANTS,
  mapMusicFor,
  parseMusicManifest,
} from '../src/index.js';
import { manifestDocument, musicTrack } from './helpers/music-manifest.js';

/**
 * The rotation pools: every rendered stem lands in its culture's calm or tense pool, each distinct
 * audio once, and Underworld borrows from the Norse. The fixture is the full segment table, with the
 * twelve add-on stems that ship the same segment bytes as a base mission.
 */

const MISSION_FRANKEN1 = 11;
const MISSION_MIDGARD1 = 20;
const MISSION_ADDON_FRANKEN2 = 34;
const MISSION_ADDON_UNDERWORLD = 37;
const ATTACK_BYZANZ = 8;
const JINGLE_BIRTH = 23;

/** Add-on stem to the base stem whose segment bytes it repeats. */
const SAME_AUDIO: Readonly<Record<string, string>> = Object.fromEntries(
  [
    ['addon_arabs1', 'arabs1'],
    ['addon_arabs2', 'arabs3'],
    ['addon_franken2', 'franken1'],
    ['addon_franken3', 'franken2'],
  ].flatMap(([addon, base]) =>
    ['standard', 'wealthy', 'danger'].map((mood) => [`mission_${addon}_${mood}`, `mission_${base}_${mood}`]),
  ),
);

/** The two softest Norse calm stems, as rendered. */
const QUIET_NORSE = { mission_addon_nordland_standard: -28.7, mission_addon_asgard_standard: -27 };

function everyStem(): string[] {
  const stems = new Set<string>();
  for (const variants of Object.values(MUSIC_VARIANTS)) {
    if (variants.family === 'attack') stems.add(variants.stem);
    else for (const stem of Object.values(variants.stems)) stems.add(stem);
  }
  return [...stems];
}

const MANIFEST = parseMusicManifest(
  manifestDocument(
    Object.fromEntries(
      everyStem().map((stem) => {
        const sameAudioAs = SAME_AUDIO[stem];
        const loudnessLufs = QUIET_NORSE[stem as keyof typeof QUIET_NORSE] ?? -20;
        return [
          stem,
          musicTrack(stem, { loudnessLufs, ...(sameAudioAs === undefined ? {} : { sameAudioAs }) }),
        ];
      }),
    ),
  ),
);

if (MANIFEST === null) throw new Error('the fixture manifest must parse');
const POOLS = culturePools(MANIFEST);

describe('music culture', () => {
  it('reads the culture off the stem words, campaign digits and all', () => {
    expect(cultureOfStem('mission_midgard2_standard')).toBe('norse');
    expect(cultureOfStem('mission_addon_asgard_standard')).toBe('norse');
    expect(cultureOfStem('theme_franken_hostile')).toBe('frank');
    expect(cultureOfStem('attack_byzanz')).toBe('byzantine');
    expect(cultureOfStem('mission_addon_arabs2_wealthy')).toBe('arab');
    expect(cultureOfStem('mission_addon_underworld_standard')).toBe('underworld');
    expect(cultureOfStem('jingles_birth')).toBeNull();
  });
});

describe('culture pools', () => {
  it('sizes each pool by its distinct audio, the same-audio stems folded', () => {
    const sizes = Object.fromEntries(
      [...POOLS].map(([culture, { calm, tense }]) => [culture, [calm.length, tense.length]]),
    );
    expect(sizes).toEqual({
      norse: [8, 3],
      frank: [7, 4],
      byzantine: [10, 6],
      arab: [8, 5],
      underworld: [3, 3],
    });
  });

  it('never holds two stems of the same audio in one culture', () => {
    for (const { calm, tense } of POOLS.values()) {
      const digests = [...calm, ...tense].map((stem) => MANIFEST.tracks[stem]?.segmentSha256);
      expect(new Set(digests).size).toBe(digests.length);
    }
  });

  it('keeps a mission that authored only Standard out of the tense pool', () => {
    expect(POOLS.get('norse')?.calm).toContain('mission_midgard1_standard');
    expect(POOLS.get('norse')?.tense).not.toContain('mission_midgard1_standard');
  });

  it('files hostile themes, Danger missions and attacks as tense', () => {
    expect(POOLS.get('norse')?.tense).toEqual([
      'attack_viking',
      'mission_viking1_danger',
      'theme_viking_hostile',
    ]);
  });

  it('lends Underworld the two quietest Norse calm stems and the Norse tense pool', () => {
    expect(POOLS.get('underworld')).toEqual({
      calm: [
        'mission_addon_underworld_standard',
        'mission_addon_nordland_standard',
        'mission_addon_asgard_standard',
      ],
      tense: POOLS.get('norse')?.tense,
    });
  });

  it('leaves out a stem the pipeline did not render', () => {
    const { mission_viking1_danger: _missing, ...rest } = MANIFEST.tracks;
    expect(culturePools({ tracks: rest }).get('norse')?.tense).not.toContain('mission_viking1_danger');
  });
});

describe('map music', () => {
  it('gives a map code its culture, the culture pools and its own stems', () => {
    const music = mapMusicFor(MISSION_MIDGARD1, MANIFEST);
    expect(music?.culture).toBe('norse');
    expect(music?.pools).toEqual(POOLS.get('norse'));
    expect(music?.variants).toEqual(MUSIC_VARIANTS[MISSION_MIDGARD1]);
  });

  it('shares one pool between an add-on code and the base code it repeats', () => {
    expect(mapMusicFor(MISSION_ADDON_FRANKEN2, MANIFEST)?.pools).toEqual(
      mapMusicFor(MISSION_FRANKEN1, MANIFEST)?.pools,
    );
  });

  it('reads an attack code by its culture', () => {
    expect(mapMusicFor(ATTACK_BYZANZ, MANIFEST)?.culture).toBe('byzantine');
    expect(mapMusicFor(MISSION_ADDON_UNDERWORLD, MANIFEST)?.culture).toBe('underworld');
  });

  it('has no music for a jingle code, an unknown code, no code or no manifest', () => {
    expect(mapMusicFor(JINGLE_BIRTH, MANIFEST)).toBeNull();
    expect(mapMusicFor(999, MANIFEST)).toBeNull();
    expect(mapMusicFor(undefined, MANIFEST)).toBeNull();
    expect(mapMusicFor(MISSION_MIDGARD1, null)).toBeNull();
  });
});
