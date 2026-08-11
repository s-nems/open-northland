import { parseMusicManifest } from '@open-northland/audio';
import { describe, expect, it } from 'vitest';
import { menuMusicTracks } from '../src/entries/main-menu/music.js';

/** The menu rotation's pure half: which rendered tracks the curated stems resolve to. */

const MANIFEST = parseMusicManifest({
  tracks: {
    theme_franken_neutral: { file: 'theme_franken_neutral.ogg' },
    theme_viking_friendly: { file: 'theme_viking_friendly.ogg' },
    mission_byzanz1_standard: { file: 'mission_byzanz1_standard.ogg' },
  },
});

describe('menuMusicTracks', () => {
  it('resolves the given stems in order and skips the ones the pipeline did not render', () => {
    expect(menuMusicTracks(MANIFEST, ['theme_viking_friendly', 'nothing', 'theme_franken_neutral'])).toEqual([
      { file: 'theme_viking_friendly.ogg' },
      { file: 'theme_franken_neutral.ogg' },
    ]);
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
