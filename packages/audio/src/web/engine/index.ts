/**
 * The Web Audio playback engine: the {@link import('./audio-engine.js').WebAudioEngine} coordinator
 * over its two units - {@link import('./sample-cache.js').SampleCache} (fetch+decode, failure-memoising)
 * and {@link import('./ambient-mixer.js').AmbientMixer} (looping-bed reconciliation).
 */
export { AMBIENT_FADE_S } from './ambient-mixer.js';
export {
  type AudioEngineOptions,
  DEFAULT_MASTER_GAIN,
  DEFAULT_MUSIC_BASE_URL,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  DEFAULT_SOUNDS_BASE_URL,
  ONE_SHOT_COOLDOWN_S,
  VOLUME_RAMP_S,
  WebAudioEngine,
} from './audio-engine.js';
export {
  GAME_MUSIC_TIMING,
  MENU_MUSIC_TIMING,
  MUSIC_STOP_FADE_S,
  type MusicTiming,
} from './music-player.js';
