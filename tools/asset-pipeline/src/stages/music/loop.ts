/**
 * Seamless looping for a rendered segment. A live sequencer never stops: the reverb and the notes
 * still sounding when a pass reaches the segment's end ring on over the next pass. A file cut at that
 * end loses both, so the loop restarts dry after an abrupt stop.
 */

/**
 * Add what still rings past `endFrame` onto the loop region starting at `loopFrame`, so the trimmed
 * file loops continuously. Folds only as much tail as the region can hold; anything longer would reach
 * past `endFrame` and be trimmed away again.
 */
export function foldLoopTail(channels: readonly Float32Array[], endFrame: number, loopFrame: number): void {
  const region = endFrame - loopFrame;
  if (region <= 0) return;
  for (const channel of channels) {
    const tail = Math.min(channel.length - endFrame, region);
    for (let i = 0; i < tail; i++) {
      channel[loopFrame + i] = (channel[loopFrame + i] ?? 0) + (channel[endFrame + i] ?? 0);
    }
  }
}
