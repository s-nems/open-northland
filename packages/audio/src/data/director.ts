import { ambientBeds } from './ambient.js';
import { eventOneShots } from './events.js';
import type { AudioFrame, DirectorInput } from './types.js';

/**
 * The PURE audio decision: turn one frame's sim events + world snapshot + camera into the sounds that
 * should be audible — positioned one-shots for events ({@link import('./events.js').eventOneShots}),
 * looping beds for on-screen terrain ({@link import('./ambient.js').ambientBeds}). No Web Audio, no
 * randomness (the engine picks a wav from each group and owns the `AudioContext`), so the whole "what
 * plays right now" policy is unit-testable headless. It reuses `render`'s projection + viewport math
 * so a sound comes from exactly where its sprite draws and only while it is on screen.
 */

/** Decide the full audio for one frame: the one-shots to fire and the ambient loops that should be live. */
export function directAudio(input: DirectorInput): AudioFrame {
  return { oneShots: eventOneShots(input), ambient: ambientBeds(input) };
}
