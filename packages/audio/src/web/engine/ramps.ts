/**
 * Click-free parameter moves. A gain or pan that jumps on a sounding node, or a source cut mid-wave,
 * clicks, so such a change ramps on the audio clock and a stop waits for its fade to land.
 */

/** Ramp `param` linearly from its current value to `target` over `seconds`, replacing any automation
 *  still scheduled. */
export function rampParam(ctx: BaseAudioContext, param: AudioParam, target: number, seconds: number): void {
  const now = ctx.currentTime;
  // Read the live level before cancelling: cancelling first drops the ramp this anchor must capture.
  const from = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(target, now + seconds);
}
