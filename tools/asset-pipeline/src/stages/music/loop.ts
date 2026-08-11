import type { TimedEvent } from './events.js';

/**
 * Seamless looping for a rendered segment. A sequencer plays the intro once and then repeats the loop
 * region forever, so every pass but the first begins under the previous pass's decay. A single
 * rendered pass has the intro's decay there instead, and cutting it at the segment end drops the
 * decay altogether: the loop then restarts on a step no live performance makes.
 *
 * The region is therefore rendered several times over and a late traversal published, by when the
 * decay carried in matches the decay carried out and the file loops onto itself.
 */

/** The render's frame range holding traversal `n` of the loop region (1 is the one the intro leads into). */
function traversalStart(loopFrame: number, endFrame: number, n: number): number {
  return n <= 1 ? loopFrame : endFrame + (n - 2) * (endFrame - loopFrame);
}

/**
 * The performance with the next pass's fresh notes dropped and the loop region queued `traversals`
 * times back to back. Note-offs are kept whenever they fall, so a note held across any end still
 * releases.
 */
export function withRepeatedLoop(
  events: readonly TimedEvent[],
  loopFrame: number,
  endFrame: number,
  traversals: number,
): TimedEvent[] {
  const shift = endFrame - loopFrame;
  const pass = events.filter((event) => event.t < endFrame || event.e === 'off');
  if (shift <= 0) return pass;
  const region = pass.filter((event) => event.t >= loopFrame);
  const out = [...pass];
  for (let n = 1; n < traversals; n++) {
    for (const event of region) out.push({ ...event, t: event.t + shift * n });
  }
  // Stable sort, so a repeat still follows the earlier traversal's event at the same frame.
  return out.sort((a, b) => a.t - b.t);
}

/** How many frames {@link withRepeatedLoop} needs rendered: every traversal, plus decay past the last. */
export function repeatedLoopFrames(
  loopFrame: number,
  endFrame: number,
  traversals: number,
  tailFrames: number,
): number {
  return traversalStart(loopFrame, endFrame, traversals) + (endFrame - loopFrame) + tailFrames;
}

/**
 * The publishable track: the intro as first played, then the last traversal of the loop region in
 * place of the first. Same length as a single pass, and its end now flows into its own loop start.
 */
export function spliceSteadyLoop(
  channels: readonly Float32Array[],
  loopFrame: number,
  endFrame: number,
  traversals: number,
): Float32Array[] {
  const region = endFrame - loopFrame;
  const from = traversalStart(loopFrame, endFrame, traversals);
  return channels.map((channel) => {
    const out = new Float32Array(endFrame);
    out.set(channel.subarray(0, Math.min(loopFrame, channel.length)), 0);
    out.set(channel.subarray(from, from + region).subarray(0, region), loopFrame);
    return out;
  });
}
