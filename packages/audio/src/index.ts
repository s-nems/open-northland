/**
 * `@open-northland/audio` - the browser audio layer. It reads the same read-only sim snapshot +
 * one-shot events `render` does (never reaching into sim state) and plays the decoded sounds. Split
 * like `render`: a pure `data/` decision layer (headless-testable) and an impure `web/` Web Audio sink
 * whose platform seams (context, fetch, random) are injectable for tests.
 */

// Pure decision layer (headless-testable; no Web Audio / DOM). The event→sound MusicType/group
// constants (JINGLE_*, GROUP_*) are intentionally not re-exported: they are implementation detail of
// `defaultBindings`, which is the surface a consumer overrides.
export {
  DEFAULT_JINGLE_LENGTH_S,
  DEFAULT_JINGLE_PRIORITY,
  JINGLE_COOLDOWN_GROWTH,
  JINGLE_COOLDOWN_MAX_S,
  JINGLE_FREQUENT_WINDOW,
  JINGLE_PENDING_MAX_AGE_S,
  JINGLE_PRIORITY,
  OneShotArbiter,
  SFX_BURST,
  SFX_STARTS_PER_S,
  VOICE_BURST,
  VOICE_STARTS_PER_S,
} from './data/arbiter.js';
export { buildSoundIndex, type SoundIndex } from './data/bank.js';
export { defaultBindings } from './data/bindings.js';
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_SAMPLES,
  ANIMAL_ROLL_RANGE,
  directAudio,
  GENERIC_ROLL_RANGE,
  HOUSE_CRASH_MIN_BUILT,
  JINGLE_GAIN,
  MAX_AMBIENT_BEDS,
  MAX_CHATTER_TICKS_PER_FRAME,
  SFX_GAIN,
} from './data/director/index.js';
export {
  clampVolume,
  DEFAULT_AMBIENT_VOLUME,
  DEFAULT_BUS_VOLUME,
  DEFAULT_MASTER_VOLUME,
  DEFAULT_VOLUMES,
  type MixerVolumes,
  oneShotBus,
  SOUND_BUSES,
  type SoundBus,
  VOLUME_CHANNELS,
  VOLUME_MAX,
  VOLUME_RANGE_DB,
  type VolumeChannel,
  volumeGain,
} from './data/mixer.js';
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
  FAR_ZOOM_SCALE,
  MUFFLE_FAR_HZ,
  MUFFLE_OPEN_HZ,
  muffleCutoffHz,
  NEAR_ZOOM_SCALE,
  PERSPECTIVE_CURVES,
  type PerspectiveCurve,
  type PerspectiveLayer,
  perspectiveGain,
  SHOT_LAYERS,
  type ShotLayer,
  shotLayer,
  zoomDistance,
} from './data/perspective.js';
export {
  CULL_MARGIN_PX,
  computePan,
  computeSpatial,
  EDGE_GAIN,
  MAX_PAN,
  type Spatial,
} from './data/spatial.js';
export type {
  AmbientLoop,
  AudioFrame,
  AudioTerrain,
  ChatterInput,
  DirectorInput,
  EventSound,
  Lane,
  OneShot,
  SoundBindings,
} from './data/types.js';
export { UI_CUE_FILES, UI_CUE_GAIN, type UiCue, uiCueShot } from './data/ui-cues.js';
// Weather soundscape: every level and band is a named approximation in its module (the original has
// no weather sound); this is the mix decision and the knob a caller most likely retunes.
export {
  WEATHER_AMOUNT_FOR_FULL_SOUND,
  type WeatherMix,
  type WeatherSoundInput,
  weatherMix,
} from './data/weather/mix.js';
export {
  AMBIENT_FADE_S,
  type AudioEngineOptions,
  CLICK_FREE_RAMP_S,
  CLOSE_GRACE_S,
  DEFAULT_MUSIC_BASE_URL,
  DEFAULT_SOUNDS_BASE_URL,
  LIMITER_ATTACK_S,
  LIMITER_KNEE_DB,
  LIMITER_RATIO,
  LIMITER_RELEASE_S,
  LIMITER_THRESHOLD_DB,
  MENU_MUSIC_TIMING,
  MUFFLE_Q_DB,
  MUSIC_DUCK_GAIN,
  MUSIC_DUCK_RAMP_S,
  MUSIC_STOP_FADE_S,
  MUSIC_SWITCH_TIMING,
  type MusicTiming,
  musicBusGain,
  ONE_SHOT_COOLDOWN_S,
  PERSPECTIVE_RAMP_S,
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
