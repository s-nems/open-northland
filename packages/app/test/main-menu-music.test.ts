import { parseMusicManifest } from '@open-northland/audio';
import { MUSIC_MANIFEST_VERSION } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { menuMusicTracks } from '../src/entries/main-menu/music.js';

/** The menu rotation's pure half: which rendered tracks the curated stems resolve to. */

/** A manifest row in the pipeline's layout for `stem`. */
const track = (stem: string, digit: string) => ({
  file: `${stem}.ogg`,
  loopStartS: 2,
  loopEndS: 4,
  loudnessLufs: -20,
  gainDb: 0,
  segmentSha256: digit.repeat(64),
});

const MANIFEST = parseMusicManifest({
  version: MUSIC_MANIFEST_VERSION,
  renderVersion: 1,
  sources: 'test',
  tracks: {
    theme_franken_neutral: track('theme_franken_neutral', 'a'),
    theme_viking_friendly: track('theme_viking_friendly', 'b'),
    mission_byzanz1_standard: track('mission_byzanz1_standard', 'c'),
  },
});

describe('menuMusicTracks', () => {
  it('resolves the given stems in order and skips the ones the pipeline did not render', () => {
    const files = menuMusicTracks(MANIFEST, [
      'theme_viking_friendly',
      'nothing',
      'theme_franken_neutral',
    ]).map((entry) => entry.file);
    expect(files).toEqual(['theme_viking_friendly.ogg', 'theme_franken_neutral.ogg']);
  });

  it('plays only curated stems, never every rendered track', () => {
    const files = menuMusicTracks(MANIFEST).map((track) => track.file);
    expect(files).not.toContain('mission_byzanz1_standard.ogg');
    expect(files.length).toBeGreaterThan(0);
  });

  it('is silent without a manifest', () => {
    expect(menuMusicTracks(null)).toEqual([]);
  });
});
