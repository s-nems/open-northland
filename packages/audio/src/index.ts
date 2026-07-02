/**
 * `@vinland/audio` — the browser audio layer for Vinland. It consumes the same read-only sim
 * snapshot + one-shot events `render` does (never reaching into sim state) and plays the decoded
 * original sounds positionally: on-screen action SFX + ambient terrain beds attenuated/panned by the
 * camera, plus non-spatial life-event jingles. Split like `render`: a PURE `data/` decision layer
 * (unit-testable headless) and an impure `web/` Web Audio sink.
 */

// Pure decision layer (headless-testable; no Web Audio / DOM).
export { buildSoundIndex, type SoundIndex } from './data/bank.js';
export {
  JINGLE_BIRTH,
  JINGLE_DEATH,
  JINGLE_HOUSE_BUILT,
  GROUP_HAMMER_WOOD,
  GROUP_WOODCUTTER_AXE,
  GROUP_CARPENTER_SAW,
  defaultBindings,
} from './data/bindings.js';
export {
  type AudioTerrain,
  type DirectorInput,
  directAudio,
  JINGLE_GAIN,
  SFX_GAIN,
  MAX_AMBIENT_BEDS,
  AMBIENT_MAX_GAIN,
  AMBIENT_FULL_COVERAGE,
} from './data/director.js';
export {
  type Spatial,
  computeSpatial,
  CULL_MARGIN_PX,
  EDGE_GAIN,
  MAX_PAN,
} from './data/spatial.js';
export type { AmbientLoop, AudioFrame, EventSound, OneShot, SoundBindings } from './data/types.js';

// Impure Web Audio sink (browser-only).
export {
  type AudioEngineOptions,
  WebAudioEngine,
  DEFAULT_MASTER_GAIN,
  ONE_SHOT_COOLDOWN_S,
  AMBIENT_FADE_S,
} from './web/audio-engine.js';
export { type SoundFrameInput, SoundDriver } from './web/sound-driver.js';
