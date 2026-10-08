/**
 * Click-free parameter moves. A gain or pan that jumps on a sounding node, or a source cut mid-wave,
 * clicks, so such a change ramps on the audio clock and a stop waits for its fade to land.
 */

/** The shortest fade that hides a cut or a jump: long enough to smooth the step, short enough to read
 *  as instant. Approximation inside the usual 10-30 ms anti-click window. */
export const CLICK_FREE_RAMP_S = 0.02;

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
