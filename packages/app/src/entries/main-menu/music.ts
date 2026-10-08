import {
  MUSIC_STOP_FADE_S,
  type MusicManifest,
  type MusicTrack,
  trackRotation,
  type UiCue,
  uiCueShot,
  WebAudioEngine,
} from '@open-northland/audio';
import { loadMusicManifest } from '../../content/music.js';
import { followPageFocus } from '../../view/sound-background.js';
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

/** The menu's sound beyond its music: the hardwired cues a menu screen fires, such as the lobby's
 *  incoming-chat ring. */
export interface MenuSound {
  cue(cue: UiCue): void;
}

/**
 * The menu's soundtrack: its own engine playing the curated tracks one at a time in a shuffled order,
 * following the audio settings live because the screen that changes them is in this menu. A checkout
 * without rendered music stays silent. `signal` fades the music out and releases the context on
 * handover to a game. The returned handle fires the menu's own cues through the same engine.
 */
export function startMenuMusic(signal: AbortSignal): MenuSound {
  const settings = menuSettings();
  const engine = new WebAudioEngine({ volumes: settings.volumes });
  engine.setEnabled(settings.soundEnabled);
  engine.setPlayInBackground(settings.soundInBackground);
  void loadMusicManifest().then((manifest) => {
    if (signal.aborted) return;
    const tracks = menuMusicTracks(manifest, rotationOrder(MENU_MUSIC_STEMS, null, Math.random));
    engine.setMusic(trackRotation(tracks));
  });
  startSound(engine, { signal });
  followPageFocus(engine, { signal });

  onSettingsChange((next) => {
    engine.setEnabled(next.soundEnabled);
    engine.setVolumes(next.volumes);
    engine.setPlayInBackground(next.soundInBackground);
  }, signal);

  signal.addEventListener('abort', () => {
    engine.setMusic(null); // the fade covers the load screen the launched entry puts up
    window.setTimeout(() => engine.close(), MUSIC_STOP_FADE_S * 1000);
  });
  return { cue: (cue) => engine.fire([uiCueShot(cue)]) };
}
