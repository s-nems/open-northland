/**
 * `@open-northland/audio` - the browser audio layer. It reads the same read-only sim snapshot +
 * one-shot events `render` does (never reaching into sim state) and plays the decoded sounds. Split
 * like `render`: a pure `data/` decision layer (headless-testable) and an impure `web/` Web Audio sink
 * whose platform seams (context, fetch, random) are injectable for tests.
 */

// Pure decision layer (headless-testable; no Web Audio / DOM). The event→sound MusicType/group
// constants (JINGLE_*, GROUP_*) are intentionally not re-exported: they are implementation detail of
// `defaultBindings`, which is the surface a consumer overrides.
export { buildSoundIndex, type SoundIndex } from './data/bank.js';
export { defaultBindings, VIKING_VOICE_POOLS, type VoiceClass } from './data/bindings.js';
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_SAMPLES,
  directAudio,
  JINGLE_GAIN,
  MAX_AMBIENT_BEDS,
  SFX_GAIN,
} from './data/director/index.js';
export {
  CALM_MOOD,
  CONFLICT_HOLD_TICKS,
  type MissionMood,
  MUSIC_VARIANTS,
  type MusicManifest,
  type MusicMoodInput,
  type MusicMoodState,
  type MusicStanding,
  type MusicTrack,
  type MusicVariants,
  musicTrackFor,
  nextMusicMood,
  parseMusicManifest,
  type ThemeMood,
  WEALTHY_POPULATION,
  WEALTHY_POPULATION_DROP,
} from './data/music/index.js';
export {
  CULL_MARGIN_PX,
  computeSpatial,
  EDGE_GAIN,
  MAX_PAN,
  type Spatial,
  ZOOM_GAIN_FLOOR,
} from './data/spatial.js';
export type {
  AmbientLoop,
  AudioFrame,
  AudioTerrain,
  DirectorInput,
  EventSound,
  OneShot,
  SoundBindings,
} from './data/types.js';
export {
  AMBIENT_FADE_S,
  type AudioEngineOptions,
  DEFAULT_MASTER_GAIN,
  DEFAULT_MUSIC_BASE_URL,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_SFX_VOLUME,
  DEFAULT_SOUNDS_BASE_URL,
  MUSIC_FADE_S,
  ONE_SHOT_COOLDOWN_S,
  VOLUME_RAMP_S,
  WebAudioEngine,
} from './web/engine/index.js';
// Impure Web Audio sink (browser-only). The default-tuning constants stay exported as the documented
// knobs behind the options; the platform function types are the injectable test seams.
export type { ContextFactory, FetchBytes, RandomFn } from './web/platform.js';
export {
  type MusicMap,
  SoundDriver,
  type SoundDriverOptions,
  type SoundFrameInput,
} from './web/sound-driver.js';
