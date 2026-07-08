/**
 * `@vinland/audio` — the browser audio layer for Vinland. It consumes the same read-only sim
 * snapshot + one-shot events `render` does (never reaching into sim state) and plays the decoded
 * original sounds positionally: on-screen action SFX + ambient terrain beds attenuated/panned by the
 * camera, plus non-spatial life-event jingles and sex/age-matched settler voice chatter. Split like
 * `render`: a PURE `data/` decision layer (unit-testable headless) and an impure `web/` Web Audio
 * sink whose platform seams (context, fetch, random) are injectable for tests.
 */

// Pure decision layer (headless-testable; no Web Audio / DOM). The event→sound MusicType/group
// constants (JINGLE_*, GROUP_*) are intentionally NOT re-exported: they are implementation detail of
// `defaultBindings`, which is the surface a consumer overrides.
export { buildSoundIndex, type SoundIndex } from './data/bank.js';
export {
  defaultBindings,
  VIKING_VOICE_POOLS,
  vikingVoiceClass,
  type VoiceClass,
} from './data/bindings.js';
export {
  directAudio,
  JINGLE_GAIN,
  SFX_GAIN,
  MAX_AMBIENT_BEDS,
  AMBIENT_MAX_GAIN,
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_SAMPLES,
  type OnScreenSettler,
  onScreenSettlers,
} from './data/director/index.js';
export {
  type Spatial,
  computeSpatial,
  CULL_MARGIN_PX,
  EDGE_GAIN,
  MAX_PAN,
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

// Impure Web Audio sink (browser-only). The default-tuning constants stay exported as the documented
// knobs behind the options; the platform function types are the injectable test seams.
export type { ContextFactory, FetchBytes, RandomFn } from './web/platform.js';
export {
  type AudioEngineOptions,
  WebAudioEngine,
  DEFAULT_MASTER_GAIN,
  DEFAULT_SOUNDS_BASE_URL,
  ONE_SHOT_COOLDOWN_S,
  AMBIENT_FADE_S,
} from './web/engine/index.js';
export {
  type ChatterOptions,
  ChatterEmitter,
  VOICE_GAIN,
  VOICE_RATE_PER_SEC,
  VOICE_COOLDOWN_MS,
  MAX_CHATTER_DT_MS,
} from './web/chatter.js';
export { type SoundFrameInput, type SoundDriverOptions, SoundDriver } from './web/sound-driver.js';
