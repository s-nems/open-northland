/**
 * The Web Audio playback engine: the {@link import('./audio-engine.js').WebAudioEngine} coordinator
 * over its two units — {@link import('./sample-cache.js').SampleCache} (fetch+decode, failure-memoising)
 * and {@link import('./ambient-mixer.js').AmbientMixer} (looping-bed reconciliation).
 */
export { AMBIENT_FADE_S } from './ambient-mixer.js';
export {
  type AudioEngineOptions,
  DEFAULT_MASTER_GAIN,
  DEFAULT_SOUNDS_BASE_URL,
  ONE_SHOT_COOLDOWN_S,
  WebAudioEngine,
} from './audio-engine.js';
