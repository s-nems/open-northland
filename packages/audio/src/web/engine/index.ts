/**
 * The Web Audio playback engine package: the {@link import('./audio-engine.js').WebAudioEngine}
 * coordinator plus its two focused units — the {@link import('./sample-cache.js').SampleCache}
 * (fetch+decode, failure-memoising) and the {@link import('./ambient-mixer.js').AmbientMixer}
 * (looping-bed reconciliation).
 */
export { AMBIENT_FADE_S, AmbientMixer } from './ambient-mixer.js';
export {
  type AudioEngineOptions,
  COOLDOWN_PRUNE_SIZE,
  DEFAULT_MASTER_GAIN,
  DEFAULT_SOUNDS_BASE_URL,
  ONE_SHOT_COOLDOWN_S,
  WebAudioEngine,
} from './audio-engine.js';
export { SampleCache } from './sample-cache.js';
