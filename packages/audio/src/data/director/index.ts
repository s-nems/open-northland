import type { AudioFrame, DirectorInput } from '../types.js';
import { ambientBeds } from './ambient.js';
import { eventOneShots } from './events.js';

/**
 * The pure audio decision: turn one frame's sim events + world snapshot + camera into the sounds that
 * should be audible — positioned one-shots for events ({@link import('./events.js').eventOneShots}),
 * looping beds for on-screen terrain ({@link import('./ambient.js').ambientBeds}). No Web Audio, no
 * randomness — the engine picks a wav from each group and owns the `AudioContext`.
 */

export function directAudio(input: DirectorInput): AudioFrame {
  return { oneShots: eventOneShots(input), ambient: ambientBeds(input) };
}

// The director package's public surface — the sub-decisions and their documented tuning knobs.
export {
  AMBIENT_FULL_COVERAGE,
  AMBIENT_MAX_GAIN,
  AMBIENT_MAX_SAMPLES,
  MAX_AMBIENT_BEDS,
} from './ambient.js';
export { CHAT_VOICE_GAIN, JINGLE_GAIN, SFX_GAIN } from './events.js';
