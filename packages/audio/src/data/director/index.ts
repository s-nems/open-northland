import type { AudioFrame, DirectorInput } from '../types.js';
import { ambientBeds } from './ambient.js';
import { eventOneShots } from './events.js';
import { chatterShots, responseShots } from './voices.js';

/**
 * The pure audio decision: turn one frame's sim events + world snapshot + camera into the sounds that
 * should be audible - positioned one-shots for events ({@link import('./events.js').eventOneShots}),
 * the creatures' own voices ({@link import('./voices.js').responseShots}, `chatterShots`), looping beds
 * for on-screen terrain ({@link import('./ambient.js').ambientBeds}). No Web Audio; the only randomness
 * is the chatter roll's injected source, and the engine picks a wav from each group and owns the
 * `AudioContext`.
 */

export function directAudio(input: DirectorInput): AudioFrame {
  return {
    oneShots: [...eventOneShots(input), ...responseShots(input), ...chatterShots(input)],
    ambient: ambientBeds(input),
  };
}

// The director package's public surface - the sub-decisions and their documented tuning knobs.
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_SAMPLES,
  MAX_AMBIENT_BEDS,
} from './ambient.js';
export { HOUSE_CRASH_MIN_BUILT, JINGLE_GAIN, SFX_GAIN } from './events.js';
export { ANIMAL_ROLL_RANGE, GENERIC_ROLL_RANGE, MAX_CHATTER_TICKS_PER_FRAME } from './voices.js';
