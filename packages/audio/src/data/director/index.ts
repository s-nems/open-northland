import type { AudioFrame, DirectorInput } from '../types.js';
import { ambientBeds } from './ambient.js';
import { eventOneShots } from './events.js';
import { objectAmbienceShots } from './object-ambience.js';
import { chatterShots, responseShots, selectionVoiceShots } from './voices.js';

/**
 * The pure audio decision: turn one frame's sim events + world snapshot + camera into the sounds that
 * should be audible - positioned one-shots for events ({@link import('./events.js').eventOneShots}),
 * the creatures' own voices ({@link import('./voices.js').responseShots}, `selectionVoiceShots`,
 * `chatterShots`), looping beds
 * for on-screen terrain ({@link import('./ambient.js').ambientBeds}). No Web Audio; the only randomness
 * is the rolls' injected source; the arbiter picks a wav from each group and the engine owns
 * the `AudioContext`.
 */

export function directAudio(input: DirectorInput): AudioFrame {
  return {
    oneShots: [
      ...eventOneShots(input),
      ...selectionVoiceShots(input),
      ...responseShots(input),
      ...chatterShots(input),
      ...objectAmbienceShots(input),
    ],
    ambient: ambientBeds(input),
  };
}

// The director package's public surface - the sub-decisions and their documented tuning knobs.
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_PAN,
  AMBIENT_MAX_SAMPLES,
  MAX_AMBIENT_BEDS,
} from './ambient.js';
export { HOUSE_CRASH_MIN_BUILT } from './events.js';
export {
  ANSWER_LAYERS,
  ANSWER_MAX_PAN,
  type AnswerLayer,
  LAYER_GROUP_SIZES,
  layerCount,
  MURMUR_COOLDOWN_S,
  MURMUR_GAIN_DB,
  MURMUR_LINES,
  MURMUR_MIN_GROUP,
  SELECT_COOLDOWN_S,
} from './group-answer.js';
export { LANDSCAPE_CHANCE_RANGE, MAX_LANDSCAPE_TICKS_PER_FRAME } from './object-ambience.js';
export { ANIMAL_ROLL_RANGE, GENERIC_ROLL_RANGE, MAX_CHATTER_TICKS_PER_FRAME } from './voices.js';
