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
export { type AuditionRole, auditionBed, auditionShot } from './data/audition.js';
export {
  AUTHORED_VOLUME_MAX,
  AUTHORED_VOLUME_RANGE_DB,
  authoredVolumeGain,
  buildSoundIndex,
  DEFAULT_AUTHORED_VOLUME,
  type SoundIndex,
} from './data/bank.js';
export { defaultBindings } from './data/bindings.js';
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_PAN,
  AMBIENT_MAX_SAMPLES,
  ANIMAL_ROLL_RANGE,
  directAudio,
  GENERIC_ROLL_RANGE,
  HOUSE_CRASH_MIN_BUILT,
  MAX_AMBIENT_BEDS,
  MAX_CHATTER_TICKS_PER_FRAME,
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
  ATTACK_HOLD_TICKS,
  CALM_FADE_S,
  CALM_MOOD,
  CALM_PASSES_MAX,
  CALM_PASSES_MIN,
  CALM_SILENCE_MAX_S,
  CALM_SILENCE_MIN_S,
  cueLoops,
  cuePlaySeconds,
  cultureOfStem,
  culturePools,
  type MapMusic,
  MENU_MUSIC_TIMING,
  type MissionMood,
  MUSIC_VARIANTS,
  type MusicCue,
  type MusicCulture,
  type MusicIntensity,
  type MusicManifest,
  type MusicMoodInput,
  type MusicMoodState,
  MusicPlaylist,
  type MusicPools,
  type MusicRandom,
  type MusicSequence,
  type MusicStanding,
  type MusicTiming,
  type MusicTrack,
  type MusicTransition,
  type MusicVariants,
  mapMusicFor,
  musicIntensity,
  nextMusicMood,
  OWN_STEM_EVERY_MAX,
  OWN_STEM_EVERY_MIN,
  ownCalmStem,
  ownTenseStem,
  type PlaylistMood,
  parseMusicManifest,
  passBoundaryAfter,
  TENSE_ENTER_THREAT,
  TENSE_EXIT_THREAT,
  TENSE_FADE_S,
  TENSE_PASSES,
  THREAT_HALF_LIFE_TICKS,
  type ThemeMood,
  trackRotation,
  WEALTHY_POPULATION,
  WEALTHY_POPULATION_DROP,
} from './data/music/index.js';
export {
  DEFAULT_CLIP_LENGTH_S,
  GAIN_JITTER_DB,
  KEY_COOLDOWN_S,
  LEDGER_PRUNE_SIZE,
  NO_REPEAT_FREE_CHOICES,
  type OneShotPlayback,
  POOL_INSTANCE_CAP,
  POOL_RETRIGGER_S,
  RATE_JITTER,
  WORLD_VOICE_CAP,
} from './data/one-shot-ledger.js';
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
export { type LaneCounts, type SoundStatsView, STAT_LANES, type StatLane } from './data/sound-stats.js';
export {
  computePan,
  computeSpatial,
  EDGE_GAIN,
  MAX_PAN,
  OFFSCREEN_FADE_SHARE,
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
  MUFFLE_Q_DB,
  MUSIC_DUCK_GAIN,
  MUSIC_DUCK_RAMP_S,
  MUSIC_STOP_FADE_S,
  MUSIC_SWITCH_TIMING,
  musicBusGain,
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
