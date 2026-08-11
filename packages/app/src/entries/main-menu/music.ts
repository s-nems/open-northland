import { MUSIC_FADE_S, type MusicManifest, type MusicTrack, WebAudioEngine } from '@open-northland/audio';
import { withBaseUrl } from '../../base-url.js';
import { loadMusicManifest } from '../../content/music.js';
import { startSound } from '../../view/sound-start.js';
import { rotationOrder } from './rotation.js';
import { menuSettings, onSettingsChange } from './settings-state.js';

/**
 * Approximation: the segments the menu plays are a presentation choice. The original's segment table
 * names exactly the 64 rendered segments with no menu-specific entry, and what its menu starts is
 * unconfirmed against the running game.
 */
const MENU_MUSIC_STEMS: readonly string[] = [
  'theme_franken_friendly',
  'theme_franken_neutral',
  'theme_viking_friendly',
  'mission_addon_franken3_wealthy',
  'mission_addon_franken3_standard',
  'mission_addon_franken2_standard',
];

/** The rendered tracks behind `stems`, in that order; a stem the pipeline did not render is skipped. */
export function menuMusicTracks(
  manifest: MusicManifest | null,
  stems: readonly string[] = MENU_MUSIC_STEMS,
): readonly MusicTrack[] {
  if (manifest === null) return [];
  return stems
    .map((stem) => manifest.tracks[stem])
    .filter((track): track is MusicTrack => track !== undefined);
}

/**
 * The menu's soundtrack: its own music-only engine playing the curated tracks one at a time in a
 * shuffled order, following the audio settings live because the screen that changes them is in this
 * menu. A checkout without rendered music stays silent. `signal` fades the music out and releases the
 * context on handover to a game.
 */
export function startMenuMusic(signal: AbortSignal): void {
  const settings = menuSettings();
  const engine = new WebAudioEngine({
    musicBaseUrl: withBaseUrl('/music/'),
    musicVolume: settings.musicVolume,
  });
  engine.setEnabled(settings.soundEnabled);
  void loadMusicManifest().then((manifest) => {
    if (signal.aborted) return;
    engine.setMusicRotation(menuMusicTracks(manifest, rotationOrder(MENU_MUSIC_STEMS, null, Math.random)));
  });
  startSound(engine, { signal });

  onSettingsChange((next) => {
    engine.setEnabled(next.soundEnabled);
    engine.setMusicVolume(next.musicVolume);
  }, signal);

  signal.addEventListener('abort', () => {
    engine.setMusic(null); // the fade covers the load screen the launched entry puts up
    window.setTimeout(() => engine.close(), MUSIC_FADE_S * 1000);
  });
}
